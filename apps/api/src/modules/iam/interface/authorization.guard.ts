import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessPolicyService } from '../application/access-policy.service.js';
import { BreakGlassService } from '../application/break-glass.service.js';
import { MembershipService } from '../application/membership.service.js';
import {
  CARE_ASSIGNMENT_REPOSITORY,
  type CareAssignmentRepository,
} from '../domain/care-assignment.repository.js';
import {
  CREDENTIAL_REPOSITORY,
  type CredentialRepository,
} from '../domain/credential.repository.js';
import { hashToken } from '../domain/credentials.js';
import type { PurposeOfUse } from '../domain/types.js';

export const REQUIRE_PRIVILEGE_KEY = 'pulse:require-privilege';

export interface RequirePrivilegeOptions {
  action: string;
  resourceType: string;
}

/**
 * Resolves the caller, in order:
 * 1. Staff session (`Authorization: Bearer staff_<token>`) -> person -> DB membership.
 * 2. Demo headers (`x-demo-person`/`x-demo-privileges`) -> demo membership,
 *    ONLY when ALLOW_DEMO_AUTH=true (tests/dev). Production defaults to deny.
 * Default deny in all cases (IAM-001 section 2).
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: AccessPolicyService,
    private readonly memberships: MembershipService,
    @Optional()
    @Inject(CREDENTIAL_REPOSITORY)
    private readonly credentials?: CredentialRepository,
    @Optional()
    @Inject(CARE_ASSIGNMENT_REPOSITORY)
    private readonly careAssignments?: CareAssignmentRepository,
    @Optional()
    private readonly breakGlass?: BreakGlassService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.get<RequirePrivilegeOptions | undefined>(
      REQUIRE_PRIVILEGE_KEY,
      context.getHandler(),
    );
    if (!opts) return true;
    const req = context.switchToHttp().getRequest<
      Request & {
        requestContext?: {
          facilityId?: string;
          patientId?: string;
          departmentId?: string;
          purpose?: string;
          breakGlass?: boolean;
          breakGlassReason?: string;
        };
      }
    >();
    const facilityId = req.requestContext?.facilityId;
    if (!facilityId) {
      throw new ForbiddenException({
        code: 'AUTHORIZATION_CONTEXT_MISSING',
        message: 'Tenant context required before authorization',
      });
    }
    const personId = await this.resolvePerson(req);
    const dbMembership = await this.memberships.findActive(personId, facilityId);
    const membership = dbMembership ?? this.demoMembership(req, personId, facilityId);
    const careRelationship = await this.hasCareRelationship(req, personId, facilityId);
    const breakGlassRecentGrants = req.requestContext?.breakGlass
      ? await this.breakGlass?.countRecent(personId)
      : undefined;
    const decision = this.policy.evaluate({
      personId: membership.personId,
      membership: { ...membership, facilityId },
      facilityId,
      action: opts.action,
      resourceType: opts.resourceType,
      ...(req.requestContext?.patientId
        ? { patientId: req.requestContext.patientId }
        : {}),
      ...(req.requestContext?.departmentId
        ? { departmentId: req.requestContext.departmentId }
        : {}),
      ...(req.requestContext?.purpose
        ? { purpose: req.requestContext.purpose as PurposeOfUse }
        : {}),
      ...(careRelationship !== undefined ? { careRelationship } : {}),
      breakGlass: req.requestContext?.breakGlass,
      ...(req.requestContext?.breakGlassReason
        ? { breakGlassReason: req.requestContext.breakGlassReason }
        : {}),
      ...(breakGlassRecentGrants !== undefined
        ? { breakGlassRecentGrants }
        : {}),
    });
    if (!decision.allow) {
      throw new ForbiddenException({
        code: 'ACCESS_DENIED',
        message: `Denied: ${decision.reason}`,
      });
    }
    if (decision.reason === 'ALLOW_BREAK_GLASS') {
      // §31: persist the reasoned, time-limited grant; activation is audited
      // via outbox (BreakGlassActivated) inside the service.
      await this.breakGlass?.activate({
        personId,
        facilityId,
        ...(req.requestContext?.patientId
          ? { patientId: req.requestContext.patientId }
          : {}),
        resourceType: opts.resourceType,
        action: opts.action,
        reason: decision.breakGlass?.reason ?? req.requestContext?.breakGlassReason ?? '',
      });
    }
    return true;
  }

  private async hasCareRelationship(
    req: Request & { requestContext?: { patientId?: string } },
    personId: string,
    facilityId: string,
  ): Promise<boolean | undefined> {
    const patientId = req.requestContext?.patientId;
    if (!patientId || !this.careAssignments) return undefined;
    if (!process.env.DATABASE_URL) return undefined;
    const found = await this.careAssignments.findActive({
      patientId,
      personId,
      facilityId,
    });
    return Boolean(found);
  }

  private async resolvePerson(req: Request): Promise<string> {
    const auth = req.headers['authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    if (header?.startsWith('Bearer staff_')) {
      const token = header.slice('Bearer '.length);
      const session = await this.credentials?.findSession(hashToken(token));
      if (!session?.personId) {
        throw new UnauthorizedException({
          code: 'STAFF_SESSION_INVALID',
          message: 'Invalid staff session (service accounts need explicit grants)',
        });
      }
      return session.personId;
    }
    if (process.env.ALLOW_DEMO_AUTH !== 'true') {
      throw new ForbiddenException({
        code: 'DEMO_DISABLED',
        message: 'Demo auth is disabled; present a staff session',
      });
    }
    return singleHeader(req, 'x-demo-person') ?? 'demo-person';
  }

  private demoMembership(
    req: Request,
    personId: string,
    facilityId: string,
  ): {
    membershipId: string;
    personId: string;
    organizationId: string;
    facilityId: string;
    roles: string[];
    privileges: string[];
  } {
    return {
      membershipId: 'demo-membership',
      personId,
      organizationId: 'demo-org',
      facilityId,
      roles: ['demo-role'],
      privileges: parsePrivileges(req.headers['x-demo-privileges']),
    };
  }
}

function singleHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function parsePrivileges(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
