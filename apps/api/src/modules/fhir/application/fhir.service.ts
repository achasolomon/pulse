import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import { PATIENT_REPOSITORY, type PatientRepository } from '../../patient/domain/patient.repository.js';
import { ENCOUNTER_REPOSITORY, type EncounterRepository } from '../../encounter/domain/encounter.repository.js';
import {
  capabilityStatement,
  toFhirEncounter,
  toFhirObservation,
  toFhirPatient,
} from '../domain/translate.js';
import { PARTNER_REPOSITORY, type PartnerRepository } from '../infrastructure/partner.repository.js';

/** FHIR read service (EPIC-18 partial). Reads via repository ports; translates at the boundary. */
@Injectable()
export class FhirService {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepository,
    @Inject(ENCOUNTER_REPOSITORY) private readonly encounters: EncounterRepository,
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
    @Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>,
  ) {}

  metadata() {
    return capabilityStatement();
  }

  async readPatient(id: string, partnerId?: string) {
    const p = await this.patients.findById(id);
    await this.partners.logAccess({ partnerId, resourceType: 'Patient', resourceId: id, status: p ? 200 : 404 });
    if (!p) {
      throw new NotFoundException({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: `Patient/${id} not found` }],
      });
    }
    return toFhirPatient(p);
  }

  async searchPatient(identifier: string, partnerId?: string) {
    // identifier format system|value; value-only supported as fallback.
    const [, value] = identifier.includes('|') ? identifier.split('|') : [undefined, identifier];
    const rows = await this.db
      .selectFrom('patient.identifier as i')
      .innerJoin('patient.patient as p', 'p.id', 'i.patient_id')
      .select(['p.id'])
      .where('i.value', '=', value ?? identifier)
      .limit(25)
      .execute();
    const entry: unknown[] = [];
    for (const r of rows) {
      const p = await this.patients.findById(r.id);
      if (p) entry.push({ resource: toFhirPatient(p) });
    }
    await this.partners.logAccess({ partnerId, resourceType: 'Patient', status: 200 });
    return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry };
  }

  async searchObservations(patientId: string, partnerId?: string) {
    const rows = await this.db
      .selectFrom('clin.observation')
      .select(['id', 'code', 'value_num', 'value_text', 'unit', 'taken_at', 'patient_id', 'origin'])
      .where('patient_id', '=', patientId)
      .orderBy('taken_at', 'desc')
      .limit(50)
      .execute();
    const entry = rows.map((r, i) =>
      toFhirObservation(
        {
          code: r.code,
          ...(r.value_num !== null ? { valueNum: Number(r.value_num) } : {}),
          ...(r.value_text ? { valueText: r.value_text } : {}),
          ...(r.unit ? { unit: r.unit } : {}),
          takenAt: r.taken_at.toISOString(),
          patientId: r.patient_id,
          origin: r.origin,
        },
        String(r.id ?? `obs-${i}`),
      ),
    );
    await this.partners.logAccess({ partnerId, resourceType: 'Observation', status: 200 });
    return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry: entry.map((resource) => ({ resource })) };
  }

  async readEncounter(id: string, partnerId?: string) {
    const e = await this.encounters.findById(id);
    await this.partners.logAccess({ partnerId, resourceType: 'Encounter', resourceId: id, status: e ? 200 : 404 });
    if (!e) {
      throw new NotFoundException({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-found', diagnostics: `Encounter/${id} not found` }],
      });
    }
    return toFhirEncounter({ id: e.id, patientId: e.patientId, type: e.type, status: e.status });
  }
}
