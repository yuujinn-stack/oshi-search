import Link from 'next/link';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import SearchForm from './SearchForm';
import type { SuggestionItem } from '@/types/search';

export default async function Header() {
  const [persons, groupMetas] = await Promise.all([
    getAllPersonsMerged(),
    getAllGroupMetas(),
  ]);

  // 人物候補（名前 + エイリアス）
  const personSuggestions: SuggestionItem[] = persons.flatMap((p) => {
    const items: SuggestionItem[] = [
      { label: p.name, sublabel: p.group || undefined, href: `/person/${encodeURIComponent(p.name)}`, type: 'person' },
    ];
    for (const alias of p.config.aliases ?? []) {
      items.push({ label: alias, sublabel: p.name, href: `/search?q=${encodeURIComponent(alias)}`, type: 'alias' });
    }
    return items;
  });

  // グループ候補（グループ名 + 旧名）
  const groupNames = new Set(persons.map((p) => p.group).filter(Boolean) as string[]);
  const groupSuggestions: SuggestionItem[] = [];
  for (const name of groupNames) {
    groupSuggestions.push({ label: name, href: `/group/${encodeURIComponent(name)}`, type: 'group' });
  }
  // allGroupMetas の旧名・改名前も追加
  for (const g of groupMetas) {
    for (const former of g.formerNames ?? []) {
      groupSuggestions.push({ label: former, sublabel: `現: ${g.groupName}`, href: `/group/${encodeURIComponent(g.groupName)}`, type: 'group' });
    }
    if (g.renamedFrom) {
      groupSuggestions.push({ label: g.renamedFrom, sublabel: `現: ${g.groupName}`, href: `/group/${encodeURIComponent(g.groupName)}`, type: 'group' });
    }
  }

  const suggestions = [...groupSuggestions, ...personSuggestions];

  return (
    <header className="site-header">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-xl font-black whitespace-nowrap tracking-tight" style={{ color: 'var(--ds-primary)' }}>
          推しサーチ
        </Link>
        <div className="flex-1 max-w-lg">
          <SearchForm compact suggestions={suggestions} />
        </div>
      </div>
    </header>
  );
}
