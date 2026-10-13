import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';

export const PARTNER_REPOSITORY = 'PARTNER_REPOSITORY';

export interface PartnerRepository {
  create(input: { name: string; apiKeyHash: string; scopes: string[] }): Promise<{ id: string }>;
  findByHash(hash: string): Promise<{ id: string; scopes: string[]; active: boolean } | undefined>;
  logAccess(input: { partnerId?: string; resourceType: string; resourceId?: string; status: number }): Promise<void>;
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

@Injectable()
export class KyselyPartnerRepository implements PartnerRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: { name: string; apiKeyHash: string; scopes: string[] }) {
    const r = await this.db
      .insertInto('integration.partner')
      .values({ name: input.name, api_key_hash: input.apiKeyHash, scopes: input.scopes })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findByHash(hash: string) {
    // Hash lookup by equality, then constant-time compare for certainty.
    const rows = await this.db
      .selectFrom('integration.partner')
      .select(['id', 'api_key_hash', 'scopes', 'active'])
      .where('active', '=', true)
      .execute();
    const hit = rows.find((r) => safeEqual(r.api_key_hash, hash));
    return hit ? { id: hit.id, scopes: hit.scopes, active: hit.active } : undefined;
  }

  async logAccess(input: { partnerId?: string; resourceId?: string; resourceType: string; status: number }): Promise<void> {
    if (!process.env.DATABASE_URL) return; // dev/test without DB: app logs only
    await this.db
      .insertInto('integration.fhir_log')
      .values({
        partner_id: input.partnerId ?? null,
        resource_type: input.resourceType,
        resource_id: input.resourceId ?? null,
        status: input.status,
      })
      .execute();
  }
}
