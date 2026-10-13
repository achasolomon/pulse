import {
  FhirWriteError,
  fingerprint,
  parseAllergyIntolerance,
  parseCondition,
  parseObservation,
} from './from-fhir.js';

const PID = '11111111-1111-4111-8111-111111111111';
const EID = '22222222-2222-4222-8222-222222222222';

describe('from-fhir (pure inbound writes)', () => {
  it('parses a Condition with coding, status and encounter', () => {
    const parsed = parseCondition({
      resourceType: 'Condition',
      subject: { reference: `Patient/${PID}` },
      context: { encounter: { reference: `Encounter/${EID}` } },
      clinicalStatus: { coding: [{ code: 'resolved' }] },
      code: { coding: [{ code: '111810001', display: 'Asthma' }], text: 'Asthma (childhood)' },
    });
    expect(parsed).toEqual({
      patientId: PID,
      encounterId: EID,
      code: '111810001',
      display: 'Asthma (childhood)',
      status: 'resolved',
    });
  });

  it('rejects a Condition without subject, wrong resourceType or no code', () => {
    expect(() => parseCondition({ resourceType: 'Condition' })).toThrow(FhirWriteError);
    expect(() => parseCondition({ resourceType: 'Observation' })).toThrow('resourceType');
    expect(() =>
      parseCondition({ resourceType: 'Condition', subject: { reference: `Patient/${PID}` } }),
    ).toThrow('Condition.code');
  });

  it('never guesses a display: falls back to the verbatim code', () => {
    const parsed = parseCondition({
      resourceType: 'Condition',
      subject: { reference: `Patient/${PID}` },
      code: { coding: [{ code: 'XYZ-1' }] },
    });
    expect(parsed.code).toBe('XYZ-1');
    expect(parsed.display).toBe('XYZ-1');
  });

  it('requires a UUID reference (identity never guessed)', () => {
    expect(() =>
      parseCondition({
        resourceType: 'Condition',
        subject: { reference: 'Patient/mrn-123' },
        code: { text: 'x' },
      }),
    ).toThrow('UUID');
  });

  it('parses AllergyIntolerance as an allergy entry', () => {
    const parsed = parseAllergyIntolerance({
      resourceType: 'AllergyIntolerance',
      subject: { reference: `Patient/${PID}` },
      code: { text: 'Peanut' },
    });
    expect(parsed).toEqual({ patientId: PID, encounterId: undefined, code: undefined, display: 'Peanut' });
  });

  it('parses Observation with valueQuantity and effectiveDateTime', () => {
    const parsed = parseObservation({
      resourceType: 'Observation',
      subject: { reference: `Patient/${PID}` },
      code: { coding: [{ code: '8480-6' }], text: 'Systolic BP' },
      valueQuantity: { value: 120, unit: 'mmHg' },
      effectiveDateTime: '2026-10-01T08:30:00Z',
    });
    expect(parsed).toEqual({
      patientId: PID,
      encounterId: undefined,
      code: 'Systolic BP',
      valueNum: 120,
      unit: 'mmHg',
      takenAt: '2026-10-01T08:30:00.000Z',
    });
  });

  it('parses Observation with valueString', () => {
    const parsed = parseObservation({
      resourceType: 'Observation',
      subject: { reference: `Patient/${PID}` },
      code: { text: 'NOTE' },
      valueString: 'patient reports relief',
    });
    expect(parsed.valueText).toBe('patient reports relief');
    expect(parsed.valueNum).toBeUndefined();
  });

  it('rejects missing/duplicated/unsupported values and bad dates', () => {
    const base = {
      resourceType: 'Observation',
      subject: { reference: `Patient/${PID}` },
      code: { text: 'X' },
    };
    expect(() => parseObservation(base)).toThrow('value[x]');
    expect(() =>
      parseObservation({ ...base, valueQuantity: { value: 1 }, valueString: 'x' }),
    ).toThrow('exactly one');
    expect(() => parseObservation({ ...base, valueQuantity: { value: '12' } })).toThrow('finite');
    expect(() => parseObservation({ ...base, valueString: 'ok', effectiveDateTime: 'nope' })).toThrow(
      'date-time',
    );
  });

  it('fingerprints are key-order stable and payload sensitive', () => {
    const a = fingerprint({ b: 1, a: { d: 2, c: 3 } });
    const b = fingerprint({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(fingerprint({ b: 2, a: { c: 3, d: 2 } })).not.toBe(a);
  });
});
