import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';

export const EXTERNAL_RESOURCE_REPOSITORY = 'EXTERNAL_RESOURCE_REPOSITORY';

export interface LedgerRecord {
  partnerId: string;
  idempotencyKey: string | null;
  requestFingerprint: string;
  resourceType: string;
  method: 'fhir' | 'hl7v2-oru';
  internalId: string;
}

export interface LedgerHit {
  internalId: string;
  requestFingerprint: string;
}

/**
 * Idempotency + provenance ledger for external writes (FHIR-001 section 50,
 * FHIR-SR-007). The unique key (partner, resource type, idempotency key) is
 * the concurrency guard: `insert` throws (23505) when a concurrent request
 * claimed the key first; callers re-read and replay or conflict.
 */
export interface ExternalResourceRepository {
  findByIdempotencyKey(
    partnerId: string,
    resourceType: string,
    key: string,
  ): Promise<LedgerHit | undefined>;
  insert(record: LedgerRecord): Promise<void>;
  /** Compensation only: a domain-row failure after a successful claim. */
  deleteByKey(partnerId: string, resourceType: string, key: string): Promise<void>;
}

export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('duplicate key value');
}

@Injectable()
export class KyselyExternalResourceRepository implements ExternalResourceRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async findByIdempotencyKey(partnerId: string, resourceType: string, key: string) {
    const row = await this.db
      .selectFrom('integration.external_resource')
      .select(['internal_id', 'request_fingerprint'])
      .where('partner_id', '=', partnerId)
      .where('resource_type', '=', resourceType)
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    return row
      ? { internalId: row.internal_id, requestFingerprint: row.request_fingerprint }
      : undefined;
  }

  async insert(record: LedgerRecord) {
    await this.db
      .insertInto('integration.external_resource')
      .values({
        partner_id: record.partnerId,
        idempotency_key: record.idempotencyKey,
        request_fingerprint: record.requestFingerprint,
        resource_type: record.resourceType,
        method: record.method,
        internal_id: record.internalId,
        outcome: 'created',
      })
      .execute();
  }

  async deleteByKey(partnerId: string, resourceType: string, key: string) {
    await this.db
      .deleteFrom('integration.external_resource')
      .where('partner_id', '=', partnerId)
      .where('resource_type', '=', resourceType)
      .where('idempotency_key', '=', key)
      .execute();
  }
}
