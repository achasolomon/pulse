import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { CREDENTIAL_REPOSITORY, type CredentialRepository } from '../domain/credential.repository.js';
import { STAFF_CONTEXT_REPOSITORY, type StaffContextRepository } from '../domain/staff-context.repository.js';
import { hashToken } from '../domain/credentials.js';

@Injectable()
export class StaffContextService {
  constructor(
    @Inject(CREDENTIAL_REPOSITORY) private readonly credentials: CredentialRepository,
    @Inject(STAFF_CONTEXT_REPOSITORY) private readonly contexts: StaffContextRepository,
  ) {}

  async self(authorization?: string) {
    if (!authorization || !/^Bearer staff_[a-f0-9]{64}$/.test(authorization)) {
      throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID', message: 'A valid staff session is required' });
    }
    if (!process.env.DATABASE_URL) {
      throw new ServiceUnavailableException({ code: 'STAFF_CONTEXT_UNAVAILABLE', message: 'Staff context is unavailable' });
    }
    const session = await this.credentials.findSession(hashToken(authorization.slice(7)));
    if (!session?.personId || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID', message: 'A valid staff session is required' });
    }
    const credential = await this.credentials.findById(session.credentialId);
    if (!credential || credential.status !== 'active' || credential.personId !== session.personId) {
      throw new UnauthorizedException({ code: 'STAFF_SESSION_INVALID', message: 'A valid staff session is required' });
    }
    return {
      sessionId: session.sessionId,
      personId: session.personId,
      loginId: credential.loginId,
      expiresAt: session.expiresAt.toISOString(),
      facilities: await this.contexts.listFacilities(session.personId),
    };
  }
}
