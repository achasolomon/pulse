import {
  findingStatusAction,
  validateFindingSeverity,
} from './finding.repository.js';

describe('finding domain', () => {
  it('findingStatusAction: open->triage|mitigate|accept; triaged->mitigate|accept; closed terminal', () => {
    expect(findingStatusAction('open', 'triage')).toBe('triaged');
    expect(findingStatusAction('open', 'mitigate')).toBe('mitigated');
    expect(findingStatusAction('open', 'accept')).toBe('accepted');
    expect(findingStatusAction('triaged', 'mitigate')).toBe('mitigated');
    expect(findingStatusAction('triaged', 'accept')).toBe('accepted');
    expect(findingStatusAction('triaged', 'triage')).toBeUndefined();
    expect(findingStatusAction('mitigated', 'triage')).toBeUndefined();
    expect(findingStatusAction('mitigated', 'accept')).toBeUndefined();
    expect(findingStatusAction('mitigated', 'mitigate')).toBeUndefined();
    expect(findingStatusAction('accepted', 'mitigate')).toBeUndefined();
    expect(findingStatusAction('accepted', 'triage')).toBeUndefined();
  });

  it('validateFindingSeverity: exact set, else throw', () => {
    expect(validateFindingSeverity('critical')).toBe('critical');
    expect(validateFindingSeverity('info')).toBe('info');
    expect(() => validateFindingSeverity('catastrophic')).toThrow(
      'FINDING_SEVERITY_INVALID',
    );
    expect(() => validateFindingSeverity('')).toThrow('FINDING_SEVERITY_INVALID');
  });
});
