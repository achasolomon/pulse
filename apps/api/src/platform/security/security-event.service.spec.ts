import {
  actorFromHeaders,
  classifySecurityFailure,
} from './security-event.service.js';

describe('classifySecurityFailure (pure)', () => {
  it('401s: session rejections high; partner/device classified; generic medium authn', () => {
    expect(classifySecurityFailure(401, 'STAFF_SESSION_INVALID')).toMatchObject({
      category: 'authn',
      severity: 'high',
    });
    expect(classifySecurityFailure(401, 'PARTNER_UNKNOWN')).toMatchObject({
      category: 'integration',
      severity: 'medium',
    });
    expect(classifySecurityFailure(401, 'DEVICE_TOKEN_INVALID')).toMatchObject({
      category: 'device',
      severity: 'medium',
    });
    expect(classifySecurityFailure(401)).toMatchObject({
      category: 'authn',
      severity: 'medium',
    });
  });

  it('403s: break-glass high; device denials high; ACCESS_DENIED medium; context low', () => {
    expect(classifySecurityFailure(403, 'BREAK_GLASS_REASON_REQUIRED')).toMatchObject({
      category: 'break_glass',
      severity: 'high',
    });
    expect(classifySecurityFailure(403, 'DEVICE_FACILITY_MISMATCH')).toMatchObject({
      category: 'device',
      severity: 'high',
    });
    expect(classifySecurityFailure(403, 'ACCESS_DENIED')).toMatchObject({
      category: 'authz',
      severity: 'medium',
    });
    expect(classifySecurityFailure(403, 'TENANT_CONTEXT_REQUIRED')).toMatchObject({
      category: 'authz',
      severity: 'low',
    });
  });

  it('429 is abuse/medium; routine statuses are not classified (no SIEM noise)', () => {
    expect(classifySecurityFailure(429)).toMatchObject({
      category: 'abuse',
      severity: 'medium',
    });
    expect(classifySecurityFailure(400, 'VALIDATION')).toBeUndefined();
    expect(classifySecurityFailure(404, 'PATIENT_NOT_FOUND')).toBeUndefined();
    expect(classifySecurityFailure(409, 'POSSIBLE_DUPLICATE')).toBeUndefined();
    expect(classifySecurityFailure(500)).toBeUndefined();
  });
});

describe('actorFromHeaders (pure)', () => {
  it('derives actor without recording tokens or PHI', () => {
    expect(
      actorFromHeaders({ 'x-demo-person': 'dr-house', 'x-facility-id': '00000000-0000-4000-8000-000000000002' }),
    ).toEqual({
      actorType: 'person',
      actorId: 'dr-house',
      facilityId: '00000000-0000-4000-8000-000000000002',
    });
    expect(actorFromHeaders({ 'x-device-token': 'pdev_secret' })).toEqual({
      actorType: 'device',
      actorId: 'device-token',
      facilityId: undefined,
    });
    expect(actorFromHeaders({ 'x-api-key': 'pulse_key' })).toMatchObject({
      actorType: 'partner',
      actorId: 'partner-key',
    });
    expect(actorFromHeaders({ authorization: 'Bearer staff_abc' })).toMatchObject({
      actorType: 'person',
      actorId: 'staff-session',
    });
    expect(actorFromHeaders({})).toEqual({
      actorType: 'unknown',
      actorId: undefined,
      facilityId: undefined,
    });
    // Facility must be a UUID or it is dropped.
    expect(actorFromHeaders({ 'x-facility-id': 'not-a-uuid' }).facilityId).toBeUndefined();
  });
});
