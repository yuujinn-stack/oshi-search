'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { daysSinceFirst3Check, FIRST3_CHECK_STALE_DAYS, normalizeFirst3Title, staleFirst3Works } from '@/lib/video-first3-script';

// まず見る3作 ショートV1: 選定中の3作品と、1作品だけ変更（おすすめに自動変更・候補から手動選択）。
// 変更はWorkerへの依頼（3作品まとめて再選定と同じ流れ）。Workerが選び直すと、3作品・正式台本・音声生成用台本が
// この画面の定期更新で反映される。選べるかどうかの最終判定（重複・見放題）はWorkerが行う。

export interface First3SlotWork {
  id: string | null;
  title: string;
  kind: string | null;
  year: number | null;
  /** 選ばれた理由（古いWorkerの報告には無い） */
  reason?: string | null;
  /** 見放題 / 無料 / 広告付き無料（古いWorkerの報告には無い） */
  access?: '見放題' | '無料' | '広告付き無料' | null;
  services?: string[];
  /** 作品ページの「確認: ○○」 */
  checkedAt?: string | null;
  /** 本人が出演する番組・ライブ等から選んだ作品 */
  extra?: boolean;
  /** 動画用の表示名（設定した場合だけ。title は正式名称） */
  videoTitle?: string | null;
  /** 動画で使う作品名が作品カードで2行に収まらない（ナレーションも長くなる） */
  titleTooLong?: boolean;
}

interface Candidate {
  id: string;
  title: string;
  kind: string;
  year: number | null;
  role: string | null;
  flatServices: string[];
  /** 無料・広告付き無料の配信先（古い応答には無い） */
  freeServices?: string[];
  /** まず見る3作の候補にならない理由（古い応答には無い） */
  excludedReason?: string | null;
}

export default function First3WorkSlots({
  personName,
  works,
  fixedWorks,
  hasSavedAudio,
  busy,
  onReplace,
  excludedWorks = [],
  onExclude,
  onUnexclude,
  onVideoTitle,
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
  /** 管理画面で除外した作品（この人物の選定・変更・手動選択の候補にしない） */
  excludedWorks?: Array<{ id: string; title: string; kind?: 'exclude' | 'vod_check' }>;
  /** この枠の作品を除外（または配信確認待ちに）して、おすすめ作品に自動変更する */
  onExclude?: (slot: 1 | 2 | 3, kind: 'exclude' | 'vod_check') => Promise<void>;
  /** 除外を解除する（3作品は変えない） */
  onUnexclude?: (workId: string, title: string) => Promise<void>;
  /** 動画用の表示名を設定する（null=解除して正式名称に戻す） */
  onVideoTitle?: (slot: 1 | 2 | 3, workId: string, videoTitle: string | null) => Promise<void>;
}) {
  const [openSlot, setOpenSlot] = useState<1 | 2 | 3 | null>(null);
  const [mode, setMode] = useState<'menu' | 'manual'>('menu');
  // 候補一覧はどの人物のものかと一緒に持つ（別の人物の一覧を表示・選択しない）
  const [loaded, setLoaded] = useState<{ personName: string; list: Candidate[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // 動画用の表示名を編集中の枠と入力値
  const [titleEdit, setTitleEdit] = useState<{ slot: 1 | 2 | 3; value: string } | null>(null);
  const currentPerson = useRef(personName);
  useEffect(() => {
    currentPerson.current = personName;
    setLoaded(null);
    setLoadError(null);
    setOpenSlot(null);
    setMode('menu');
    setQuery('');
    setTitleEdit(null);
  }, [personName]);
  const candidates = loaded && loaded.personName === personName ? loaded.list : null;

  function toggle(slot: 1 | 2 | 3) {
    setOpenSlot(openSlot === slot ? null : slot);
    setMode('menu');
    setQuery('');
  }

  async function openManual() {
    setMode('manual');
    if (candidates) return;
    const requested = personName;
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/video-jobs/first3-candidates?personName=${encodeURIComponent(requested)}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { personName?: string; candidates?: Candidate[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      // 応答が届く前に人物を切り替えた場合や、別の人物の応答は使わない
      if (currentPerson.current !== requested || data.personName !== requested) return;
      setLoaded({ personName: requested, list: data.candidates ?? [] });
    } catch (err) {
      if (currentPerson.current === requested) setLoadError(String(err instanceof Error ? err.message : err));
    }
  }

  async function submit(slot: 1 | 2 | 3, workId: string | null) {
    if (currentPerson.current !== personName) return;
    await onReplace(slot, workId);
    setOpenSlot(null);
  }

  async function exclude(slot: 1 | 2 | 3, kind: 'exclude' | 'vod_check') {
    if (currentPerson.current !== personName || !onExclude) return;
    await onExclude(slot, kind);
    setOpenSlot(null);
  }

  const excludedIds = useMemo(() => new Set(excludedWorks.map((w) => w.id)), [excludedWorks]);

  const otherKeys = useMemo(
    () => new Set(works.filter((_, i) => i + 1 !== openSlot).map((w) => normalizeFirst3Title(w.title))),
    [works, openSlot],
  );
  const currentKey = openSlot ? normalizeFirst3Title(works[openSlot - 1].title) : '';
  const usable = (c: Candidate) => c.flatServices.length > 0 || (c.freeServices?.length ?? 0) > 0;
  const selectableCount = (candidates ?? []).filter(
    (c) => !c.excludedReason && usable(c) && !excludedIds.has(c.id) && !otherKeys.has(normalizeFirst3Title(c.title)) && normalizeFirst3Title(c.title) !== currentKey,
  ).length;
  const shown = useMemo(() => {
    const q = normalizeFirst3Title(query);
    return (candidates ?? []).filter((c) => !q || normalizeFirst3Title(c.title).includes(q));
  }, [candidates, query]);

  const stale = staleFirst3Works(works);
  return (
    <div className="rounded border border-gray-200 p-2 space-y-1 text-xs">
      {stale.length > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 font-bold text-amber-800">
          ⚠ 配信の再確認が必要です：{stale.map((w) => `${w.slot}作目「${w.title}」（${w.days}日前に確認）`).join('・')}。
          <span className="block font-normal">
            確認日は配信中であることの保証ではありません。動画を作る前・公開する前に、作品ページや各サービスで配信中か確かめ、配信されていなければ「配信確認待ちにして自動変更」を押してください。
            （この表示は警告です。生成は止めません。配信確認待ち・除外にした作品だけが動画の対象外になります）
          </span>
        </p>
      )}
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
                {w.access && (
                  <span className="block text-[11px] text-slate-600">
                    {w.access}：{(w.services ?? []).slice(0, 3).join('・') || '—'}
                    {w.extra ? '（本人が出演する番組・ライブ等）' : ''}
                  </span>
                )}
                {(() => {
                  const days = daysSinceFirst3Check(w.checkedAt);
                  if (!w.checkedAt) return null;
                  return (
                    <span className={`block text-[11px] ${days !== null && days >= FIRST3_CHECK_STALE_DAYS ? 'text-amber-700' : 'text-gray-500'}`}>
                      配信確認: {w.checkedAt}
                      {days !== null ? `（${days}日前）` : ''}
                      {days !== null && days >= FIRST3_CHECK_STALE_DAYS ? ' ⚠ 確認から日数がたっています。配信中か確かめてください' : ''}
                    </span>
                  );
                })()}
                {w.reason && <span className="block text-[11px] text-gray-500">理由: {w.reason}</span>}
                {w.videoTitle && (
                  <span className="block text-[11px] text-violet-700">動画では「{w.videoTitle}」と表示・ナレーション（正式名称はそのまま作品カードに小さく表示）</span>
                )}
                {w.titleTooLong && (
                  <span className="block text-[11px] text-amber-700">
                    ⚠ 作品名が長く、作品カードで2行に収まりません（ナレーションも長くなります）。必要なら「動画用の表示名」で意味が変わらない短い名前を設定してください。
                  </span>
                )}
                {w.id && (
                  <a href={`/work/${encodeURIComponent(w.id)}`} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-violet-700 underline">
                    作品ページで最新の配信を確認
                  </a>
                )}
                {onVideoTitle && w.id && titleEdit?.slot === slot && (
                  <span className="mt-1 block space-y-1">
                    <input
                      type="text"
                      value={titleEdit.value}
                      maxLength={40}
                      onChange={(e) => setTitleEdit({ slot, value: e.target.value })}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      aria-label="動画用の表示名"
                    />
                    <span className="block text-[11px] text-gray-500">正式名称：{w.title}（40文字まで。番組名・作品名の意味が変わる省略はしないでください）</span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !titleEdit.value.trim()}
                        onClick={() => void onVideoTitle(slot, w.id!, titleEdit.value.trim()).then(() => setTitleEdit(null))}
                        className="px-2 py-0.5 rounded bg-violet-600 text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                      {w.videoTitle && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onVideoTitle(slot, w.id!, null).then(() => setTitleEdit(null))}
                          className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:opacity-50"
                        >
                          解除（正式名称に戻す）
                        </button>
                      )}
                      <button type="button" onClick={() => setTitleEdit(null)} className="px-2 py-0.5 rounded border border-gray-300 text-gray-600">
                        やめる
                      </button>
                    </span>
                  </span>
                )}
              </span>
              <span className="shrink-0 flex flex-col items-end gap-1">
              {onVideoTitle && w.id && (w.titleTooLong || w.videoTitle) && titleEdit?.slot !== slot && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setTitleEdit({ slot, value: w.videoTitle ?? w.title })}
                  className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:opacity-50"
                >
                  動画用の表示名
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => toggle(slot)}
                aria-expanded={open}
                className={`shrink-0 px-2 py-0.5 rounded border ${open ? 'border-violet-500 text-violet-700' : 'border-gray-300 text-gray-600'} disabled:opacity-50`}
              >
                変更
              </button>
              </span>
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
                  {onExclude && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void exclude(slot, 'exclude')}
                        className="px-2 py-1 rounded border border-gray-300 text-gray-700 disabled:opacity-50"
                      >
                        この作品を除外して自動変更
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void exclude(slot, 'vod_check')}
                        className="px-2 py-1 rounded border border-amber-300 text-amber-800 disabled:opacity-50"
                      >
                        配信確認待ちにして自動変更
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openManual()}
                    className={`px-2 py-1 rounded border ${mode === 'manual' ? 'border-violet-500 text-violet-700' : 'border-gray-300 text-gray-700'} disabled:opacity-50`}
                  >
                    候補作品から手動選択
                  </button>
                </div>
                <p className="text-gray-500">
                  自動変更は現在の選定基準で別の作品を選びます（押すたびに別の候補へ）。除外・配信確認待ちにした作品は、解除するまでこの人物の選定・変更の候補にしません（ほかの人物には影響しません。代わりの作品が無いときは除外しません）。ほかの2作品は変わりません。
                </p>
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
                    {candidates && selectableCount === 0 && <p className="text-amber-700">変更可能な候補作品がありません。</p>}
                    {candidates && selectableCount > 0 && shown.length === 0 && <p className="text-gray-500">該当する作品がありません。</p>}
                    {candidates && shown.length > 0 && (
                      <ul className="max-h-64 overflow-y-auto divide-y divide-gray-200 rounded border border-gray-200 bg-white">
                        {shown.map((c) => {
                          const key = normalizeFirst3Title(c.title);
                          const reason =
                            key === currentKey
                              ? '変更前の作品'
                              : otherKeys.has(key)
                                ? '選定中の作品と同じ'
                                : excludedIds.has(c.id)
                                  ? excludedWorks.find((w) => w.id === c.id)?.kind === 'vod_check'
                                    ? '配信確認待ち'
                                    : '除外中'
                                  : c.excludedReason
                                    ? c.excludedReason
                                    : !usable(c)
                                      ? '見放題・無料の配信先なし'
                                      : null;
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
                                  {reason
                                    ? `（${reason}）`
                                    : c.flatServices.length > 0
                                      ? `・見放題 ${c.flatServices.join('・')}`
                                      : `・無料 ${(c.freeServices ?? []).join('・')}`}
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
      {excludedWorks.length > 0 && (
        <div className="pt-1 border-t border-gray-100">
          <p className="font-bold text-gray-600">除外中・配信確認待ちの作品（この人物の選定・変更の候補にしません）</p>
          <ul className="space-y-0.5">
            {excludedWorks.map((w) => (
              <li key={w.id} className="flex items-start justify-between gap-2">
                <span className="text-gray-700 break-all">
                  {w.kind === 'vod_check' ? <span className="mr-1 rounded bg-amber-50 px-1 text-amber-800">配信確認待ち</span> : <span className="mr-1 rounded bg-gray-100 px-1">除外</span>}
                  {w.title}
                </span>
                {onUnexclude && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onUnexclude(w.id, w.title)}
                    className="shrink-0 px-2 py-0.5 rounded border border-gray-300 text-gray-600 disabled:opacity-50"
                  >
                    除外を解除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
