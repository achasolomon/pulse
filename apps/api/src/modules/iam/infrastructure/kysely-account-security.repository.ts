import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { PULSE_DB } from '../../../platform/database/database.module.js';
import type { PulseDatabase } from '../../../platform/database/db.types.js';
import type {
  AccountSecurityRepository,
  RecoveryJob,
} from '../domain/account-security.repository.js';
@Injectable()
export class KyselyAccountSecurityRepository implements AccountSecurityRepository {
  constructor(@Inject(PULSE_DB) private readonly db: Kysely<PulseDatabase>) {}
  async status(credentialId: string) {
    const c = await this.db
      .selectFrom('iam.credential')
      .select(['totp_enabled', 'recovery_email', 'recovery_email_verified_at'])
      .where('id', '=', credentialId)
      .executeTakeFirstOrThrow();
    return {
      mfaEnabled: c.totp_enabled,
      recoveryEmail: c.recovery_email,
      emailVerified: !!c.recovery_email_verified_at,
    };
  }
  async findRecoveryCredential(loginId: string) {
    const c = await this.db
      .selectFrom('iam.credential')
      .select(['id', 'recovery_email'])
      .where('login_id', '=', loginId)
      .where('status', '=', 'active')
      .where('person_id', 'is not', null)
      .where('recovery_email_verified_at', 'is not', null)
      .executeTakeFirst();
    return c?.recovery_email
      ? { id: c.id, email: c.recovery_email }
      : undefined;
  }
  async createRequest(
    input: RecoveryJob & { tokenHash: string; expiresAt: Date },
  ) {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('iam.recovery_request')
        .set({ used_at: new Date() })
        .where('credential_id', '=', input.credentialId)
        .where('purpose', '=', input.purpose)
        .where('used_at', 'is', null)
        .execute();
      await tx
        .insertInto('iam.recovery_request')
        .values({
          id: input.id,
          credential_id: input.credentialId,
          purpose: input.purpose,
          email: input.email,
          token_hash: input.tokenHash,
          mail_token_encrypted: input.encryptedToken,
          expires_at: input.expiresAt,
        })
        .execute();
    });
  }
  async pendingMail() {
    const rows = await this.db
      .selectFrom('iam.recovery_request')
      .selectAll()
      .where('delivered_at', 'is', null)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('created_at')
      .limit(10)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      credentialId: r.credential_id,
      purpose: r.purpose,
      email: r.email,
      encryptedToken: r.mail_token_encrypted,
    }));
  }
  async markDelivered(id: string) {
    await this.db
      .updateTable('iam.recovery_request')
      .set({ delivered_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  async resetPassword(tokenHash: string, secretHash: string) {
    return this.db.transaction().execute(async (tx) => {
      const candidate = await tx
        .selectFrom('iam.recovery_request')
        .select('credential_id')
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst();
      if (!candidate) return false;
      const c = await tx
        .selectFrom('iam.credential')
        .selectAll()
        .where('id', '=', candidate.credential_id)
        .forUpdate()
        .executeTakeFirst();
      const r = await tx
        .selectFrom('iam.recovery_request')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .where('purpose', '=', 'password_reset')
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!r) return false;
      if (
        !c ||
        c.status !== 'active' ||
        !c.person_id ||
        !c.recovery_email_verified_at ||
        c.recovery_email !== r.email
      )
        return false;
      await tx
        .updateTable('iam.credential')
        .set({ secret_hash: secretHash })
        .where('id', '=', c.id)
        .execute();
      await tx
        .updateTable('iam.session')
        .set({ revoked_at: new Date() })
        .where('credential_id', '=', c.id)
        .where('revoked_at', 'is', null)
        .execute();
      await tx
        .updateTable('iam.recovery_request')
        .set({ used_at: new Date(), mail_token_encrypted: '' })
        .where('credential_id', '=', c.id)
        .where('purpose', '=', 'password_reset')
        .where('used_at', 'is', null)
        .execute();
      return true;
    });
  }
  async verifyEmail(tokenHash: string, credentialId: string) {
    return this.db.transaction().execute(async (tx) => {
      const c = await tx
        .selectFrom('iam.credential')
        .selectAll()
        .where('id', '=', credentialId)
        .forUpdate()
        .executeTakeFirst();
      const r = await tx
        .selectFrom('iam.recovery_request')
        .selectAll()
        .where('token_hash', '=', tokenHash)
        .where('purpose', '=', 'verify_email')
        .where('credential_id', '=', credentialId)
        .where('used_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!r) return false;
      if (!c || c.status !== 'active' || !c.person_id) return false;
      await tx
        .updateTable('iam.credential')
        .set({
          recovery_email: r.email,
          recovery_email_verified_at: new Date(),
        })
        .where('id', '=', credentialId)
        .execute();
      await tx
        .updateTable('iam.recovery_request')
        .set({ used_at: new Date(), mail_token_encrypted: '' })
        .where('id', '=', r.id)
        .execute();
      return true;
    });
  }
  async setMfaAndRevoke(
    credentialId: string,
    expectedSecret: string,
    enabled: boolean,
  ) {
    return this.db.transaction().execute(async (tx) => {
      const result = await tx
        .updateTable('iam.credential')
        .set({
          totp_enabled: enabled,
          ...(!enabled ? { totp_secret: null } : {}),
        })
        .where('id', '=', credentialId)
        .where('status', '=', 'active')
        .where('totp_secret', '=', expectedSecret)
        .where('totp_enabled', '=', !enabled)
        .returning('id')
        .executeTakeFirst();
      if (!result) return false;
      await tx
        .updateTable('iam.session')
        .set({ revoked_at: new Date() })
        .where('credential_id', '=', credentialId)
        .where('revoked_at', 'is', null)
        .execute();
      return true;
    });
  }
}
