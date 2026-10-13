import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../types/request-context.js';

export const CurrentContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext | undefined => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { requestContext?: RequestContext }>();
    return req.requestContext;
  },
);
