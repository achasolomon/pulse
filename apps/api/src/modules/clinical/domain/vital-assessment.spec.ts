import { describe, expect, it } from 'vitest';
import { assessVital } from './vital-assessment.js';
const now = new Date('2026-10-15T12:00:00Z');
const base = { id: 'reading', code: 'bp-systolic', value: '190', unit: 'mmHg', takenAt: '2026-10-15T10:00:00Z', origin: 'local' };
const assess = (change = {}, dob = '1990-01-01') => assessVital({ ...base, ...change }, dob, now);
describe('adult positive vital screening', () => {
  it('flags severe systolic elevation independently of the diastolic component', () => {
    expect(assess().status).toBe('urgent');
    expect(assess({ code: 'bp-diastolic', value: '70' }).status).toBe('not-flagged');
    expect(assess({ code: 'bp-diastolic', value: '120' }).status).toBe('urgent');
    expect(assess({ value: '180' }).status).toBe('urgent');
  });
  it('honours boundaries and does not label unflagged or low values normal', () => {
    expect(assess({ value: '140' }).status).toBe('attention');
    expect(assess({ code: 'bp-diastolic', value: '90' }).status).toBe('attention');
    expect(assess({ value: '139' }).status).toBe('not-flagged');
    expect(assess({ value: '70' }).reason).toContain('Low BP');
  });
  it('screens temperature in recorded supported units', () => {
    expect(assess({ code: 'temperature', value: '38', unit: '°C' }).status).toBe('attention');
    expect(assess({ code: 'temperature', value: '100.4', unit: '°F' }).status).toBe('attention');
    expect(assess({ code: 'temperature', value: '37.9', unit: 'Cel' }).status).toBe('not-flagged');
    expect(assess({ code: 'temperature', value: '38', unit: null }).status).toBe('not-assessed');
  });
  it('uses age at measurement, including the eighteenth birthday', () => {
    expect(assess({}, '2008-10-15').status).toBe('urgent');
    expect(assess({}, '2008-10-16').status).toBe('not-assessed');
    expect(assess({ takenAt: '2025-01-01' }, '2008-01-02').status).toBe('not-assessed');
  });
  it('declines unsupported, malformed or temporally invalid measurements', () => {
    for (const change of [{ unit: 'kPa' }, { value: '' }, { value: null }, { value: 'NaN' }, { value: '190abc' }, { value: '-1' }, { takenAt: 'invalid' }, { takenAt: '2027-01-01' }, { code: 'spo2' }]) expect(assess(change).status).toBe('not-assessed');
    expect(assess({}, 'invalid').status).toBe('not-assessed');
  });
  it('includes a version, reason and authoritative source for traceability', () => {
    expect(assess()).toMatchObject({ ruleId: 'adult-bp-high', ruleVersion: 'adult-screening-2026-10-15.v2', sourceUrl: expect.stringContaining('nice.org.uk'), reason: expect.stringContaining('not a diagnosis') });
  });
  it('returns an explicit unassessed state when deployment screening is disabled', () => {
    expect(assessVital(base, '1990-01-01', now, false)).toMatchObject({status: 'not-assessed', reason: expect.stringContaining('not enabled')});
  });
  it('assesses respiratory/pulse extremes and default SpO2 reference without producing a total NEWS2', () => {
    expect(assess({code:'respiratory-rate',value:'8',unit:'breaths/min'}).status).toBe('urgent');
    expect(assess({code:'respiratory-rate',value:'25',unit:'breaths/min'}).status).toBe('urgent');
    expect(assess({code:'respiratory-rate',value:'20',unit:'breaths/min'}).status).toBe('not-flagged');
    expect(assess({code:'heart-rate',value:'131',unit:'bpm'}).status).toBe('urgent');
    expect(assess({code:'heart-rate',value:'50',unit:'bpm'}).status).toBe('attention');
    expect(assess({code:'spo2',value:'91',unit:'%'}).status).toBe('urgent');
    expect(assess({code:'spo2',value:'95',unit:'%'}).status).toBe('attention');
    expect(assess({code:'spo2',value:'96',unit:'%'}).reason).toContain('Default adult');
    expect(assess({code:'spo2',value:'101',unit:'%'}).status).toBe('not-assessed');
    expect(assess({code:'respiratory-rate',value:'0',unit:'breaths/min'}).status).toBe('urgent');
    expect(assess({code:'heart-rate',value:'0',unit:'bpm'}).status).toBe('urgent');
  });
});
