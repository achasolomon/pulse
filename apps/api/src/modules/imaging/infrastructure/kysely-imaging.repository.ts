import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  ImagingRepository,
  ImagingStatus,
} from '../domain/imaging.repository.js';

@Injectable()
export class KyselyImagingRepository implements ImagingRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async order(input: {
    patientId: string;
    encounterId: string;
    procedureCode: string;
    bodyRegion: string;
    laterality?: string;
    indication: string;
    urgency: 'stat' | 'urgent' | 'routine';
  }) {
    const r = await this.db
      .insertInto('img.img_order')
      .values({
        patient_id: input.patientId,
        encounter_id: input.encounterId,
        procedure_code: input.procedureCode,
        body_region: input.bodyRegion,
        laterality: input.laterality ?? null,
        indication: input.indication,
        urgency: input.urgency,
      })
      .returning(['id', 'status'])
      .executeTakeFirstOrThrow();
    return { id: r.id, status: r.status as ImagingStatus };
  }

  async findOrder(id: string) {
    const r = await this.db
      .selectFrom('img.img_order')
      .select(['id', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? { id: r.id, status: r.status as ImagingStatus } : undefined;
  }

  async setStatus(id: string, status: ImagingStatus, cancelReason?: string): Promise<void> {
    await this.db
      .updateTable('img.img_order')
      .set({
        status,
        ...(cancelReason ? { cancel_reason: cancelReason } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async linkStudy(
    orderId: string,
    input: { studyUid: string; accession: string; modality: string; pacsRef: string },
  ) {
    const r = await this.db
      .insertInto('img.study')
      .values({
        order_id: orderId,
        study_uid: input.studyUid,
        accession: input.accession,
        modality: input.modality,
        pacs_ref: input.pacsRef,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async saveReport(orderId: string, input: { text: string; authorId?: string }) {
    const prev = await this.db
      .selectFrom('img.report')
      .select(['version'])
      .where('order_id', '=', orderId)
      .orderBy('version', 'desc')
      .executeTakeFirst();
    const r = await this.db
      .insertInto('img.report')
      .values({
        order_id: orderId,
        text: input.text,
        author_id: input.authorId ?? null,
        version: (prev?.version ?? 0) + 1,
      })
      .returning(['id', 'version'])
      .executeTakeFirstOrThrow();
    return { id: r.id, version: r.version };
  }

  async finalizeReport(orderId: string) {
    const latest = await this.db
      .selectFrom('img.report')
      .select(['id', 'version'])
      .where('order_id', '=', orderId)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();
    await this.db
      .updateTable('img.report')
      .set({ status: 'final' })
      .where('id', '=', latest.id)
      .execute();
    return { version: latest.version };
  }

  async worklist(statuses: ImagingStatus[], limit: number) {
    const rows = await this.db
      .selectFrom('img.img_order')
      .select(['id', 'status'])
      .where('status', 'in', statuses)
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status as ImagingStatus }));
  }
}
