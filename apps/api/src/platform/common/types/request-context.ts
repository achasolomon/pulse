import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  correlationId: string;
  tenantId?: string;
  facilityId?: string;
  userId?: string;
  patientId?: string;
  departmentId?: string;
  purpose?: string;
  breakGlass?: boolean;
  breakGlassReason?: string;
}

export const CORRELATION_HEADER = 'x-correlation-id';
export const TENANT_HEADER = 'x-tenant-id';
export const FACILITY_HEADER = 'x-facility-id';
export const BREAK_GLASS_HEADER = 'x-break-glass-reason';
export const PATIENT_HEADER = 'x-patient-id';
export const DEPARTMENT_HEADER = 'x-department-id';
export const PURPOSE_HEADER = 'x-purpose';

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
