import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Write-scope enforcement for partner write endpoints (FHIR-001 section 58,
 * FHIR-SR-014). Runs after PartnerApiKeyGuard, which attaches partnerScopes.
 * Key without the 'write' scope -> 403 PARTNER_SCOPE_DENIED.
 */
@Injectable()
export class PartnerWriteScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<
      Request & { partnerScopes?: string[] }
    >();
    if (!Array.isArray(req.partnerScopes) || !req.partnerScopes.includes('write')) {
      throw new ForbiddenException({
        code: 'PARTNER_SCOPE_DENIED',
        message: 'Partner key lacks the write scope',
      });
    }
    return true;
  }
}
