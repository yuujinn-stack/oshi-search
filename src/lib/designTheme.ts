export const DESIGN_THEMES = ['standard', 'oshi-pop', 'premium'] as const;
export type DesignTheme = (typeof DESIGN_THEMES)[number];

export const THEME_LABEL: Record<DesignTheme, string> = {
  standard: 'Standard',
  'oshi-pop': 'Oshi Pop',
  premium: 'Premium',
};

export const THEME_ACCENT: Record<DesignTheme, string> = {
  standard: '#4F46E5',
  'oshi-pop': '#E91E8C',
  premium: '#F59E0B',
};

export const DEFAULT_THEME: DesignTheme = 'standard';
export const LS_KEY = 'oshi-design-theme';
export const QUERY_KEY = 'design';

export function isValidTheme(v: unknown): v is DesignTheme {
  return DESIGN_THEMES.includes(v as DesignTheme);
}
