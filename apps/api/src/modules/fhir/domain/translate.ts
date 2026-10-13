/**
 * FHIR R4 translation (FHIR-001). Pure functions, unit-tested.
 * Internal models stay domain-native; only these mappers know FHIR shapes.
 * Unknown/unmapped codes pass through as text — never guessed.
 */

export function pulseSexToFhirGender(sex: string): 'male' | 'female' | 'other' | 'unknown' {
  if (sex === 'M') return 'male';
  if (sex === 'F') return 'female';
  if (sex === 'O') return 'other';
  return 'unknown';
}

export interface DomainPatientSummary {
  id: string;
  familyName: string;
  givenName: string;
  dateOfBirth: string;
  sex: string;
  identifiers: { system: string; value: string }[];
}

export function toFhirPatient(p: DomainPatientSummary): Record<string, unknown> {
  return {
    resourceType: 'Patient',
    id: p.id,
    identifier: p.identifiers.map((i) => ({ system: i.system, value: i.value })),
    name: [{ family: p.familyName, given: [p.givenName] }],
    gender: pulseSexToFhirGender(p.sex),
    birthDate: p.dateOfBirth,
  };
}

export interface DomainObservation {
  id?: string;
  code: string;
  valueNum?: number;
  valueText?: string;
  unit?: string;
  takenAt: string;
  patientId: string;
  origin?: string;
}

export function toFhirObservation(o: DomainObservation, id: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    resourceType: 'Observation',
    id,
    status: 'final',
    code: { text: o.code },
    subject: { reference: `Patient/${o.patientId}` },
    effectiveDateTime: o.takenAt,
    ...(o.origin === 'external'
      ? { meta: { source: 'urn:pulse:origin:external' } }
      : {}),
  };
  if (o.valueNum !== undefined) {
    base['valueQuantity'] = {
      value: o.valueNum,
      ...(o.unit ? { unit: o.unit } : {}),
    };
  } else if (o.valueText) {
    base['valueString'] = o.valueText;
  }
  return base;
}

export interface DomainEntry {
  id?: string;
  patientId: string;
  encounterId?: string;
  code?: string;
  display: string;
  status?: string;
  origin?: string;
}

function withExternalMeta(base: Record<string, unknown>, origin?: string): Record<string, unknown> {
  if (origin === 'external') base['meta'] = { source: 'urn:pulse:origin:external' };
  return base;
}

export function toFhirCondition(e: DomainEntry): Record<string, unknown> {
  return withExternalMeta(
    {
      resourceType: 'Condition',
      ...(e.id ? { id: e.id } : {}),
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: e.status === 'resolved' ? 'resolved' : 'active',
          },
        ],
      },
      code: {
        ...(e.code ? { coding: [{ code: e.code }] } : {}),
        text: e.display,
      },
      subject: { reference: `Patient/${e.patientId}` },
      ...(e.encounterId ? { context: { reference: `Encounter/${e.encounterId}` } } : {}),
    },
    e.origin,
  );
}

export function toFhirAllergyIntolerance(e: DomainEntry): Record<string, unknown> {
  return withExternalMeta(
    {
      resourceType: 'AllergyIntolerance',
      ...(e.id ? { id: e.id } : {}),
      patient: { reference: `Patient/${e.patientId}` },
      code: {
        ...(e.code ? { coding: [{ code: e.code }] } : {}),
        text: e.display,
      },
      ...(e.encounterId ? { context: { encounter: { reference: `Encounter/${e.encounterId}` } } } : {}),
    },
    e.origin,
  );
}

export interface DomainEncounter {
  id: string;
  patientId: string;
  type: string;
  status: string;
}

export function encounterStatusToFhir(status: string): string {
  if (status === 'open') return 'arrived';
  if (status === 'admitted') return 'in-progress';
  if (status === 'discharged') return 'finished';
  if (status === 'cancelled') return 'cancelled';
  return 'unknown';
}

export function toFhirEncounter(e: DomainEncounter): Record<string, unknown> {
  return {
    resourceType: 'Encounter',
    id: e.id,
    status: encounterStatusToFhir(e.status),
    class: { code: e.type },
    subject: { reference: `Patient/${e.patientId}` },
  };
}

export function capabilityStatement(): Record<string, unknown> {
  return {
    resourceType: 'CapabilityStatement',
    id: 'pulse-gateway',
    status: 'active',
    date: new Date().toISOString().slice(0, 10),
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    implementation: { description: 'Pulse FHIR gateway (reads + approved writes, ADR-005 boundary)' },
    rest: [
      {
        mode: 'server',
        resource: [
          {
            type: 'Patient',
            profile: 'http://hl7.org/fhir/StructureDefinition/Patient',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [{ name: 'identifier', type: 'token' }],
          },
          {
            type: 'Observation',
            profile: 'http://hl7.org/fhir/StructureDefinition/Observation',
            interaction: [{ code: 'search-type' }, { code: 'create' }],
            searchParam: [{ name: 'patient', type: 'reference' }],
          },
          {
            type: 'Encounter',
            profile: 'http://hl7.org/fhir/StructureDefinition/Encounter',
            interaction: [{ code: 'read' }],
          },
          {
            type: 'Condition',
            profile: 'http://hl7.org/fhir/StructureDefinition/Condition',
            interaction: [{ code: 'create' }],
          },
          {
            type: 'AllergyIntolerance',
            profile: 'http://hl7.org/fhir/StructureDefinition/AllergyIntolerance',
            interaction: [{ code: 'create' }],
          },
        ],
      },
    ],
  };
}
