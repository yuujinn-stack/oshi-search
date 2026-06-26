'use client';

import SmartSearchInput from './site/SmartSearchInput';
import type { SuggestionItem } from '@/types/search';

interface Props {
  defaultValue?: string;
  compact?: boolean;
  suggestions?: SuggestionItem[];
}

export default function SearchForm({ defaultValue = '', compact = false, suggestions = [] }: Props) {
  return (
    <SmartSearchInput
      defaultValue={defaultValue}
      compact={compact}
      suggestions={suggestions}
      buttonLabel={compact ? '検索' : '検索する'}
    />
  );
}
