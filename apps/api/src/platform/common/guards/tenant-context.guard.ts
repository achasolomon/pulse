import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  BREAK_GLASS_HEADER,
  CORRELATION_HEADER,
  DEPARTMENT_HEADER,
  FACILITY_HEADER,
  PATIENT_HEADER,
  PURPOSE_HEADER,
  TENANT_HEADER,
  requestContextStorage,
  type RequestContext,
} from '../types/request-context.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PURPOSES = new Set([
  'treatment',
  'payment',
  'operations',
  'audit',
  'research',
]);

/**
 * Requires tenant + facility context (F02.3, IAM-001 contextual authz).
 * Reads x-tenant-id / x-facility-id, validates UUID shape, stores in ALS
 * for downstream audit/outbox/policy use. Opt-in via @UseGuards (not global)
 * so health/ready stay unauthenticated.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = singleHeader(req, TENANT_HEADER);
    const facilityId = singleHeader(req, FACILITY_HEADER);
    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ??
      singleHeader(req, CORRELATION_HEADER);

    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_REQUIRED',
        message: 'x-tenant-id (UUID) is required',
      });
    }
    if (!facilityId || !UUID_RE.test(facilityId)) {
      throw new ForbiddenException({
        code: 'FACILITY_CONTEXT_REQUIRED',
        message: 'x-facility-id (UUID) is required',
      });
    }

    const breakGlassReason = singleHeader(req, BREAK_GLASS_HEADER);
    if (breakGlassReason !== undefined && breakGlassReason.trim().length < 10) {
      // Break-glass is exceptional and audited: a missing/throwaway reason is
      // rejected up front (IAM-001). Time-limit + alerting land with EPIC-22 depth.
      throw new ForbiddenException({
        code: 'BREAK_GLASS_REASON_REQUIRED',
        message: 'Break-glass requires a justification of at least 10 characters',
      });
    }
    const patientId = singleHeader(req, PATIENT_HEADER);
    if (patientId !== undefined && !UUID_RE.test(patientId)) {
      throw new ForbiddenException({
        code: 'PATIENT_CONTEXT_INVALID',
        message: 'x-patient-id must be a UUID when present',
      });
    }
    const departmentId = singleHeader(req, DEPARTMENT_HEADER);
    if (departmentId !== undefined && !UUID_RE.test(departmentId)) {
      throw new ForbiddenException({
        code: 'DEPARTMENT_CONTEXT_INVALID',
        message: 'x-department-id must be a UUID when present',
      });
    }
    const purpose = singleHeader(req, PURPOSE_HEADER);
    if (purpose !== undefined && !PURPOSES.has(purpose)) {
      throw new ForbiddenException({
        code: 'DENY_PURPOSE_INVALID',
        message: 'x-purpose must be treatment|payment|operations|audit|research',
      });
    }
    const ctx: RequestContext = {
      correlationId: correlationId ?? 'unknown',
      tenantId,
      facilityId,
      ...(patientId ? { patientId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(purpose ? { purpose } : {}),
      breakGlass: Boolean(breakGlassReason),
      ...(breakGlassReason ? { breakGlassReason } : {}),
    };
    requestContextStorage.enterWith(ctx);
    (req as Request & { requestContext?: RequestContext }).requestContext =
      ctx;
    return true;
  }
}

function singleHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
