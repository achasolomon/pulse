import { Hl7v2Error, buildAck, parseOruR01, unescapeHl7 } from './hl7v2.js';

const ORU = [
  'MSH|^~\\&|LABVENDOR|MAIN|PULSE|HOSP|20261001083000||ORU^R01|CTL-2026-001|P|2.5',
  'PID|||MRN-42^^^HOSP^MR||Doe^Jane||19900101',
  'OBR|1|||BLOOD^Blood panel',
  'OBX|1|NM|8480-6^Systolic^LN||120|mmHg|||F',
  'OBX|2|ST|NOTE^Comment^LN||All\\S\\well||||||F',
].join('\r');

describe('hl7v2 ORU adapter (pure)', () => {
  it('parses control id, PID identifier and OBX values', () => {
    const p = parseOruR01(ORU);
    expect(p.controlId).toBe('CTL-2026-001');
    expect(p.messageType).toBe('ORU^R01');
    expect(p.patientMrn).toBe('MRN-42');
    expect(p.observedAt).toBe('2026-10-01T08:30:00');
    expect(p.observations).toHaveLength(2);
    expect(p.observations[0]).toMatchObject({
      setId: '1',
      identifier: '8480-6',
      valueNum: 120,
      unit: 'mmHg',
    });
    expect(p.observations[1]).toMatchObject({
      setId: '2',
      identifier: 'NOTE',
      value: 'All^well',
    });
  });

  it('rejects non-ORU, missing MSH, missing control id, missing OBX', () => {
    expect(() => parseOruR01('garbage')).toThrow('MSH');
    expect(() => parseOruR01('')).toThrow(Hl7v2Error);
    const adt = ORU.replace('ORU^R01', 'ADT^A01');
    expect(() => parseOruR01(adt)).toThrow('ORU^R01');
    const noCtl = ORU.replace('CTL-2026-001|P', '|P');
    expect(() => parseOruR01(noCtl)).toThrow('control id');
    const noObx = [ORU.split('\r')[0], ORU.split('\r')[1]].join('\r');
    expect(() => parseOruR01(noObx)).toThrow('OBX');
  });

  it('rejects unsupported value types and non-numeric NM (never guessed)', () => {
    expect(() => parseOruR01(ORU.replace('OBX|1|NM|', 'OBX|1|CE|'))).toThrow('value type');
    expect(() => parseOruR01(ORU.replace('|120|mmHg', '|HIGH|mmHg'))).toThrow('numeric');
  });

  it('decodes HL7 escape sequences', () => {
    expect(unescapeHl7('a\\S\\b\\F\\c')).toBe('a^b|c');
  });

  it('builds an explicit AA ACK with MSA correlation', () => {
    const ack = buildAck('CTL-1', 'AA');
    expect(ack).toContain('MSH|');
    expect(ack).toContain('MSA|AA|CTL-1');
    expect(ack.split('\r')).toHaveLength(2);
    expect(buildAck('CTL-1', 'AE')).toContain('MSA|AE|CTL-1');
  });
});
