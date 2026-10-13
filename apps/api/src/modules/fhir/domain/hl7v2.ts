/**
 * HL7v2 adapter (FHIR-001 section 65, legacy v2): minimal ORU^R01 parser and
 * ACK builder. Pure functions, unit-tested. Explicit ACK/NACK semantics
 * (MSA-1 AA/AE); message control id (MSH-10) is the idempotency anchor.
 * Unknown codes pass through verbatim — never guessed or remapped.
 */

export class Hl7v2Error extends Error {
  constructor(
    public readonly appCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'Hl7v2Error';
  }
}

function fail(appCode: string, message: string): never {
  throw new Hl7v2Error(appCode, message);
}

const HL7_ESCAPES: Record<string, string> = { F: '|', S: '^', T: '&', R: '~', E: '\\' };

/** HL7 escape sequences (\S\ etc.) decoded for display/value use only. */
export function unescapeHl7(value: string): string {
  return value.replace(/\\([FSTRE])\\/g, (_m, k: string) => HL7_ESCAPES[k] ?? '');
}

export interface ParsedObx {
  setId: string;
  identifier: string;
  display?: string;
  valueType: string;
  value: string;
  valueNum?: number;
  unit?: string;
}

export interface ParsedOru {
  controlId: string;
  messageType: string;
  patientMrn: string;
  observedAt?: string;
  observations: ParsedObx[];
}

/** HL7 DT/TM-ish stamp `YYYYMMDDHHMMSS` -> ISO. Returns undefined if unusable. */
function hl7Timestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h ?? '00'}:${mi ?? '00'}:${s ?? '00'}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

function splitSegments(raw: string): string[] {
  return raw
    .replace(/\r\n|\n|\r/g, '\r')
    .split('\r')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function ceComponents(field: string | undefined): { code?: string; text?: string } {
  if (field === undefined) return {};
  const [code, text] = field.split('^');
  return {
    ...(code && code !== '' ? { code } : {}),
    ...(text && text !== '' ? { text } : {}),
  };
}

const SUPPORTED_VALUE_TYPES = new Set(['NM', 'ST', 'TX', 'FT', 'DT']);

export function parseOruR01(raw: string): ParsedOru {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail('HL7V2_PARSE', 'HL7 message must be a non-empty string');
  }
  const segments = splitSegments(raw);
  const msh = segments[0];
  if (!msh || !msh.startsWith('MSH|')) {
    fail('HL7V2_PARSE', 'Message must start with an MSH segment');
  }
  const mshF = msh.split('|');
  // MSH-1 is the field separator itself, so MSH-n lives at index n-1.
  const msgType = (mshF[8] ?? '').split('^');
  if (msgType[0] !== 'ORU' || msgType[1] !== 'R01') {
    fail('HL7V2_MSG_TYPE', `Unsupported message type '${mshF[8] ?? ''}' (expected ORU^R01)`);
  }
  const controlId = (mshF[9] ?? '').trim();
  if (controlId === '') fail('HL7V2_CONTROL_ID', 'MSH-10 message control id is required');

  const pid = segments.find((s) => s.startsWith('PID|'));
  if (!pid) fail('HL7V2_PARSE', 'PID segment is required');
  const pid3 = (pid.split('|')[3] ?? '').split('^')[0]?.trim() ?? '';
  if (pid3 === '') fail('HL7V2_PATIENT', 'PID-3 patient identifier is required');

  const obxSegments = segments.filter((s) => s.startsWith('OBX|'));
  if (obxSegments.length === 0) fail('HL7V2_PARSE', 'At least one OBX segment is required');

  const observations: ParsedObx[] = [];
  for (const seg of obxSegments) {
    const f = seg.split('|');
    const setId = (f[1] ?? '').trim();
    const valueType = (f[2] ?? '').trim();
    const ident = ceComponents(f[3]);
    const valueRaw = (f[5] ?? '').trim();
    if (ident.code === undefined || ident.code === '') {
      fail('HL7V2_OBX', `OBX-3 observation identifier is required (set ${setId || '?'})`);
    }
    if (valueRaw === '') fail('HL7V2_OBX', `OBX-5 value is required (set ${setId || '?'})`);
    if (!SUPPORTED_VALUE_TYPES.has(valueType)) {
      fail('HL7V2_VALUE_TYPE', `Unsupported OBX-2 value type '${valueType}' (set ${setId || '?'})`);
    }
    let valueNum: number | undefined;
    if (valueType === 'NM') {
      const n = Number(valueRaw);
      if (!Number.isFinite(n)) {
        fail('HL7V2_VALUE', `OBX-5 must be numeric for value type NM (set ${setId || '?'})`);
      }
      valueNum = n;
    }
    const unit = ceComponents(f[6]).text ?? ceComponents(f[6]).code;
    observations.push({
      setId,
      identifier: unescapeHl7(ident.code),
      ...(ident.text ? { display: unescapeHl7(ident.text) } : {}),
      valueType,
      value: unescapeHl7(valueRaw),
      ...(valueNum !== undefined ? { valueNum } : {}),
      ...(unit ? { unit } : {}),
    });
  }

  const observedAt = hl7Timestamp(mshF[6]);
  return {
    controlId,
    messageType: 'ORU^R01',
    patientMrn: pid3,
    ...(observedAt ? { observedAt } : {}),
    observations,
  };
}

/** ACK envelope: MSH + MSA (AA accepted / AE error). Detail stays in the JSON body. */
export function buildAck(controlId: string, code: 'AA' | 'AE'): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return [
    `MSH|^~\\&|PULSE|PULSE|PULSE|PULSE|${ts}||ACK|${controlId}|P|2.5`,
    `MSA|${code}|${controlId}`,
  ].join('\r');
}
