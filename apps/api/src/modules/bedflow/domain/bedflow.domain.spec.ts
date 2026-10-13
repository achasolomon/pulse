import { bedAcceptsLevel, effectiveLevel, isBedAvailable } from './bedflow.repository.js';

describe('bed-flow pure helpers', () => {
  it('effective level defaults to ward', () => {
    expect(effectiveLevel(undefined)).toBe('ward');
    expect(effectiveLevel('ward')).toBe('ward');
    expect(effectiveLevel('hdu')).toBe('hdu');
    expect(effectiveLevel('icu')).toBe('icu');
  });

  it('ICU/HDU level gate matrix (CLIN-001 13.1 higher-acuity workflow)', () => {
    expect(bedAcceptsLevel('ward', 'ward')).toBe(true);
    expect(bedAcceptsLevel('ward', 'hdu')).toBe(true);
    expect(bedAcceptsLevel('ward', 'icu')).toBe(true);
    expect(bedAcceptsLevel('hdu', 'ward')).toBe(false);
    expect(bedAcceptsLevel('hdu', 'hdu')).toBe(true);
    expect(bedAcceptsLevel('hdu', 'icu')).toBe(true);
    expect(bedAcceptsLevel('icu', 'ward')).toBe(false);
    expect(bedAcceptsLevel('icu', 'hdu')).toBe(false);
    expect(bedAcceptsLevel('icu', 'icu')).toBe(true);
  });

  it('availability: out of service or occupied is unavailable', () => {
    expect(isBedAvailable({ outOfService: false })).toBe(true);
    expect(isBedAvailable({ outOfService: true })).toBe(false);
    expect(isBedAvailable({ outOfService: false, activeAssignment: { id: 'a' } })).toBe(false);
    expect(isBedAvailable({ outOfService: true, activeAssignment: { id: 'a' } })).toBe(false);
  });
});
