'use client';

// 動画「推し布教カード紹介」（Worker報告の templateInputKind が oshi-card-selection）の人物・作品・デザイン選択。
// 人物は既存の PersonCombobox、作品は推し布教カード（/oshi-card）と同じ候補（その人物の公開作品）から1〜3件を選んだ順で選ぶ。
// 作品は管理者が選んだおすすめで、公式の順位ではない。サーバーでもジョブ作成時に「その人物の公開作品か」を確かめる。

import { useEffect, useMemo, useState } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import { OSHI_CARD_VIDEO_MAX_WORKS } from '@/lib/video-template-input';

export interface OshiCardPick {
  personName: string;
  workIds: string[];
  variant: 'cool' | 'cute';
}

export const EMPTY_OSHI_CARD_PICK: OshiCardPick = { personName: '', workIds: [], variant: 'cool' };

interface CandidateWork {
  id: string;
  title: string;
  typeLabel: string;
  year: number | null;
}

const VARIANTS: Array<{ value: OshiCardPick['variant']; label: string; note: string }> = [
  { value: 'cool', label: 'ノーマル', note: '落ち着いた紙の質感' },
  { value: 'cute', label: 'デコ', note: 'ポップでにぎやか' },
];

export default function OshiCardWorkPicker({
  persons,
  value,
  onChange,
}: {
  persons: PersonOption[];
  value: OshiCardPick;
  onChange: (next: OshiCardPick) => void;
}) {
  const [works, setWorks] = useState<CandidateWork[] | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setWorks(null);
    setGroup(null);
    setError(null);
    setQuery('');
    if (!value.personName) return;
    let cancelled = false;
    fetch(`/api/admin/video-jobs/oshi-card-works?personName=${encodeURIComponent(value.personName)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        return data as { group: string; works: CandidateWork[] };
      })
      .then((data) => {
        if (cancelled) return;
        setWorks(data.works);
        setGroup(data.group || null);
      })
      .catch((err) => !cancelled && setError(String(err instanceof Error ? err.message : err)));
    return () => {
      cancelled = true;
    };
  }, [value.personName]);

  const byId = useMemo(() => new Map((works ?? []).map((w) => [w.id, w])), [works]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (works ?? []).filter((w) => !q || w.title.toLowerCase().includes(q));
  }, [works, query]);
  const full = value.workIds.length >= OSHI_CARD_VIDEO_MAX_WORKS;

  const toggle = (id: string) => {
    if (value.workIds.includes(id)) onChange({ ...value, workIds: value.workIds.filter((w) => w !== id) });
    else if (!full) onChange({ ...value, workIds: [...value.workIds, id] });
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...value.workIds];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange({ ...value, workIds: next });
  };

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <PersonCombobox
          persons={persons}
          value={value.personName}
          onChange={(name) => onChange({ ...EMPTY_OSHI_CARD_PICK, variant: value.variant, personName: name })}
          placeholder="人物名・グループ名で検索"
          allowEmpty
          emptyLabel="未選択"
        />
        {group && <p className="text-xs text-gray-500 mt-1">グループ: {group}</p>}
      </div>

      {value.personName && (
        <div>
          <h3 className="text-xs font-bold text-slate-700 mb-1">
            おすすめ作品（1〜{OSHI_CARD_VIDEO_MAX_WORKS}件・選んだ順にカードへ載ります）
          </h3>
          {value.workIds.length > 0 && (
            <ol className="mb-2 space-y-1">
              {value.workIds.map((id, i) => (
                <li key={id} className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <span className="font-bold text-amber-700 w-5">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate">{byId.get(id)?.title ?? id}</span>
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-xs px-1 text-gray-500 disabled:text-gray-300" aria-label="上へ">
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={i === value.workIds.length - 1}
                    onClick={() => move(i, 1)}
                    className="text-xs px-1 text-gray-500 disabled:text-gray-300"
                    aria-label="下へ"
                  >
                    ▼
                  </button>
                  <button type="button" onClick={() => toggle(id)} className="text-xs text-red-500 hover:underline">
                    外す
                  </button>
                </li>
              ))}
            </ol>
          )}
          {error ? (
            <p className="text-xs text-red-600">作品を読み込めませんでした: {error}</p>
          ) : !works ? (
            <p className="text-xs text-gray-500">作品を読み込み中...</p>
          ) : works.length === 0 ? (
            <p className="text-xs text-gray-500">この人物には選べる公開作品がありません。</p>
          ) : (
            <>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`作品名でしぼりこむ（${works.length}件）`}
                className="w-full max-w-md text-sm border border-gray-200 rounded px-2 py-1 mb-2"
              />
              <ul className="max-h-64 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-100">
                {visible.map((w) => {
                  const order = value.workIds.indexOf(w.id);
                  const disabled = order < 0 && full;
                  return (
                    <li key={w.id}>
                      <label className={`flex items-center gap-2 px-2 py-1.5 text-sm ${disabled ? 'text-gray-300' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={order >= 0} disabled={disabled} onChange={() => toggle(w.id)} />
                        <span className="flex-1 min-w-0">{w.title}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {w.typeLabel}
                          {w.year ? `・${w.year}` : ''}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className="text-xs font-bold text-slate-700 mb-1">カードのデザイン</h3>
        <div className="flex gap-4 text-sm">
          {VARIANTS.map((v) => (
            <label key={v.value} className="cursor-pointer">
              <input
                type="radio"
                name="vm-oshi-card-variant"
                className="mr-1"
                checked={value.variant === v.value}
                onChange={() => onChange({ ...value, variant: v.value })}
              />
              {v.label}
              <span className="text-xs text-gray-400 ml-1">（{v.note}）</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
