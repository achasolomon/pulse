import { AsyncLocalStorage } from 'node:async_hooks';

export interface PortalContext {
  sessionId: string;
  accountId: string;
  actingPatientId: string;
  scopes: string[];
  proxyAccountId?: string;
}

export const portalContextStorage = new AsyncLocalStorage<PortalContext>();

export function currentPortalContext(): PortalContext | undefined {
  return portalContextStorage.getStore();
}
