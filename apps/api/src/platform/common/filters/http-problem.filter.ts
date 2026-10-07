import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_HEADER } from '../types/request-context.js';

interface ProblemDetails {
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  correlationId?: string;
  errors?: Record<string, string[]>;
}

/**
 * Consistent API error model per PULSE-API-001 §8.
 * Never echoes request bodies (no PHI in errors/logs).
 */
@Catch()
export class HttpProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId =
      (req as Request & { correlationId?: string }).correlationId ??
      (req.headers[CORRELATION_HEADER] as string | undefined);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail: string | undefined;
    let code: string | undefined;
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        detail = status >= 500 ? undefined : body;
        title = this.defaultTitle(status);
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        title =
          typeof b['error'] === 'string'
            ? (b['error'] as string)
            : this.defaultTitle(status);
        if (typeof b['message'] === 'string' && status < 500) {
          detail = b['message'] as string;
        } else if (Array.isArray(b['message']) && status < 500) {
          errors = { validation: (b['message'] as unknown[]).map(String) };
          detail = 'Validation failed';
        }
        if (typeof b['code'] === 'string') code = b['code'] as string;
      }
    } else {
      this.logger.error(
        `Unhandled error [${correlationId ?? 'no-correlation'}]: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
      );
    }

    const problem: ProblemDetails = {
      title,
      status,
      ...(detail ? { detail } : {}),
      instance: req.path,
      ...(code ? { code } : {}),
      ...(correlationId ? { correlationId } : {}),
      ...(errors ? { errors } : {}),
    };
    res.status(status).json(problem);
  }

  private defaultTitle(status: number): string {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Unprocessable Entity';
      case 429:
        return 'Too Many Requests';
      default:
        return status >= 500 ? 'Internal Server Error' : 'Request Failed';
    }
  }
}
