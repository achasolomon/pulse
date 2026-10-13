/**
 * Inbound FHIR write translation (FHIR-001 sections 47, 50, 62; FHIR-SR-005/006).
 * Pure functions: parse + validate request payloads into domain inputs.
 * Never guesses codes or identity — anything ambiguous fails with a structured
 * error the service maps to an OperationOutcome.
 */
import { createHash } from 'node:crypto';

export type OutcomeIssueCode = 'invalid' | 'not-found' | 'conflict' | 'invariant';

export class FhirWriteError extends Error {
  constructor(
    public readonly appCode: string,
    public readonly outcomeCode: OutcomeIssueCode,
    message: string,
  ) {
    super(message);
    this.name = 'FhirWriteError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message: string, appCode = 'FHIR_VALIDATION'): never {
  throw new FhirWriteError(appCode, 'invalid', message);
}

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(`${what} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function requireResourceType(obj: Record<string, unknown>, type: string): void {
  if (obj['resourceType'] !== type) {
    invalid(`resourceType must be '${type}'`);
  }
}

/** `Resource/uuid` (or bare uuid) reference -> uuid. Never guesses identity. */
function referenceId(ref: unknown, path: string): string {
  if (typeof ref !== 'string' || ref.trim() === '') {
    invalid(`${path} is required (format: Resource/<uuid>)`);
  }
  const value = ref.trim();
  const id = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  if (!UUID_RE.test(id)) {
    invalid(`${path} must reference a UUID (got '${value}')`);
  }
  return id;
}

function optionalEncounterId(obj: Record<string, unknown>): string | undefined {
  const ctx = obj['context'];
  if (typeof ctx !== 'object' || ctx === null) return undefined;
  const enc = (ctx as Record<string, unknown>)['encounter'];
  if (typeof enc !== 'object' || enc === null) return undefined;
  return referenceId((enc as Record<string, unknown>)['reference'], 'context.encounter.reference');
}

interface CodeableLike {
  text?: string;
  coding?: { code?: string; display?: string }[];
}

function codeAndDisplay(
  value: unknown,
  path: string,
  opts: { required: boolean },
): { code?: string; display?: string } {
  if (value === undefined || value === null) {
    if (opts.required) invalid(`${path} is required`);
    return {};
  }
  const cb = asObject(value, path) as CodeableLike;
  const coding0 = Array.isArray(cb.coding) ? cb.coding[0] : undefined;
  const code = coding0?.code;
  const display = cb.text ?? coding0?.display;
  if (!display && !code && opts.required) {
    invalid(`${path} must include text or a coding (never guessed)`);
  }
  return {
    ...(code ? { code } : {}),
    // Verbatim code is an acceptable display stand-in — still not a guess.
    ...(display || code ? { display: display ?? code } : {}),
  };
}

export interface ParsedCondition {
  patientId: string;
  encounterId?: string;
  code?: string;
  display: string;
  status: 'active' | 'resolved';
}

export function parseCondition(resource: unknown): ParsedCondition {
  const obj = asObject(resource, 'Condition');
  requireResourceType(obj, 'Condition');
  const { code, display } = codeAndDisplay(obj['code'], 'Condition.code', { required: true });
  const clinical = obj['clinicalStatus'];
  const clinicalCode =
    typeof clinical === 'object' && clinical !== null
      ? ((clinical as CodeableLike).coding?.[0]?.code ?? undefined)
      : undefined;
  return {
    patientId: referenceId((obj['subject'] as Record<string, unknown> | undefined)?.['reference'], 'Condition.subject.reference'),
    encounterId: optionalEncounterId(obj),
    code,
    display: display as string,
    status: clinicalCode === 'resolved' ? 'resolved' : 'active',
  };
}

export interface ParsedAllergy {
  patientId: string;
  encounterId?: string;
  code?: string;
  display: string;
}

export function parseAllergyIntolerance(resource: unknown): ParsedAllergy {
  const obj = asObject(resource, 'AllergyIntolerance');
  requireResourceType(obj, 'AllergyIntolerance');
  const { code, display } = codeAndDisplay(obj['code'], 'AllergyIntolerance.code', {
    required: true,
  });
  return {
    patientId: referenceId((obj['subject'] as Record<string, unknown> | undefined)?.['reference'], 'AllergyIntolerance.subject.reference'),
    encounterId: optionalEncounterId(obj),
    code,
    display: display as string,
  };
}

export interface ParsedObservation {
  patientId: string;
  encounterId?: string;
  code: string;
  valueNum?: number;
  valueText?: string;
  unit?: string;
  takenAt: string;
}

function parseEffectiveDateTime(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return new Date().toISOString();
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    invalid('Observation.effectiveDateTime must be a valid date-time');
  }
  return new Date(value).toISOString();
}

export function parseObservation(resource: unknown): ParsedObservation {
  const obj = asObject(resource, 'Observation');
  requireResourceType(obj, 'Observation');
  const { code, display } = codeAndDisplay(obj['code'], 'Observation.code', { required: true });

  const hasQty = obj['valueQuantity'] !== undefined && obj['valueQuantity'] !== null;
  const hasStr = obj['valueString'] !== undefined && obj['valueString'] !== null;
  if (hasQty && hasStr) invalid('Observation must have exactly one value[x]');
  let valueNum: number | undefined;
  let valueText: string | undefined;
  let unit: string | undefined;
  if (hasQty) {
    const q = asObject(obj['valueQuantity'], 'Observation.valueQuantity');
    const v = q['value'];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      invalid('Observation.valueQuantity.value must be a finite number');
    }
    valueNum = v;
    if (typeof q['unit'] === 'string' && q['unit'] !== '') unit = q['unit'];
  } else if (hasStr) {
    if (typeof obj['valueString'] !== 'string' || (obj['valueString'] as string) === '') {
      invalid('Observation.valueString must be a non-empty string');
    }
    valueText = obj['valueString'];
  } else {
    invalid('Observation.value[x] (valueQuantity | valueString) is required');
  }

  return {
    patientId: referenceId((obj['subject'] as Record<string, unknown> | undefined)?.['reference'], 'Observation.subject.reference'),
    encounterId: optionalEncounterId(obj),
    code: (display ?? code) as string,
    ...(valueNum !== undefined ? { valueNum } : {}),
    ...(valueText !== undefined ? { valueText } : {}),
    ...(unit !== undefined ? { unit } : {}),
    takenAt: parseEffectiveDateTime(obj['effectiveDateTime']),
  };
}

/** SHA-256 over canonical (key-sorted) JSON: stable across key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
