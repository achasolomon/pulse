import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { toDateOnly } from '../../../platform/database/dates.js';
import type {
  PatientRepository,
  RegisterPatientInput,
} from '../domain/patient.repository.js';
import type { PatientSummary } from '../domain/types.js';

@Injectable()
export class KyselyPatientRepository implements PatientRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: RegisterPatientInput & { identifiers: { system: string; value: string; facilityId?: string }[] }) {
    return this.db.transaction().execute(async (trx) => {
      const p = await trx
        .insertInto('patient.patient')
        .values({
          family_name: input.familyName,
          given_name: input.givenName,
          date_of_birth: input.dateOfBirth,
          sex: input.sex,
          facility_id: input.facilityId,
        })
        .returning(['id', 'family_name', 'given_name', 'date_of_birth', 'sex', 'facility_id', 'status'])
        .executeTakeFirstOrThrow();
      for (const id of input.identifiers) {
        await trx
          .insertInto('patient.identifier')
          .values({
            patient_id: p.id,
            system: id.system,
            value: id.value,
            facility_id: id.facilityId ?? input.facilityId,
          })
          .execute();
      }
      return {
        id: p.id,
        familyName: p.family_name,
        givenName: p.given_name,
        dateOfBirth: toDateOnly(p.date_of_birth),
        sex: p.sex as 'M' | 'F' | 'O' | 'U',
        facilityId: p.facility_id,
        status: p.status as 'active' | 'retired-duplicate',
      };
    });
  }

  async findById(id: string): Promise<PatientSummary | undefined> {
    const p = await this.db
      .selectFrom('patient.patient')
      .select(['id', 'family_name', 'given_name', 'date_of_birth', 'sex', 'facility_id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!p) return undefined;
    const ids = await this.db
      .selectFrom('patient.identifier')
      .select(['system', 'value', 'facility_id'])
      .where('patient_id', '=', id)
      .execute();
    const link = await this.db
      .selectFrom('patient.merge_link')
      .select(['survivor_id'])
      .where('duplicate_id', '=', id)
      .executeTakeFirst();
    return {
      id: p.id,
      familyName: p.family_name,
      givenName: p.given_name,
      dateOfBirth: toDateOnly(p.date_of_birth),
      sex: p.sex as 'M' | 'F' | 'O' | 'U',
      facilityId: p.facility_id,
      status: p.status as 'active' | 'retired-duplicate',
      identifiers: ids.map((i) => ({
        system: i.system,
        value: i.value,
        ...(i.facility_id ? { facilityId: i.facility_id } : {}),
      })),
      ...(link ? { mergedInto: link.survivor_id } : {}),
    };
  }

  async findByIdentifierValue(value: string): Promise<{ id: string }[]> {
    const rows = await this.db
      .selectFrom('patient.identifier')
      .select('patient_id')
      .where('value', '=', value)
      .limit(10)
      .execute();
    return [...new Set(rows.map((r) => r.patient_id))].map((id) => ({ id }));
  }

  async search(input: { query: string; facilityId: string; limit: number }): Promise<PatientSummary[]> {
    const q = input.query.trim();
    if (!q) return [];
    // Identifier-exact first, then family-name prefix — both facility-scoped.
    const byId = await this.db
      .selectFrom('patient.identifier as i')
      .innerJoin('patient.patient as p', 'p.id', 'i.patient_id')
      .select(['p.id', 'p.family_name', 'p.given_name', 'p.date_of_birth', 'p.sex', 'p.facility_id', 'p.status'])
      .where('i.value', '=', q)
      .where('p.facility_id', '=', input.facilityId)
      .limit(input.limit)
      .execute();
    const byName = await this.db
      .selectFrom('patient.patient as p')
      .select(['p.id', 'p.family_name', 'p.given_name', 'p.date_of_birth', 'p.sex', 'p.facility_id', 'p.status'])
      .where('p.facility_id', '=', input.facilityId)
      .where('p.family_name', 'ilike', `${q}%`)
      .limit(input.limit)
      .execute();
    const seen = new Set<string>();
    const out: PatientSummary[] = [];
    for (const p of [...byId, ...byName]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({
        id: p.id,
        familyName: p.family_name,
        givenName: p.given_name,
        dateOfBirth: toDateOnly(p.date_of_birth),
        sex: p.sex as 'M' | 'F' | 'O' | 'U',
        facilityId: p.facility_id,
        status: p.status as 'active' | 'retired-duplicate',
        identifiers: [],
      });
    }
    return out.slice(0, input.limit);
  }

  async listFacilityPatients(facilityId: string, limit: number) {
    const rows = await this.db
      .selectFrom('patient.patient as p')
      .select(['p.id', 'p.family_name', 'p.date_of_birth'])
      .where('p.facility_id', '=', facilityId)
      .where('p.status', '=', 'active')
      .limit(limit)
      .execute();
    const out: { patientId: string; familyName: string; dateOfBirth: string; identifiers: { system: string; value: string }[] }[] = [];
    for (const r of rows) {
      const ids = await this.db
        .selectFrom('patient.identifier')
        .select(['system', 'value'])
        .where('patient_id', '=', r.id)
        .execute();
      out.push({
        patientId: r.id,
        familyName: r.family_name,
        dateOfBirth: toDateOnly(r.date_of_birth),
        identifiers: ids,
      });
    }
    return out;
  }

  async merge(input: { survivorId: string; duplicateId: string; reason: string; mergedBy?: string }): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('patient.merge_link')
        .values({
          survivor_id: input.survivorId,
          duplicate_id: input.duplicateId,
          reason: input.reason,
          merged_by: input.mergedBy ?? null,
        })
        .execute();
      await trx
        .updateTable('patient.patient')
        .set({ status: 'retired-duplicate' })
        .where('id', '=', input.duplicateId)
        .execute();
    });
  }

  async findMergeTarget(duplicateId: string): Promise<string | undefined> {
    const r = await this.db
      .selectFrom('patient.merge_link')
      .select(['survivor_id'])
      .where('duplicate_id', '=', duplicateId)
      .executeTakeFirst();
    return r?.survivor_id;
  }

  async setGuarantor(id: string, input: { name: string; contact?: string }): Promise<void> {
    await this.db
      .updateTable('patient.patient')
      .set({ guarantor_name: input.name, guarantor_contact: input.contact ?? null })
      .where('id', '=', id)
      .execute();
  }
}
