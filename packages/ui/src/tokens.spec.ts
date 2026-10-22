import { describe, expect, it } from 'vitest';
import { pulseCssVariables, pulseTokens, pulseTokensCss } from './tokens.js';

describe('design tokens', () => {
  it('matches the brand board palette exactly', () => {
    expect(pulseTokens.color.deepTeal).toBe('#075E54');
    expect(pulseTokens.color.clinicalTeal).toBe('#0B7A6B');
    expect(pulseTokens.color.sage).toBe('#7FAF9B');
    expect(pulseTokens.color.softSage).toBe('#DCEBE4');
    expect(pulseTokens.color.background).toBe('#F4F8F6');
    expect(pulseTokens.color.surface).toBe('#FFFFFE');
    expect(pulseTokens.color.ink).toBe('#162522');
    expect(pulseTokens.color.slate).toBe('#60706C');
    expect(pulseTokens.color.success).toBe('#16A344');
    expect(pulseTokens.color.warning).toBe('#F59E0B');
    expect(pulseTokens.color.error).toBe('#DC2626');
    expect(pulseTokens.color.info).toBe('#2563EB');
  });

  it('uses the brand typefaces (Inter body, Plus Jakarta headings)', () => {
    expect(pulseTokens.font.primary).toContain('Inter');
    expect(pulseTokens.font.secondary).toContain('Plus Jakarta Sans');
  });

  it('exposes injectable CSS custom properties for every token colour', () => {
    expect(pulseCssVariables['--pulse-deep-teal']).toBe('#075E54');
    expect(pulseCssVariables['--pulse-error']).toBe('#DC2626');
    expect(pulseTokensCss).toContain(':root {');
    expect(pulseTokensCss).toContain('--pulse-space-4: 16px;');
  });
});
