import {
  capabilityStatement,
  encounterStatusToFhir,
  pulseSexToFhirGender,
  toFhirAllergyIntolerance,
  toFhirCondition,
  toFhirObservation,
  toFhirPatient,
} from './translate.js';

describe('FHIR translation (pure)', () => {
  it('maps Pulse sex to FHIR gender', () => {
    expect(pulseSexToFhirGender('M')).toBe('male');
    expect(pulseSexToFhirGender('F')).toBe('female');
    expect(pulseSexToFhirGender('O')).toBe('other');
    expect(pulseSexToFhirGender('U')).toBe('unknown');
    expect(pulseSexToFhirGender('???')).toBe('unknown');
  });

  it('translates a patient with namespaced identifiers', () => {
    const fhir = toFhirPatient({
      id: 'p1',
      familyName: 'Doe',
      givenName: 'Jane',
      dateOfBirth: '1990-01-01',
      sex: 'F',
      identifiers: [{ system: 'urn:pulse:mrn:f1', value: 'M1' }],
    });
    expect(fhir).toMatchObject({
      resourceType: 'Patient',
      id: 'p1',
      gender: 'female',
      birthDate: '1990-01-01',
    });
  });

  it('passes observation values through without guessing', () => {
    const num = toFhirObservation(
      { code: 'BP_SYS', valueNum: 130, unit: 'mmHg', takenAt: '2026-01-01T00:00:00.000Z', patientId: 'p' },
      'o1',
    );
    expect(num).toMatchObject({ valueQuantity: { value: 130, unit: 'mmHg' } });
    const txt = toFhirObservation(
      { code: 'NOTE', valueText: 'free text', takenAt: '2026-01-01T00:00:00.000Z', patientId: 'p' },
      'o2',
    );
    expect(txt).toMatchObject({ valueString: 'free text' });
  });

  it('maps encounter statuses', () => {
    expect(encounterStatusToFhir('open')).toBe('arrived');
    expect(encounterStatusToFhir('admitted')).toBe('in-progress');
    expect(encounterStatusToFhir('discharged')).toBe('finished');
    expect(encounterStatusToFhir('cancelled')).toBe('cancelled');
  });

  it('declares R4 CapabilityStatement with reads and approved creates', () => {
    const cs = capabilityStatement() as {
      fhirVersion: string;
      rest: { resource: { type: string; interaction: { code: string }[] }[] }[];
    };
    expect(cs.fhirVersion).toBe('4.0.1');
    expect(cs.rest[0]?.resource.map((r) => r.type).sort()).toEqual([
      'AllergyIntolerance',
      'Condition',
      'Encounter',
      'Observation',
      'Patient',
    ]);
    const types = cs.rest[0]?.resource ?? [];
    const creating = types
      .filter((r) => r.interaction.some((i) => i.code === 'create'))
      .map((r) => r.type)
      .sort();
    expect(creating).toEqual(['AllergyIntolerance', 'Condition', 'Observation']);
  });

  it('tags externally imported resources with provenance meta', () => {
    const ext = toFhirCondition({
      id: 'c1',
      patientId: 'p',
      display: 'Asthma',
      code: 'X1',
      origin: 'external',
    });
    expect(ext['meta']).toEqual({ source: 'urn:pulse:origin:external' });
    const local = toFhirCondition({ id: 'c2', patientId: 'p', display: 'Asthma' });
    expect(local['meta']).toBeUndefined();
    const allergy = toFhirAllergyIntolerance({
      id: 'a1',
      patientId: 'p',
      display: 'Peanut',
      origin: 'external',
    });
    expect(allergy).toMatchObject({
      resourceType: 'AllergyIntolerance',
      meta: { source: 'urn:pulse:origin:external' },
    });
  });
});
