import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  PORTAL_REPOSITORY,
  SESSION_TTL_MS,
  hashSecret,
  newSessionToken,
  verifySecret,
  type PortalRepository,
} from '../domain/portal.repository.js';

/** Portal application service (EPIC-19). Own credentials, own sessions; never touches workforce IAM. */
@Injectable()
export class PortalService {
  constructor(
    @Inject(PORTAL_REPOSITORY) private readonly repo: PortalRepository,
    private readonly outbox: OutboxService,
  ) {}

  async register(input: { patientId: string; loginId: string; secret: string }) {
    if (!input.secret || input.secret.length < 8) {
      throw new BadRequestException({
        code: 'SECRET_WEAK',
        message: 'Portal secret must be at least 8 characters',
      });
    }
    const account = await this.repo.createAccount({
      patientId: input.patientId,
      loginId: input.loginId,
      secretHash: hashSecret(input.secret),
    });
    await this.outbox.publish({
      aggregateType: 'portal_account',
      aggregateId: account.id,
      type: 'portal.registered',
      producer: 'portal',
      payload: { id: account.id },
    });
    return account;
  }

  async login(input: { loginId: string; secret: string }) {
    const account = await this.repo.findAccountByLogin(input.loginId);
    if (!account || account.status !== 'active' || !verifySecret(input.secret, account.secretHash)) {
      // Uniform response: no user enumeration.
      throw new UnauthorizedException({ code: 'PORTAL_AUTH_FAILED', message: 'Invalid credentials' });
    }
    const pair = newSessionToken();
    const session = await this.repo.createSession({
      accountId: account.id,
      tokenHash: pair.hash,
      actingPatientId: account.patientId,
      scopes: ['read'],
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    return { token: pair.token, sessionId: session.id, patientId: account.patientId };
  }

  async actAs(input: { proxyAccountId: string; dependentPatientId: string; scopes?: string[] }) {
    const grant = await this.repo.findGrant(input.dependentPatientId, input.proxyAccountId);
    if (!grant || !grant.active) {
      throw new UnauthorizedException({ code: 'PROXY_DENIED', message: 'No active proxy grant' });
    }
    const pair = newSessionToken();
    const session = await this.repo.createSession({
      accountId: input.proxyAccountId,
      tokenHash: pair.hash,
      actingPatientId: input.dependentPatientId,
      scopes: input.scopes?.filter((s) => grant.scopes.includes(s)) ?? grant.scopes,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await this.outbox.publish({
      aggregateType: 'portal_session',
      aggregateId: session.id,
      type: 'portal.proxy_session',
      producer: 'portal',
      payload: { id: session.id, dependent: input.dependentPatientId },
    });
    return { token: pair.token, sessionId: session.id, patientId: input.dependentPatientId };
  }

  logout(sessionId: string) {
    return this.repo.revokeSession(sessionId);
  }

  async grantProxy(input: {
    dependentPatientId: string;
    proxyAccountId: string;
    relationship: string;
    scopes?: string[];
    correlationId?: string;
  }) {
    const grant = await this.repo.grantProxy({
      dependentPatientId: input.dependentPatientId,
      proxyAccountId: input.proxyAccountId,
      relationship: input.relationship,
      scopes: input.scopes ?? ['read'],
    });
    await this.outbox.publish({
      aggregateType: 'portal_proxy',
      aggregateId: grant.id,
      type: 'portal.proxy_granted',
      producer: 'portal',
      correlationId: input.correlationId,
      payload: { id: grant.id },
    });
    return grant;
  }
}
