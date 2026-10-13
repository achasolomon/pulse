import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type { CredentialRepository } from '../domain/credential.repository.js';

@Injectable()
export class KyselyCredentialRepository implements CredentialRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}

  async create(input: { personId?: string; accountName?: string; loginId: string; secretHash: string }) {
    const r = await this.db
      .insertInto('iam.credential')
      .values({
        person_id: input.personId ?? null,
        account_name: input.accountName ?? null,
        login_id: input.loginId,
        secret_hash: input.secretHash,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findByLogin(loginId: string) {
    const r = await this.db
      .selectFrom('iam.credential')
      .select(['id', 'person_id', 'account_name', 'login_id', 'secret_hash', 'status', 'totp_secret', 'totp_enabled'])
      .where('login_id', '=', loginId)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      ...(r.person_id ? { personId: r.person_id } : {}),
      ...(r.account_name ? { accountName: r.account_name } : {}),
      loginId: r.login_id,
      secretHash: r.secret_hash,
      status: r.status,
      totpEnabled: r.totp_enabled,
      ...(r.totp_secret ? { totpSecret: r.totp_secret } : {}),
    };
  }

  async findById(id: string) {
    const r = await this.db
      .selectFrom('iam.credential')
      .select(['id', 'person_id', 'account_name', 'login_id', 'secret_hash', 'status', 'totp_secret', 'totp_enabled'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) return undefined;
    return {
      id: r.id,
      ...(r.person_id ? { personId: r.person_id } : {}),
      ...(r.account_name ? { accountName: r.account_name } : {}),
      loginId: r.login_id,
      secretHash: r.secret_hash,
      status: r.status,
      totpEnabled: r.totp_enabled,
      ...(r.totp_secret ? { totpSecret: r.totp_secret } : {}),
    };
  }

  async setTotp(id: string, secret: string | undefined, enabled: boolean): Promise<void> {
    await this.db
      .updateTable('iam.credential')
      .set({ totp_secret: secret ?? null, totp_enabled: enabled })
      .where('id', '=', id)
      .execute();
  }

  async createSession(input: {
    credentialId: string;
    personId?: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const r = await this.db
      .insertInto('iam.session')
      .values({
        credential_id: input.credentialId,
        person_id: input.personId ?? null,
        token_hash: input.tokenHash,
        expires_at: input.expiresAt,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    return { id: r.id };
  }

  async findSession(tokenHash: string) {
    const r = await this.db
      .selectFrom('iam.session as s')
      .innerJoin('iam.credential as c', 'c.id', 's.credential_id')
      .select(['s.id', 's.credential_id', 's.person_id', 'c.status'])
      .where('s.token_hash', '=', tokenHash)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', new Date())
      .executeTakeFirst();
    if (!r || r.status !== 'active') return undefined;
    return {
      sessionId: r.id,
      credentialId: r.credential_id,
      ...(r.person_id ? { personId: r.person_id } : {}),
      scopes: ['staff'],
    };
  }

  async revokeSession(id: string): Promise<void> {
    await this.db
      .updateTable('iam.session')
      .set({ revoked_at: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async linkIdentity(input: { personId: string; provider: string; subject: string }) {
    const r = await this.db
      .insertInto('iam.identity_link')
      .values({ person_id: input.personId, provider: input.provider, subject: input.subject })
      .onConflict((oc) => oc.columns(['provider', 'subject']).doNothing())
      .returning(['id'])
      .executeTakeFirst();
    if (r) return { id: r.id };
    const existing = await this.db
      .selectFrom('iam.identity_link')
      .select(['id'])
      .where('provider', '=', input.provider)
      .where('subject', '=', input.subject)
      .executeTakeFirstOrThrow();
    return { id: existing.id };
  }

  async findIdentity(provider: string, subject: string) {
    const r = await this.db
      .selectFrom('iam.identity_link')
      .select(['person_id'])
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
    return r ? { personId: r.person_id } : undefined;
  }
}
