import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'pulse:audit';

export interface AuditedOptions {
  action: string;
  resourceType: string;
}

export const Audited = (options: AuditedOptions) =>
  SetMetadata(AUDIT_KEY, options);
