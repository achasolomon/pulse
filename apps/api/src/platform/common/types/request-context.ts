export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  facilityId?: string;
  userId?: string;
}

export const CORRELATION_HEADER = 'x-correlation-id';
