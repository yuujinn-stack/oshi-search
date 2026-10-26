import Link from 'next/link';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHref, groupHrefByName } from '@/lib/group-slug';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { displayGroupOf, groupMembershipRecords, listGroupNames } from '@/lib/group-membership';
import SearchForm from './SearchForm';
import HeaderSearchSlot from './HeaderSearchSlot';
import type { SuggestionItem } from '@/types/search';

export default async function Header() {
  const [persons, groupMetas, membershipRecords] = await Promise.all([
    getAllPersonsMerged(),
    getAllGroupMetas(),
    getAllMembershipRecords(),
  ]);
  const recordsByPerson = groupMembershipRecords(membershipRecords);

  // 人物候補（名前 + エイリアス）
  const personSuggestions: SuggestionItem[] = persons.flatMap((p) => {
    const items: SuggestionItem[] = [
      { label: p.name, sublabel: displayGroupOf(p, recordsByPerson.get(p.name)) || undefined, href: `/person/${encodeURIComponent(p.name)}`, type: 'person' },
    ];
    for (const alias of p.config.aliases ?? []) {
      items.push({ label: alias, sublabel: p.name, href: `/search?q=${encodeURIComponent(alias)}`, type: 'alias' });
    }
    return items;
  });

  // グループ候補（グループ名 + 旧名）
  // persons.group ＋ 所属履歴にだけ出てくるグループ（移籍先など）
  const groupNames = listGroupNames(persons, recordsByPerson);
  const groupSuggestions: SuggestionItem[] = [];
  for (const name of groupNames) {
    groupSuggestions.push({ label: name, href: groupHrefByName(name, groupMetas), type: 'group' });
  }
  // allGroupMetas の旧名・改名前も追加
  for (const g of groupMetas) {
    for (const former of g.formerNames ?? []) {
      groupSuggestions.push({ label: former, sublabel: `現: ${g.groupName}`, href: groupHref(g), type: 'group' });
    }
    if (g.renamedFrom) {
      groupSuggestions.push({ label: g.renamedFrom, sublabel: `現: ${g.groupName}`, href: groupHref(g), type: 'group' });
    }
  }

  const suggestions = [...groupSuggestions, ...personSuggestions];

  return (
    <header className="site-header">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
        <Link href="/" className="text-xl font-black whitespace-nowrap tracking-tight" style={{ color: 'var(--ds-primary)' }}>
          推しサーチ
        </Link>
        <HeaderSearchSlot>
          <SearchForm compact suggestions={suggestions} />
        </HeaderSearchSlot>
      </div>
    </header>
  );
}
