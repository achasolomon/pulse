import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  FACILITY_HEADER,
  requestContextStorage,
  type RequestContext,
} from '../../../platform/common/types/request-context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import { AuthorizationGuard } from '../../iam/interface/authorization.guard.js';
import type { Device } from '../domain/device.repository.js';
import { DeviceService } from '../application/device.service.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DeviceRequest = Request & {
  edgeDevice?: Device;
  requestContext?: RequestContext;
  correlationId?: string;
};

/**
 * Dual-path access for the sync surface (EPIC-21 / F21.1, no fail-open):
 * - `x-device-token` present -> device path: opaque token authenticates the
 *   enrolled gateway; facility is implied by the token (optional
 *   `x-facility-id` cross-check, mismatch -> 403 DEVICE_FACILITY_MISMATCH).
 * - absent -> staff/demo path: full TenantContextGuard + AuthorizationGuard
 *   (unchanged default-deny behavior).
 * Unknown/suspended/decommissioned tokens are hard 401/403; a valid device
 * token intentionally bypasses staff privileges (service identity scoped by
 * the enrollment capability matrix enforced in the service layer).
 */
@Injectable()
export class SyncAccessGuard implements CanActivate {
  constructor(
    private readonly tenant: TenantContextGuard,
    private readonly authz: AuthorizationGuard,
    private readonly devices: DeviceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const raw = req.headers['x-device-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      this.tenant.canActivate(context);
      return this.authz.canActivate(context);
    }
    let device: Device;
    if (!process.env.DATABASE_URL) {
      if (token !== 'pulse-dev-device') {
        throw new UnauthorizedException({
          code: 'DEVICE_TOKEN_INVALID',
          message: 'Unknown device token',
        });
      }
      const facHeader = singleHeader(req, FACILITY_HEADER);
      device = {
        id: 'dev-device',
        organizationId: 'dev-org',
        facilityId: '00000000-0000-0000-4000-000000000000',
        name: 'dev-edge',
        kind: 'edge-gateway',
        status: 'active',
        capabilities: ['*'],
        maxDisconnectedHours: 72,
        enrolledAt: new Date().toISOString(),
      };
      if (facHeader && !UUID_RE.test(facHeader)) {
        throw new ForbiddenException({
          code: 'FACILITY_CONTEXT_INVALID',
          message: 'x-facility-id must be a UUID when present',
        });
      }
    } else {
      device = await this.devices.authenticate(token);
    }
    const facilityHeader = singleHeader(req, FACILITY_HEADER);
    if (facilityHeader && facilityHeader !== device.facilityId) {
      throw new ForbiddenException({
        code: 'DEVICE_FACILITY_MISMATCH',
        message: 'x-facility-id does not match the device facility',
      });
    }
    const ctx: RequestContext = {
      correlationId: req.correlationId ?? 'unknown',
      tenantId: device.organizationId,
      facilityId: device.facilityId,
    };
    requestContextStorage.enterWith(ctx);
    req.requestContext = ctx;
    req.edgeDevice = device;
    return true;
  }
}

function singleHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
