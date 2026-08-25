'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';

export interface PhotobookGroupOption {
  name: string;
  gender: 'female' | 'male' | null;
}

interface Props {
  persons: PersonOption[];
  groups: PhotobookGroupOption[];
  gender: 'female' | 'male';
  personName: string;
  groupName: string;
  genreBucket: string;
}

const GENRE_OPTIONS_BY_GENDER: Record<'female' | 'male', { value: string; label: string }[]> = {
  female: [
    { value: '', label: 'すべて' },
    { value: '女優', label: '女優' },
    { value: 'アイドル', label: 'アイドル' },
    { value: 'その他', label: 'その他' },
  ],
  male: [
    { value: '', label: 'すべて' },
    { value: '俳優', label: '俳優' },
    { value: 'アイドル', label: 'アイドル' },
    { value: 'その他', label: 'その他' },
  ],
};

export default function PhotobookFilterBar({ persons, groups, gender, personName, groupName, genreBucket }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function buildUrl(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete('page'); // フィルタ変更時は1ページ目に戻す
    const qs = params.toString();
    return qs ? `/photobooks?${qs}` : '/photobooks';
  }

  const filteredGroups = groups.filter((g) => !g.gender || g.gender === gender);
  const filteredPersons = persons.filter((p) => {
    const match = groupName ? (p.group === groupName) : true;
    return match;
  });

  return (
    <div className="space-y-3 mb-6">
      {/* 性別タブ */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {(['female', 'male'] as const).map((g) => (
          <a
            key={g}
            href={buildUrl({ gender: g, genre: undefined })}
            style={{
              padding: '8px 18px',
              minHeight: '36px',
              borderRadius: '999px',
              fontSize: '13px',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              border: gender === g ? '1.5px solid var(--ds-primary)' : '1.5px solid var(--ds-border)',
              background: gender === g ? 'var(--ds-primary-soft)' : 'var(--ds-surface)',
              color: gender === g ? 'var(--ds-primary)' : 'var(--ds-muted)',
            }}
          >
            {g === 'female' ? '女性' : '男性'}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* 人物検索 */}
        <PersonCombobox
          persons={filteredPersons}
          value={personName}
          onChange={(name) => router.push(buildUrl({ person: name || undefined }))}
          placeholder="人物名で検索..."
          allowEmpty
          emptyLabel="人物: すべて"
        />

        {/* グループ検索 */}
        <select
          value={groupName}
          onChange={(e) => router.push(buildUrl({ group: e.target.value || undefined }))}
          className="w-full text-xs border rounded-lg px-3 py-2 min-h-[36px]"
          style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)' }}
        >
          <option value="">グループ: すべて</option>
          {filteredGroups.map((g) => (
            <option key={g.name} value={g.name}>{g.name}</option>
          ))}
        </select>

        {/* ジャンル絞り込み */}
        <select
          value={genreBucket}
          onChange={(e) => router.push(buildUrl({ genre: e.target.value || undefined }))}
          className="w-full text-xs border rounded-lg px-3 py-2 min-h-[36px]"
          style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)' }}
        >
          {GENRE_OPTIONS_BY_GENDER[gender].map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
