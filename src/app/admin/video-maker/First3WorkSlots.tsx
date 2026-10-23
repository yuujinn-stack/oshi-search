'use client';

import { useMemo, useState } from 'react';
import { normalizeFirst3Title } from '@/lib/video-first3-script';

// まず見る3作 ショートV1: 選定中の3作品と、1作品だけ変更（おすすめに自動変更・候補から手動選択）。
// 変更はWorkerへの依頼（3作品まとめて再選定と同じ流れ）。Workerが選び直すと、3作品・正式台本・音声生成用台本が
// この画面の定期更新で反映される。選べるかどうかの最終判定（重複・見放題）はWorkerが行う。

export interface First3SlotWork {
  id: string | null;
  title: string;
  kind: string | null;
  year: number | null;
}

interface Candidate {
  id: string;
  title: string;
  kind: string;
  year: number | null;
  role: string | null;
  flatServices: string[];
}

export default function First3WorkSlots({
  personName,
  works,
  fixedWorks,
  hasSavedAudio,
  busy,
  onReplace,
}: {
  personName: string;
  works: First3SlotWork[];
  /** 1作品だけ変更した3作品（生成時もこの3作品） */
  fixedWorks: boolean;
  /** 保存済みのCapCut音声がある（変更すると録り直しが必要） */
  hasSavedAudio: boolean;
  busy: boolean;
  /** 1作品だけ変更を依頼する（workId=null はおすすめに自動変更） */
  onReplace: (slot: 1 | 2 | 3, workId: string | null) => Promise<void>;
}) {
  const [openSlot, setOpenSlot] = useState<1 | 2 | 3 | null>(null);
  const [mode, setMode] = useState<'menu' | 'manual'>('menu');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  function toggle(slot: 1 | 2 | 3) {
    setOpenSlot(openSlot === slot ? null : slot);
    setMode('menu');
    setQuery('');
  }

  async function openManual() {
    setMode('manual');
    if (candidates) return;
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/video-jobs/first3-candidates?personName=${encodeURIComponent(personName)}`);
      const data = (await res.json().catch(() => ({}))) as { candidates?: Candidate[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCandidates(data.candidates ?? []);
    } catch (err) {
      setLoadError(String(err instanceof Error ? err.message : err));
    }
  }

  async function submit(slot: 1 | 2 | 3, workId: string | null) {
    await onReplace(slot, workId);
    setOpenSlot(null);
  }

  const otherKeys = useMemo(
    () => new Set(works.filter((_, i) => i + 1 !== openSlot).map((w) => normalizeFirst3Title(w.title))),
    [works, openSlot],
  );
  const currentKey = openSlot ? normalizeFirst3Title(works[openSlot - 1].title) : '';
  const shown = useMemo(() => {
    const q = normalizeFirst3Title(query);
    return (candidates ?? []).filter((c) => !q || normalizeFirst3Title(c.title).includes(q));
  }, [candidates, query]);

  return (
    <div className="rounded border border-gray-200 p-2 space-y-1 text-xs">
      <p className="font-bold text-gray-600">
        選定中の3作品
        {fixedWorks && <span className="ml-1 font-normal text-gray-500">（変更した3作品。生成時もこの3作品を使います）</span>}
      </p>
      {works.map((w, i) => {
        const slot = (i + 1) as 1 | 2 | 3;
        const open = openSlot === slot;
        return (
          <div key={slot} className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-slate-800 break-all">
                {slot}作目：{w.title}
                <span className="ml-1 text-gray-500">
                  {[w.kind, w.year ? `${w.year}年` : null].filter(Boolean).join('・')}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(slot)}
                aria-expanded={open}
                className={`shrink-0 px-2 py-0.5 rounded border ${open ? 'border-violet-500 text-violet-700' : 'border-gray-300 text-gray-600'} disabled:opacity-50`}
              >
                変更
              </button>
            </div>
            {open && (
              <div className="rounded bg-gray-50 p-2 space-y-2">
                {hasSavedAudio && (
                  <p className="rounded bg-amber-50 text-amber-800 px-2 py-1">
                    ⚠ 保存済みのCapCut音声があります。作品を変更すると台本が変わるため、音声の録り直しが必要になります（保存済みの音声・字幕・完成動画は削除されません）。
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(slot, null)}
                    className="px-2 py-1 rounded bg-violet-600 text-white disabled:opacity-50"
                  >
                    おすすめ作品に自動変更
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openManual()}
                    className={`px-2 py-1 rounded border ${mode === 'manual' ? 'border-violet-500 text-violet-700' : 'border-gray-300 text-gray-700'} disabled:opacity-50`}
                  >
                    候補作品から手動選択
                  </button>
                </div>
                <p className="text-gray-500">自動変更は現在の選定基準で別の作品を選びます（押すたびに別の候補へ）。ほかの2作品は変わりません。</p>
                {mode === 'manual' && (
                  <div className="space-y-1">
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="作品名で検索"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    {loadError && <p className="text-red-600">候補を読み込めませんでした: {loadError}</p>}
                    {!candidates && !loadError && <p className="text-gray-500">読み込み中…</p>}
                    {candidates && shown.length === 0 && <p className="text-gray-500">該当する作品がありません。</p>}
                    {candidates && shown.length > 0 && (
                      <ul className="max-h-64 overflow-y-auto divide-y divide-gray-200 rounded border border-gray-200 bg-white">
                        {shown.map((c) => {
                          const key = normalizeFirst3Title(c.title);
                          const reason = key === currentKey ? '変更前の作品' : otherKeys.has(key) ? '選定中の作品と同じ' : c.flatServices.length === 0 ? '見放題の配信先なし' : null;
                          return (
                            <li key={c.id}>
                              <button
                                type="button"
                                disabled={busy || reason !== null}
                                onClick={() => void submit(slot, c.id)}
                                className="w-full text-left px-2 py-1.5 hover:bg-violet-50 disabled:hover:bg-transparent disabled:text-gray-400"
                              >
                                <span className="block break-all">{c.title}</span>
                                <span className="block text-[11px] text-gray-500">
                                  {c.kind}・{c.year ? `${c.year}年` : '年不明'}
                                  {reason ? `（${reason}）` : `・見放題 ${c.flatServices.join('・')}`}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
