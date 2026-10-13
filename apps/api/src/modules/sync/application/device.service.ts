import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { OutboxService } from '../../../platform/outbox/outbox.service.js';
import {
  DEVICE_REPOSITORY,
  deviceStatusAction,
  deviceWindowExceeded,
  generateDeviceToken,
  hashDeviceToken,
  validateCapabilities,
  type Device,
  type DeviceKind,
  type DeviceRepository,
} from '../domain/device.repository.js';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/;
const KINDS = new Set<DeviceKind>(['edge-gateway', 'branch-server', 'kiosk']);

/**
 * Edge device lifecycle (EPIC-21 / F21.1). Tokens are opaque, hashed at
 * rest, shown once at enroll. No fail-open: unknown/suspended/decommissioned
 * tokens are hard rejections at the guard.
 */
@Injectable()
export class DeviceService {
  constructor(
    @Inject(DEVICE_REPOSITORY) private readonly repo: DeviceRepository,
    private readonly outbox: OutboxService,
  ) {}

  async enroll(input: {
    facilityId: string;
    name: string;
    kind?: string;
    capabilities: string[];
    maxDisconnectedHours?: number;
    correlationId?: string;
  }): Promise<{ device: Device; apiKey: string }> {
    if (!NAME_RE.test(input.name ?? '')) {
      throw new BadRequestException({
        code: 'DEVICE_NAME_INVALID',
        message: 'name must be 2-64 chars (letters, digits, space, _ -)',
      });
    }
    const kind = (input.kind ?? 'edge-gateway') as DeviceKind;
    if (!KINDS.has(kind)) {
      throw new BadRequestException({
        code: 'DEVICE_KIND_INVALID',
        message: 'kind must be edge-gateway|branch-server|kiosk',
      });
    }
    try {
      validateCapabilities(input.capabilities);
    } catch {
      throw new BadRequestException({
        code: 'DEVICE_CAPABILITIES_INVALID',
        message:
          'capabilities must be 1-50 entries: exact type, "prefix.", or "*" (approved local data subset)',
      });
    }
    const maxDisconnectedHours = input.maxDisconnectedHours ?? 72;
    if (!Number.isInteger(maxDisconnectedHours) || maxDisconnectedHours < 1 || maxDisconnectedHours > 8760) {
      throw new BadRequestException({
        code: 'DEVICE_WINDOW_INVALID',
        message: 'maxDisconnectedHours must be an integer between 1 and 8760',
      });
    }
    const { raw, hash } = generateDeviceToken();
    let device: Device;
    try {
      device = await this.repo.create({
        facilityId: input.facilityId,
        name: input.name,
        kind,
        capabilities: input.capabilities,
        maxDisconnectedHours,
        tokenHash: hash,
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'DEVICE_NAME_TAKEN',
          message: 'A device with this name is already enrolled at this facility',
        });
      }
      throw err;
    }
    await this.outbox.publish({
      aggregateType: 'edge_device',
      aggregateId: device.id,
      type: 'sync.device_enrolled',
      producer: 'sync',
      correlationId: input.correlationId,
      payload: {
        deviceId: device.id,
        facilityId: device.facilityId,
        kind: device.kind,
        capabilities: device.capabilities,
      },
    });
    return { device, apiKey: raw };
  }

  async list(facilityId?: string) {
    const devices = await this.repo.list(facilityId);
    return devices.map((d) => ({
      ...d,
      windowExceeded: deviceWindowExceeded(d),
      degraded: deviceWindowExceeded(d),
    }));
  }

  async get(id: string) {
    const device = await this.repo.findById(id);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Unknown device id' });
    }
    return {
      ...device,
      windowExceeded: deviceWindowExceeded(device),
      degraded: deviceWindowExceeded(device),
    };
  }

  async setStatusAction(
    id: string,
    action: 'suspend' | 'resume' | 'decommission',
    opts: { correlationId?: string } = {},
  ) {
    const device = await this.repo.findById(id);
    if (!device) {
      throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Unknown device id' });
    }
    const next = deviceStatusAction(device.status, action);
    if (!next) {
      throw new ConflictException({
        code: 'DEVICE_TRANSITION',
        message: `Cannot ${action} a device in status ${device.status}`,
      });
    }
    await this.repo.setStatus(id, next);
    const updated = { ...device, status: next };
    await this.outbox.publish({
      aggregateType: 'edge_device',
      aggregateId: id,
      type: `sync.device_${action === 'resume' ? 'resumed' : action === 'suspend' ? 'suspended' : 'decommissioned'}`,
      producer: 'sync',
      correlationId: opts.correlationId,
      payload: { deviceId: id, facilityId: device.facilityId, status: next },
    });
    return updated;
  }

  async heartbeat(
    device: Device,
    input: { pendingOut?: number; pendingIn?: number; lastSyncAt?: string },
  ) {
    const pendingOut = intOr(input.pendingOut, 0, 'pendingOut');
    const pendingIn = intOr(input.pendingIn, 0, 'pendingIn');
    let lastSyncAt: string | undefined;
    if (input.lastSyncAt !== undefined) {
      const t = Date.parse(input.lastSyncAt);
      if (Number.isNaN(t)) {
        throw new BadRequestException({
          code: 'HEARTBEAT_INVALID',
          message: 'lastSyncAt must be an ISO timestamp',
        });
      }
      lastSyncAt = new Date(t).toISOString();
    }
    // Reconnect fact computed from the PRIOR last_seen (before this beat).
    const windowExceeded = deviceWindowExceeded(device);
    const at = new Date();
    await this.repo.recordHeartbeat(device.id, {
      pendingOut,
      pendingIn,
      ...(lastSyncAt ? { lastSyncAt } : {}),
      at,
    });
    return {
      deviceId: device.id,
      facilityId: device.facilityId,
      status: device.status,
      acceptedAt: at.toISOString(),
      windowExceeded,
    };
  }

  /** Guard-facing authentication: 401 unknown token, 403 unusable device. */
  async authenticate(rawToken: string): Promise<Device> {
    const device = await this.repo.findByTokenHash(hashDeviceToken(rawToken));
    if (!device) {
      throw new UnauthorizedException({
        code: 'DEVICE_TOKEN_INVALID',
        message: 'Unknown device token',
      });
    }
    if (device.status === 'suspended') {
      throw new ForbiddenException({
        code: 'DEVICE_SUSPENDED',
        message: 'Device is suspended',
      });
    }
    if (device.status === 'decommissioned') {
      throw new ForbiddenException({
        code: 'DEVICE_DECOMMISSIONED',
        message: 'Device is decommissioned',
      });
    }
    return device;
  }
}

function intOr(v: number | undefined, fallback: number, field: string): number {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v < 0 || v > 1_000_000) {
    throw new BadRequestException({
      code: 'HEARTBEAT_INVALID',
      message: `${field} must be an integer between 0 and 1000000`,
    });
  }
  return v;
}
