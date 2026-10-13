import { createHash, randomBytes } from 'node:crypto';

/** Edge device runtime domain (EPIC-21 / F21.1). */

export type DeviceStatus = 'active' | 'suspended' | 'decommissioned';
export type DeviceKind = 'edge-gateway' | 'branch-server' | 'kiosk';

export interface Device {
  id: string;
  organizationId: string;
  facilityId: string;
  name: string;
  kind: DeviceKind;
  status: DeviceStatus;
  capabilities: string[];
  maxDisconnectedHours: number;
  lastSeenAt?: string;
  enrolledAt: string;
  decommissionedAt?: string;
}

export interface DeviceHeartbeat {
  pendingOut: number;
  pendingIn: number;
  lastSyncAt?: string;
}

export const DEVICE_REPOSITORY = 'DEVICE_REPOSITORY';

export interface DeviceRepository {
  create(input: {
    facilityId: string;
    name: string;
    kind: DeviceKind;
    capabilities: string[];
    maxDisconnectedHours: number;
    tokenHash: string;
  }): Promise<Device>;
  findById(id: string): Promise<Device | undefined>;
  findByTokenHash(tokenHash: string): Promise<Device | undefined>;
  list(facilityId?: string): Promise<Device[]>;
  setStatus(
    id: string,
    status: DeviceStatus,
    at?: Date,
  ): Promise<void>;
  recordHeartbeat(
    id: string,
    heartbeat: DeviceHeartbeat & { at: Date },
  ): Promise<void>;
}

/** Capability check: exact type, `prefix.` (trailing dot), or `*`. Default deny. */
export function eventTypeAllowed(capabilities: string[], type: string): boolean {
  return capabilities.some((c) =>
    c === '*' ? true : c.endsWith('.') ? type.startsWith(c) : type === c,
  );
}

/** Device status state machine. Decommission is terminal. */
export function deviceStatusAction(
  status: DeviceStatus,
  action: 'suspend' | 'resume' | 'decommission',
): DeviceStatus | undefined {
  switch (action) {
    case 'suspend':
      return status === 'active' ? 'suspended' : undefined;
    case 'resume':
      return status === 'suspended' ? 'active' : undefined;
    case 'decommission':
      return status === 'decommissioned' ? undefined : 'decommissioned';
    default:
      return undefined;
  }
}

/**
 * Disconnect window per ARCH-001 section 574: a device is outside its
 * approved window when last_seen is older than max_disconnected_hours.
 * A never-seen device (freshly enrolled) is not yet outside the window.
 */
export function deviceWindowExceeded(
  device: { lastSeenAt?: string; maxDisconnectedHours: number },
  now: Date = new Date(),
): boolean {
  if (!device.lastSeenAt) return false;
  const seen = Date.parse(device.lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return now.getTime() - seen > device.maxDisconnectedHours * 3_600_000;
}

export function generateDeviceToken(): { raw: string; hash: string } {
  const raw = `pdev_${randomBytes(24).toString('hex')}`;
  return { raw, hash: hashDeviceToken(raw) };
}

export function hashDeviceToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Capability validation at enroll: non-empty, bounded, sane shapes. */
export function validateCapabilities(capabilities: string[]): void {
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.length > 50) {
    throw new Error('DEVICE_CAPABILITIES_INVALID');
  }
  for (const c of capabilities) {
    if (typeof c !== 'string' || c.trim().length === 0 || c.length > 100) {
      throw new Error('DEVICE_CAPABILITIES_INVALID');
    }
  }
}
