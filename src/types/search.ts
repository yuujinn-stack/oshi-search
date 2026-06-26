export interface SuggestionItem {
  label: string;
  href: string;
  sublabel?: string;
  type: 'person' | 'group' | 'alias';
}
