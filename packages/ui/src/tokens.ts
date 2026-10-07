export const pulseTokens = {
  color: {
    deepTeal: '#075E54',
    clinicalTeal: '#0B7A6B',
    sage: '#7FAF9B',
    softSage: '#DCEBE4',
    background: '#F4F8F6',
    surface: '#FFFFFF',
    ink: '#162522',
    slate: '#60706C',
    success: '#16A344',
    warning: '#F59E0B',
    error: '#DC2626',
    info: '#2563EB',
  },
  font: {
    primary: 'Inter, system-ui, sans-serif',
    secondary: "'Plus Jakarta Sans', Inter, system-ui, sans-serif",
  },
} as const;

export type PulseTokens = typeof pulseTokens;
