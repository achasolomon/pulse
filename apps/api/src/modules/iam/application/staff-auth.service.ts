import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  CREDENTIAL_REPOSITORY,
  type CredentialRepository,
} from '../domain/credential.repository.js';
import {
  STAFF_SESSION_TTL_MS,
  hashSecret,
  hashToken,
  newSessionToken,
  verifySecret,
} from '../domain/credentials.js';
import { newTotpSecret, otpauthUrl, verifyTotp } from '../domain/totp.js';

/** Staff authentication service (EPIC-03 F03.1). Secrets never leave hashes. */
@Injectable()
export class StaffAuthService {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly repo: CredentialRepository,
    private readonly outbox: OutboxService,
  ) {}

  async register(input: {
    personId?: string;
    accountName?: string;
    loginId: string;
    secret: string;
  }) {
    if (!input.secret || input.secret.length < 10) {
      throw new BadRequestException({
        code: 'SECRET_WEAK',
        message: 'Staff secrets must be at least 10 characters',
      });
    }
    if (!input.personId && !input.accountName) {
      throw new BadRequestException({
        code: 'IDENTITY_REQUIRED',
        message: 'Credential needs a person or service account name',
      });
    }
    const created = await this.repo.create({
      ...(input.personId ? { personId: input.personId } : {}),
      ...(input.accountName ? { accountName: input.accountName } : {}),
      loginId: input.loginId,
      secretHash: hashSecret(input.secret),
    });
    await this.outbox.publish({
      aggregateType: 'staff_credential',
      aggregateId: created.id,
      type: 'staff.registered',
      producer: 'iam',
      payload: { id: created.id },
    });
    return created;
  }

  async login(input: { loginId: string; secret: string; totp?: string }) {
    const credential = await this.repo.findByLogin(input.loginId);
    if (
      !credential ||
      credential.status !== 'active' ||
      !verifySecret(input.secret, credential.secretHash)
    ) {
      throw new UnauthorizedException({ code: 'STAFF_AUTH_FAILED', message: 'Invalid credentials' });
    }
    if (credential.totpEnabled) {
      if (!input.totp || !credential.totpSecret || !verifyTotp(credential.totpSecret, input.totp)) {
        throw new UnauthorizedException({ code: 'STAFF_MFA_REQUIRED', message: 'Valid TOTP code required' });
      }
    }
    const pair = newSessionToken();
    const session = await this.repo.createSession({
      credentialId: credential.id,
      ...(credential.personId ? { personId: credential.personId } : {}),
      tokenHash: pair.hash,
      expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS),
    });
    return {
      token: pair.token,
      sessionId: session.id,
      ...(credential.personId ? { personId: credential.personId } : {}),
    };
  }

  logout(sessionId: string) {
    return this.repo.revokeSession(sessionId);
  }

  /** Revokes the session behind a raw (unhashed) staff token. */
  async logoutByToken(token: string) {
    const session = await this.repo.findSession(hashToken(token));
    if (!session) return { revoked: false as const };
    await this.repo.revokeSession(session.sessionId);
    return { revoked: true as const };
  }

  /** SSO seam: mapping only. Federation protocol verification lands with the adapter. */
  async linkIdentity(input: { personId: string; provider: string; subject: string }) {
    const link = await this.repo.linkIdentity(input);
    await this.outbox.publish({
      aggregateType: 'identity_link',
      aggregateId: link.id,
      type: 'staff.identity_linked',
      producer: 'iam',
      payload: { id: link.id, provider: input.provider },
    });
    return link;
  }

  async enrollTotp(credentialId: string) {
    const secret = newTotpSecret();
    await this.repo.setTotp(credentialId, secret, false);
    return { otpauthUrl: otpauthUrl(secret, credentialId) };
  }

  /** Confirm enrollment by verifying a live code, then enable MFA. */
  async confirmTotp(credentialId: string, code: string) {
    const credential = await this.repo.findById(credentialId);
    if (!credential?.totpSecret || !verifyTotp(credential.totpSecret, code)) {
      throw new UnauthorizedException({ code: 'STAFF_MFA_INVALID', message: 'Invalid TOTP code' });
    }
    await this.repo.setTotp(credentialId, credential.totpSecret, true);
    await this.outbox.publish({
      aggregateType: 'staff_credential',
      aggregateId: credentialId,
      type: 'staff.mfa_enabled',
      producer: 'iam',
      payload: { id: credentialId },
    });
    return { enabled: true as const };
  }
}
