import { toDateOnly } from './dates.js';

describe('toDateOnly', () => {
  it('converts JS Dates via local calendar fields (no weekday text, no UTC shift)', () => {
    // Noon UTC stays the same calendar day for UTC-12..UTC+12.
    expect(toDateOnly(new Date('1998-08-08T12:00:00.000Z'))).toBe('1998-08-08');
    // pg DATE columns arrive as local-midnight Dates and round-trip exactly.
    const localMidnight = new Date(1998, 7, 8);
    expect(toDateOnly(localMidnight)).toBe('1998-08-08');
  });

  it('passes ISO strings through', () => {
    expect(toDateOnly('1998-08-08')).toBe('1998-08-08');
    expect(toDateOnly('1998-08-08T00:00:00.000Z')).toBe('1998-08-08');
  });
});
