import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { metricsRegistry } from './metrics.registry.js';

/** Records handler-level latency + status into the in-memory registry. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const handler = `${context.getClass().name}.${String(context.getHandler().name)}`;
    return next.handle().pipe(
      tap({
        next: () => this.record(context, 200, started, handler),
        error: (err: unknown) => {
          const status =
            typeof err === 'object' && err !== null && 'status' in err
              ? Number((err as { status: unknown }).status) || 500
              : 500;
          this.record(context, status, started, handler);
        },
      }),
    );
  }

  private record(
    context: ExecutionContext,
    status: number,
    started: number,
    handler: string,
  ): void {
    try {
      const req = context.switchToHttp().getRequest<Request>();
      metricsRegistry.observe({
        handler,
        method: req.method,
        status,
        durationMs: Date.now() - started,
      });
      void context.switchToHttp().getResponse<Response>();
    } catch {
      // Metrics must never break a clinical request.
    }
  }
}
