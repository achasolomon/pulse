import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { scryptSync } from 'node:crypto';
import type { Request } from 'express';
import {
  PORTAL_REPOSITORY,
  type PortalRepository,
} from '../domain/portal.repository.js';
import { portalContextStorage } from './portal-context.js';

function hashToken(token: string): string {
  return scryptSync(token, 'pulse-portal-session', 32).toString('hex');
}

/**
 * Patient session guard (EPIC-19). Bearer token -> hashed lookup -> ALS portal
 * context. Staff guards never apply here and vice versa: separate surface,
 * separate secrets. Proxy sessions carry both identities for audit.
 */
@Injectable()
export class PatientSessionGuard implements CanActivate {
  constructor(
    @Inject(PORTAL_REPOSITORY) private readonly repo: PortalRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException({ code: 'PORTAL_TOKEN_REQUIRED', message: 'Bearer token required' });
    }
    const session = await this.repo.findSession(hashToken(token));
    if (!session) {
      throw new UnauthorizedException({ code: 'PORTAL_SESSION_INVALID', message: 'Invalid or expired session' });
    }
    portalContextStorage.enterWith({
      sessionId: session.sessionId,
      accountId: session.accountId,
      actingPatientId: session.actingPatientId,
      scopes: session.scopes,
      ...(session.proxyAccountId ? { proxyAccountId: session.proxyAccountId } : {}),
    });
    (req as Request & { portal?: typeof session }).portal = session;
    return true;
  }
}
