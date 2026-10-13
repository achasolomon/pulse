import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AUDIT_KEY, type AuditedOptions } from './audited.decorator.js';
import { AuditService } from './audit.service.js';

/**
 * Records audit evidence for @Audited() handlers on success only.
 * Metadata carries resource ids, never clinical narrative (PRIV-001 minimum-necessary).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<AuditedOptions | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!opts) return next.handle();
    const req = context
      .switchToHttp()
      .getRequest<
        Request & {
          requestContext?: {
            tenantId?: string;
            facilityId?: string;
            correlationId?: string;
            breakGlass?: boolean;
            breakGlassReason?: string;
          };
        }
      >();
    const ctx = req.requestContext;
    return next.handle().pipe(
      tap({
        next: () => {
          void this.audit.record({
            action: opts.action,
            resourceType: opts.resourceType,
            tenantId: ctx?.tenantId,
            facilityId: ctx?.facilityId,
            correlationId: ctx?.correlationId,
            ...(ctx?.breakGlass
              ? { metadata: { breakGlass: true, reason: ctx.breakGlassReason ?? '' } }
              : {}),
          });
        },
      }),
    );
  }
}
