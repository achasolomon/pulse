import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { DocumentRepository } from '../domain/document.repository.js';

@Injectable()
export class KyselyDocumentRepository implements DocumentRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async register(input: {
    patientId?: string;
    encounterId?: string;
    name: string;
    mime: string;
    storageKey: string;
  }) {
    if (!input.storageKey || input.storageKey.includes('..')) {
      throw new Error('DOCUMENT_KEY_INVALID');
    }
    const r = await this.db
      .insertInto('docs.document')
      .values({
        patient_id: input.patientId ?? null,
        encounter_id: input.encounterId ?? null,
        name: input.name,
        mime: input.mime,
        storage_key: input.storageKey,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async listForPatient(patientId: string, limit: number) {
    const rows = await this.db
      .selectFrom('docs.document')
      .select(['id', 'name', 'mime', 'storage_key'])
      .where('patient_id', '=', patientId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      storageKey: r.storage_key,
    }));
  }
}
