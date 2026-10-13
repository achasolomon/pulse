import { Controller, Get, UseGuards } from '@nestjs/common';
import { Audited } from '../../../platform/audit/audited.decorator.js';
import { CurrentContext } from '../../../platform/common/decorators/context.js';
import { TenantContextGuard } from '../../../platform/common/guards/tenant-context.guard.js';
import type { RequestContext } from '../../../platform/common/types/request-context.js';
import { AuthorizationGuard } from './authorization.guard.js';
import { RequirePrivilege } from './require-privilege.decorator.js';

/**
 * Sprint 02 demonstration endpoint (not clinical).
 * Chain: TenantContextGuard -> AuthorizationGuard; audited on success.
 * Demo privilege contract: x-demo-privileges must include "patient:read".
 */
@Controller('secure')
export class SecureExampleController {
  @Get('ping')
  @UseGuards(TenantContextGuard, AuthorizationGuard)
  @RequirePrivilege({ action: 'read', resourceType: 'patient' })
  @Audited({ action: 'secure.ping', resourceType: 'secure' })
  ping(@CurrentContext() ctx?: RequestContext): {
    ok: boolean;
    tenantId?: string;
    facilityId?: string;
  } {
    return {
      ok: true,
      tenantId: ctx?.tenantId,
      facilityId: ctx?.facilityId,
    };
  }
}
