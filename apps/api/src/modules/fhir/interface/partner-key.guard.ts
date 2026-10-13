import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request } from 'express';
import {
  PARTNER_REPOSITORY,
  hashApiKey,
  type PartnerRepository,
} from '../infrastructure/partner.repository.js';

/**
 * Partner API-key guard for the FHIR surface (FHIR-001 partner auth).
 * No key or unknown/inactive key -> 401 ProblemDetails. Success attaches
 * partnerId (audit) and partnerScopes (write-scope enforcement); scopes are
 * enforced only on write endpoints this sprint (FHIR-SR-014 read scopes later).
 * Demo/dev fallback: if no DATABASE_URL is configured, the static key
 * `pulse-dev-partner` is accepted with ['read','write'] (tests only).
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(
    @Inject(PARTNER_REPOSITORY) private readonly partners: PartnerRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-api-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key) {
      throw new UnauthorizedException({ code: 'PARTNER_KEY_REQUIRED', message: 'x-api-key is required' });
    }
    if (!process.env.DATABASE_URL) {
      if (key === 'pulse-dev-partner') {
        (req as Request & { partnerId?: string; partnerScopes?: string[] }).partnerId = 'dev-partner';
        (req as Request & { partnerId?: string; partnerScopes?: string[] }).partnerScopes = [
          'read',
          'write',
        ];
        return true;
      }
      throw new UnauthorizedException({ code: 'PARTNER_UNKNOWN', message: 'Unknown partner key' });
    }
    const hit = await this.partners.findByHash(hashApiKey(key));
    if (!hit) {
      throw new UnauthorizedException({ code: 'PARTNER_UNKNOWN', message: 'Unknown partner key' });
    }
    const r = req as Request & { partnerId?: string; partnerScopes?: string[] };
    r.partnerId = hit.id;
    r.partnerScopes = hit.scopes;
    return true;
  }
}
