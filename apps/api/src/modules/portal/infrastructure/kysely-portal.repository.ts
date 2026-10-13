import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { PortalRepository } from '../domain/portal.repository.js';

@Injectable()
export class KyselyPortalRepository implements PortalRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async createAccount(input: { patientId: string; loginId: string; secretHash: string }) {
    const r = await this.db
      .insertInto('portal.account')
      .values({ patient_id: input.patientId, login_id: input.loginId, secret_hash: input.secretHash })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findAccountByLogin(loginId: string) {
    const r = await this.db
      .selectFrom('portal.account')
      .select(['id', 'patient_id', 'secret_hash', 'status'])
      .where('login_id', '=', loginId)
      .executeTakeFirst();
    if (!r) return undefined;
    return { id: r.id, patientId: r.patient_id, secretHash: r.secret_hash, status: r.status };
  }

  async createSession(input: {
    accountId: string;
    tokenHash: string;
    actingPatientId: string;
    scopes: string[];
    expiresAt: Date;
  }) {
    const r = await this.db
      .insertInto('portal.session')
      .values({
        account_id: input.accountId,
        token_hash: input.tokenHash,
        acting_patient_id: input.actingPatientId,
        scopes: input.scopes,
        expires_at: input.expiresAt,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findSession(tokenHash: string) {
    const r = await this.db
      .selectFrom('portal.session')
      .select(['id', 'account_id', 'acting_patient_id', 'scopes', 'expires_at', 'revoked_at'])
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
    if (!r || r.revoked_at || r.expires_at < new Date()) return undefined;
    const grants = await this.db
      .selectFrom('portal.account')
      .select(['id'])
      .where('id', '=', r.account_id)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!grants) return undefined;
    // proxy attribution: sessions created via act-as carry the proxy account
    const proxy = await this.db
      .selectFrom('portal.proxy_grant')
      .select(['proxy_account_id'])
      .where('dependent_patient_id', '=', r.acting_patient_id)
      .where('proxy_account_id', '=', r.account_id)
      .where('active', '=', true)
      .executeTakeFirst();
    return {
      sessionId: r.id,
      accountId: r.account_id,
      actingPatientId: r.acting_patient_id,
      scopes: r.scopes,
      ...(proxy ? { proxyAccountId: proxy.proxy_account_id } : {}),
    };
  }

  async revokeSession(id: string): Promise<void> {
    await this.db
      .updateTable('portal.session')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async grantProxy(input: {
    dependentPatientId: string;
    proxyAccountId: string;
    relationship: string;
    scopes: string[];
  }) {
    const r = await this.db
      .insertInto('portal.proxy_grant')
      .values({
        dependent_patient_id: input.dependentPatientId,
        proxy_account_id: input.proxyAccountId,
        relationship: input.relationship,
        scopes: input.scopes,
      })
      .onConflict((oc) =>
        oc.columns(['dependent_patient_id', 'proxy_account_id']).doUpdateSet({
          relationship: input.relationship,
          scopes: input.scopes,
          active: true,
        }),
      )
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findGrant(dependentPatientId: string, proxyAccountId: string) {
    const r = await this.db
      .selectFrom('portal.proxy_grant')
      .select(['scopes', 'active'])
      .where('dependent_patient_id', '=', dependentPatientId)
      .where('proxy_account_id', '=', proxyAccountId)
      .executeTakeFirst();
    if (!r) return undefined;
    return { scopes: r.scopes, active: r.active };
  }
}
