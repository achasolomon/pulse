import {
  deviceStatusAction,
  deviceWindowExceeded,
  eventTypeAllowed,
  generateDeviceToken,
  hashDeviceToken,
  validateCapabilities,
} from './device.repository.js';

describe('device domain pure guards', () => {
  it('eventTypeAllowed: exact, prefix., *, default deny', () => {
    expect(eventTypeAllowed(['*'], 'anything.at.all')).toBe(true);
    expect(eventTypeAllowed(['observation.recorded'], 'observation.recorded')).toBe(true);
    expect(eventTypeAllowed(['observation.recorded'], 'observation.other')).toBe(false);
    expect(eventTypeAllowed(['clin.'], 'clin.note_signed')).toBe(true);
    expect(eventTypeAllowed(['clin.'], 'patient.registered')).toBe(false);
    expect(eventTypeAllowed(['patient.', 'observation.'], 'observation.recorded')).toBe(true);
    expect(eventTypeAllowed([], 'patient.registered')).toBe(false);
    // 'clin.' is not a prefix of 'clinician.x' events unless explicitly typed
    expect(eventTypeAllowed(['observation.'], 'observation')).toBe(false);
  });

  it('deviceStatusAction: state machine, decommission terminal', () => {
    expect(deviceStatusAction('active', 'suspend')).toBe('suspended');
    expect(deviceStatusAction('suspended', 'resume')).toBe('active');
    expect(deviceStatusAction('active', 'decommission')).toBe('decommissioned');
    expect(deviceStatusAction('suspended', 'decommission')).toBe('decommissioned');
    expect(deviceStatusAction('active', 'resume')).toBeUndefined();
    expect(deviceStatusAction('suspended', 'suspend')).toBeUndefined();
    expect(deviceStatusAction('decommissioned', 'resume')).toBeUndefined();
    expect(deviceStatusAction('decommissioned', 'suspend')).toBeUndefined();
    expect(deviceStatusAction('decommissioned', 'decommission')).toBeUndefined();
  });

  it('deviceWindowExceeded: never-seen not exceeded; window by hours', () => {
    const now = new Date('2026-10-12T12:00:00Z');
    expect(deviceWindowExceeded({ maxDisconnectedHours: 72 }, now)).toBe(false);
    expect(
      deviceWindowExceeded(
        { lastSeenAt: '2026-10-12T10:00:00Z', maxDisconnectedHours: 72 },
        now,
      ),
    ).toBe(false);
    expect(
      deviceWindowExceeded(
        { lastSeenAt: '2026-10-01T10:00:00Z', maxDisconnectedHours: 72 },
        now,
      ),
    ).toBe(true);
    // Exactly at the boundary is still inside (strictly greater than).
    expect(
      deviceWindowExceeded(
        { lastSeenAt: '2026-10-09T12:00:00Z', maxDisconnectedHours: 72 },
        now,
      ),
    ).toBe(false);
    expect(
      deviceWindowExceeded(
        { lastSeenAt: '2026-10-09T11:59:59Z', maxDisconnectedHours: 72 },
        now,
      ),
    ).toBe(true);
  });

  it('device tokens: raw shown once, hash is sha256 and stable', () => {
    const { raw, hash } = generateDeviceToken();
    expect(raw.startsWith('pdev_')).toBe(true);
    expect(raw.length).toBe(5 + 48);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceToken(raw)).toBe(hash);
    expect(hashDeviceToken('pdev_other')).not.toBe(hash);
  });

  it('validateCapabilities: bounds and shapes', () => {
    expect(() => validateCapabilities(['patient.', '*'])).not.toThrow();
    expect(() => validateCapabilities([])).toThrow('DEVICE_CAPABILITIES_INVALID');
    expect(() => validateCapabilities([''])).toThrow('DEVICE_CAPABILITIES_INVALID');
    expect(() => validateCapabilities(['ok', '  '])).toThrow('DEVICE_CAPABILITIES_INVALID');
    expect(() => validateCapabilities(['x'.repeat(101)])).toThrow('DEVICE_CAPABILITIES_INVALID');
    expect(() => validateCapabilities(Array.from({ length: 51 }, () => 'a.'))).toThrow(
      'DEVICE_CAPABILITIES_INVALID',
    );
  });
});
