export const DESIGN_THEMES = ['trust', 'oshi', 'dark'] as const;
export type DesignTheme = (typeof DESIGN_THEMES)[number];

export const THEME_LABEL: Record<DesignTheme, string> = {
  trust: 'Trust',
  oshi: 'Oshi',
  dark: 'Dark',
};

export const THEME_ACCENT: Record<DesignTheme, string> = {
  trust: '#2563EB',
  oshi: '#DB2777',
  dark: '#F59E0B',
};

export const DEFAULT_THEME: DesignTheme = 'trust';
export const LS_KEY = 'oshi-design-theme';
export const QUERY_KEY = 'design';

export function isValidTheme(v: unknown): v is DesignTheme {
  return DESIGN_THEMES.includes(v as DesignTheme);
}
