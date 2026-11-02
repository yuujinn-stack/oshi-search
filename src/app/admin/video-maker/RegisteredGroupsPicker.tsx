'use client';

import { useEffect, useMemo, useState } from 'react';
import CopyButton from './CopyButton';
import { nonReadableParts } from '@/lib/video-sonkamo-script';
import {
  EMPTY_REGISTERED_SELECTION,
  REGISTERED_CATEGORIES,
  REGISTERED_CATEGORY_LABEL,
  REGISTERED_REEL_SOFT_MAX_SECONDS,
  REGISTERED_TEMPLATE_SPECS,
  allocateRegisteredSlots,
  applyRegisteredSelection,
  buildRegisteredPlan,
  checkRegisteredLines,
  registeredReelMaxSeconds,
  registeredStoryLinkUrl,
  type RegisteredCounts,
  type RegisteredGroup,
  type RegisteredLine,
  type RegisteredPage,
  type RegisteredSegment,
  type RegisteredSelection,
  type RegisteredTemplateId,
} from '@/lib/video-registered-groups';
import { REGISTERED_VIDEO_COLORS, registeredHeadingAccent } from '@/lib/registered-video-design';

// 動画「登録グループ紹介」（リール5種類・ストーリーズ5種類）の対象グループ・表示順・台本・プレビュー。
// 1. 現在の登録グループ（トップページ「グループで探す」と同じ一覧・同じ順）と登録人物数を読み込む
// 2. このテンプレートの対象ジャンルのグループを確認し、表示しないグループを外す・表示順を変える
// 3. リールは「台本を生成」→ 音声用台本（ひらがな）をコピーして CapCut へ。ストーリーズは「プレビューを作成」（音声なし）
// 4. ページ分けしたプレビューで確認してから生成。グループ名・件数はジョブ作成時にサーバーがDBから作り直す（画面の値は使わない）
// ジャンルはトップページの明示的な分類だけ。分類の無いグループは「分類なし」で、男性・女性・その他の動画には入れない。

export interface RegisteredPick {
  selection: RegisteredSelection;
  lines: RegisteredLine[] | null;
  segments: RegisteredSegment[] | null;
  title: string | null;
  counts: RegisteredCounts | null;
  warnings: string[];
  /** 台本・プレビューを作ったときのテンプレート・選択・登録データ（変わったら作り直す） */
  scriptKey: string | null;
}

export const EMPTY_REGISTERED_PICK: RegisteredPick = { selection: EMPTY_REGISTERED_SELECTION, lines: null, segments: null, title: null, counts: null, warnings: [], scriptKey: null };

const keyOf = (templateId: string, selection: RegisteredSelection, groups: RegisteredGroup[] | null, personCount: number | null) =>
  JSON.stringify([templateId, selection, groups?.map((g) => `${g.name}:${g.category}`), personCount]);

export function registeredPickReady(p: RegisteredPick, templateId: RegisteredTemplateId): boolean {
  if (!p.segments || !p.scriptKey?.startsWith(JSON.stringify([templateId, p.selection]).slice(0, -1))) return false;
  if (REGISTERED_TEMPLATE_SPECS[templateId].kind === 'story') return true;
  return !!p.lines && p.lines.length === p.segments.length && p.lines.every((l) => l.text.trim() && l.kana.trim() && nonReadableParts(l.kana).length === 0);
}

/** 管理画面からジョブに送る入力（区間・件数はサーバーが付ける） */
export function registeredTemplateInput(p: RegisteredPick, templateId: RegisteredTemplateId) {
  return { version: 1, selection: p.selection, lines: REGISTERED_TEMPLATE_SPECS[templateId].kind === 'reel' ? p.lines ?? [] : [] };
}

const SEGMENT_KIND_LABEL: Record<RegisteredSegment['kind'], string> = { hook: '冒頭', list: '一覧', screen: '実際のサイト画面', stats: '登録状況', message: 'メッセージ', outro: '締め' };
const CATEGORY_BADGE: Record<RegisteredGroup['category'], string> = {
  male: 'bg-sky-100 text-sky-800',
  female: 'bg-pink-100 text-pink-800',
  other: 'bg-emerald-100 text-emerald-800',
  unclassified: 'bg-gray-100 text-gray-600',
};

export default function RegisteredGroupsPicker({ templateId, value, onChange }: { templateId: RegisteredTemplateId; value: RegisteredPick; onChange: (next: RegisteredPick) => void }) {
  const spec = REGISTERED_TEMPLATE_SPECS[templateId];
  const reel = spec.kind === 'reel';
  const [groups, setGroups] = useState<RegisteredGroup[] | null>(null);
  const [personCount, setPersonCount] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  const load = async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/video-jobs/registered-candidates', { cache: 'no-store' });
      const data = (await res.json()) as { groups?: RegisteredGroup[]; personCount?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setGroups(data.groups ?? []);
      setPersonCount(data.personCount ?? 0);
    } catch (err) {
      setLoadError(String(err instanceof Error ? err.message : err));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const selection = value.selection;
  const setSelection = (next: RegisteredSelection) => onChange({ ...value, selection: next });
  const { ordered } = useMemo(() => applyRegisteredSelection(groups ?? [], selection), [groups, selection]);
  const excluded = new Set(selection.excluded);
  const targets = ordered.filter((g) => spec.categories.includes(g.category));
  const others = (groups ?? []).filter((g) => !spec.categories.includes(g.category));
  const unclassified = (groups ?? []).filter((g) => g.category === 'unclassified');
  const shownCount = targets.filter((g) => !excluded.has(g.name)).length;

  /** 対象のグループの中で i 番目と j 番目を入れ替える（全体の並び順の中の位置を入れ替える） */
  const swap = (i: number, j: number) => {
    if (j < 0 || j >= targets.length) return;
    const all = ordered.map((g) => g.name);
    const a = all.indexOf(targets[i].name);
    const b = all.indexOf(targets[j].name);
    [all[a], all[b]] = [all[b], all[a]];
    setSelection({ ...selection, order: all });
  };
  const toggle = (name: string) =>
    setSelection({ ...selection, excluded: excluded.has(name) ? selection.excluded.filter((n) => n !== name) : [...selection.excluded, name] });

  const currentKey = keyOf(templateId, selection, groups, personCount);
  const stale = !!value.scriptKey && value.scriptKey !== currentKey;

  const generate = () => {
    if (!groups || personCount === null) return;
    const plan = buildRegisteredPlan({ templateId, groups, personCount, selection });
    if (!plan.ok) {
      setMissing(plan.missing);
      onChange({ ...value, lines: null, segments: null, title: null, counts: null, warnings: [], scriptKey: null });
      return;
    }
    setMissing([]);
    onChange({ ...value, lines: plan.lines, segments: plan.segments, title: plan.title, counts: plan.counts, warnings: plan.warnings, scriptKey: currentKey });
  };

  const editLine = (id: string, key: 'text' | 'kana', text: string) => {
    if (!value.lines || !value.segments) return;
    const lines = value.lines.map((l) => (l.id === id ? { ...l, [key]: text } : l));
    // 読みが変わったら区間の長さ（見積もり）も合わせる（サーバーもジョブ作成時に同じ計算をする）
    const slots = allocateRegisteredSlots(spec.kind, value.segments, lines, spec.reelTiming);
    onChange({ ...value, lines, segments: value.segments.map((s, i) => ({ ...s, slotSeconds: slots[i] })) });
  };

  const lines = value.lines ?? [];
  const speechScript = lines.map((l) => l.kana).join('\n');
  const unreadable = [...new Set(lines.flatMap((l) => nonReadableParts(l.kana)))];
  const totalSeconds = (value.segments ?? []).reduce((a, s) => a + s.slotSeconds, 0);
  const checks = value.segments && reel ? checkRegisteredLines(value.segments, lines) : [];
  const linkUrl = registeredStoryLinkUrl(templateId);

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{spec.guide}</p>
      {loadError && (
        <p className="text-xs text-red-600">
          登録グループを読み込めませんでした: {loadError}
          <button type="button" onClick={() => void load()} className="ml-2 underline">
            再読み込み
          </button>
        </p>
      )}
      {!groups && !loadError && <p className="text-xs text-gray-500">登録グループを読み込み中…</p>}
      {groups && personCount !== null && (
        <div className="text-xs text-gray-700 flex flex-wrap gap-4 items-center">
          <span>
            現在の登録: 人物 <b>{personCount}</b>人・グループ <b>{groups.length}</b>組（トップページと同じ一覧）
            {/* ジャンル別の内訳（トップページの分類。0組のジャンルは出さない） */}
            {'　'}
            {REGISTERED_CATEGORIES.map((c) => [c, groups.filter((g) => g.category === c).length] as const)
              .filter(([, n]) => n > 0)
              .map(([c, n]) => `${REGISTERED_CATEGORY_LABEL[c]} ${n}組`)
              .join('・')}
          </span>
          <button type="button" onClick={() => void load()} className="text-violet-600 hover:underline">
            最新の登録を読み込み直す
          </button>
        </div>
      )}

      {groups && spec.categories.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="font-bold text-slate-700">
              {spec.sampleOnly ? '表示するグループ（先頭の1ページ分だけ動画に出ます）' : '表示するグループ'}: {shownCount}組 / 対象 {targets.length}組
            </span>
            <span className="text-gray-500">選んだグループをまとめて1本の動画にします（人物ごとには作りません）</span>
            {selection.order && (
              <button type="button" onClick={() => setSelection({ ...selection, order: null })} className="text-violet-600 hover:underline">
                表示順を元に戻す
              </button>
            )}
            {selection.excluded.length > 0 && (
              <button type="button" onClick={() => setSelection({ ...selection, excluded: [] })} className="text-violet-600 hover:underline">
                除外をすべて戻す
              </button>
            )}
          </div>
          {targets.length === 0 ? (
            <p className="text-xs text-amber-700">このテンプレートの対象ジャンル（{spec.categories.map((c) => REGISTERED_CATEGORY_LABEL[c]).join('・')}）に登録グループがありません。</p>
          ) : (
            <ol className="space-y-1 max-h-80 overflow-y-auto">
              {targets.map((g, i) => (
                <li key={g.name} className={`flex items-center gap-2 text-sm rounded px-2 py-1 ${excluded.has(g.name) ? 'bg-gray-50 text-gray-400' : 'bg-white'}`}>
                  <input type="checkbox" checked={!excluded.has(g.name)} onChange={() => toggle(g.name)} aria-label={`${g.name}を表示する`} />
                  <span className="w-6 text-right text-xs text-gray-400">{i + 1}</span>
                  <span className={`flex-1 break-all ${excluded.has(g.name) ? 'line-through' : 'text-slate-800'}`}>{g.name}</span>
                  {spec.byCategory && <span className={`text-[10px] rounded px-1.5 py-0.5 ${CATEGORY_BADGE[g.category]}`}>{REGISTERED_CATEGORY_LABEL[g.category]}</span>}
                  <a href={g.href} target="_blank" rel="noopener noreferrer" className="text-[10px] text-violet-600 hover:underline">
                    ページ
                  </a>
                  <button type="button" disabled={i === 0} onClick={() => swap(i, i - 1)} className="px-1 text-gray-500 disabled:text-gray-200" aria-label="上へ">
                    ↑
                  </button>
                  <button type="button" disabled={i === targets.length - 1} onClick={() => swap(i, i + 1)} className="px-1 text-gray-500 disabled:text-gray-200" aria-label="下へ">
                    ↓
                  </button>
                </li>
              ))}
            </ol>
          )}
          {!spec.byCategory && others.length > 0 && (
            <p className="text-xs text-gray-500">
              対象外（ジャンルが違う）: {others.map((g) => `${g.name}（${REGISTERED_CATEGORY_LABEL[g.category]}）`).join('、')}
            </p>
          )}
          {unclassified.length > 0 && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">
              ⚠ トップページの分類に無いグループ: {unclassified.map((g) => g.name).join('、')}。推測で振り分けないため、男性・女性・その他の動画には入りません
              （全グループの一覧では「分類なし」の見出しで表示します）。分類する場合はトップページ「グループで探す」の分類（src/lib/home-group-category.ts）に追加してください。
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={!groups || personCount === null}
          onClick={generate}
          className="px-4 py-1.5 rounded-lg border border-violet-600 text-violet-700 text-sm font-bold disabled:border-gray-300 disabled:text-gray-400"
        >
          {reel ? (value.lines ? '台本を作り直す' : '台本を生成') : value.segments ? 'プレビューを作り直す' : 'プレビューを作成'}
        </button>
        {stale && <span className="text-xs text-amber-700">選択・登録データが変わりました。「{reel ? '台本を作り直す' : 'プレビューを作り直す'}」を押してください。</span>}
      </div>
      {missing.length > 0 && <p className="text-xs text-red-600">{missing.join(' / ')}</p>}

      {value.segments && value.counts && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs text-gray-600 flex flex-wrap gap-3">
            <span>
              動画タイトル: <b className="text-slate-800">{value.title}</b>
            </span>
            <span className={reel && totalSeconds > registeredReelMaxSeconds(value.segments) ? 'text-red-600' : reel && totalSeconds > REGISTERED_REEL_SOFT_MAX_SECONDS ? 'text-amber-700' : ''}>
              {reel ? `音声なし動画の長さの目安 ${totalSeconds.toFixed(1)}秒（目安15〜18秒・${registeredReelMaxSeconds(value.segments)}秒まで）` : `長さ ${totalSeconds.toFixed(1)}秒（音声なし）`}
            </span>
            {value.counts.shown > 0 && <span>一覧 {value.counts.shown}組{value.counts.excluded > 0 ? `（除外 ${value.counts.excluded}組）` : ''}</span>}
          </div>
          {value.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-800">
              ⚠ {w}
            </p>
          ))}
          <RegisteredPreview segments={value.segments} story={!reel} />
          {linkUrl && (
            <div className="flex items-center gap-2 flex-wrap text-xs bg-sky-50 rounded p-2">
              <span className="font-bold text-sky-800">リンクスタンプの推奨URL</span>
              <code className="bg-white border border-gray-200 rounded px-2 py-0.5">{linkUrl}</code>
              <CopyButton text={linkUrl} label="URLをコピー" />
              <span className="text-gray-500">（リンクスタンプは Instagram でストーリーズを投稿するときに手動で付けてください。動画の下部はスタンプ用に空けています）</span>
            </div>
          )}
          {reel && value.lines && (
            <>
              <div>
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <span className="text-xs font-bold text-violet-700">音声生成用台本（ひらがな）← CapCutにはこちらを貼る</span>
                  <CopyButton text={speechScript} label="音声用台本をコピー" primary disabled={unreadable.length > 0} disabledTitle="読みに漢字・英字・数字が残っているためコピーできません" />
                </div>
                <pre className="whitespace-pre-wrap text-xs bg-violet-50 rounded p-2 text-slate-700">{speechScript}</pre>
                {unreadable.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded p-2 mt-1">⚠ 読みに漢字・英字・数字が残っています：{unreadable.join('・')}</p>}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-600">区間と台本（字幕＝画面の正式表記／読み＝音声用。グループ名は読み上げません。1文ずつ直せます）</summary>
                <div className="space-y-2 mt-2">
                  {value.segments.map((sg, i) => {
                    const l = lines[i];
                    const c = checks.find((x) => x.id === l?.id);
                    if (!l) return null;
                    return (
                      <div key={sg.id} className="rounded border border-gray-100 p-2 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-700">
                            {i + 1}. {SEGMENT_KIND_LABEL[sg.kind]}
                            {sg.pages ? `（${sg.pages.length}ページ）` : ''}
                          </span>
                          {c && <span className={c.overlong ? 'text-amber-700' : 'text-emerald-700'}>{c.overlong ? '⚠ ' : '✓ '}約{c.estimateSeconds.toFixed(1)}秒 / {c.slotSeconds.toFixed(1)}秒</span>}
                        </div>
                        <input value={l.text} onChange={(e) => editLine(l.id, 'text', e.target.value)} aria-label={`${i + 1}文目の字幕`} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                        <input value={l.kana} onChange={(e) => editLine(l.id, 'kana', e.target.value)} aria-label={`${i + 1}文目の読み`} className="w-full border border-gray-100 bg-gray-50 rounded px-2 py-1 text-xs text-slate-600" />
                      </div>
                    );
                  })}
                </div>
              </details>
              <p className="text-xs text-gray-500">まず音声なしで動画を作り、完成した動画の「詳細」に表示されるファイル名で CapCut から WAV と SRT を受信フォルダへ書き出すと、音声付きの動画が自動でできます。</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * プレビューの名前の文字の大きさ（縮小した枠でも英語の語の途中で折り返さないよう、長い英語の語ほど小さくする。日本語は1文字ずつ折り返してよい）。
 * 語の幅は動画と同じ目安（英大文字=0.8・英小文字/数字=0.64・記号=0.5 文字分）。動画は語の途中で切らずに折り返す
 */
function previewNameSize(name: string, columns: number): number {
  const em = (w: string) => Array.from(w).reduce((a, ch) => a + (/[A-Z]/.test(ch) ? 0.8 : /[a-z0-9]/.test(ch) ? 0.64 : 0.5), 0);
  const longest = Math.max(0, ...(name.match(/[\x21-\x7E]+/g) ?? []).map(em));
  const innerPx = columns >= 3 ? 26 : columns === 2 ? 42 : 96;
  return longest === 0 ? 9 : Math.max(6, Math.min(9, Math.floor(innerPx / longest)));
}

/** ページ分けのプレビュー（動画の各画面を縮小して並べる。配色・ラベル・締めの黄色のパネルは完成動画と同じ。文字の大きさ・位置は目安。実際の画面は生成した動画で確認） */
function RegisteredPreview({ segments, story }: { segments: RegisteredSegment[]; story: boolean }) {
  const C = REGISTERED_VIDEO_COLORS;
  const frames: Array<{ sg: RegisteredSegment; page: RegisteredPage | null; k: number }> = segments.flatMap((sg) =>
    sg.pages && sg.pages.length > 0 ? sg.pages.map((p, k) => ({ sg, page: p as RegisteredPage | null, k })) : [{ sg, page: null, k: 0 }],
  );
  const marker = (color: string) => ({ backgroundImage: `linear-gradient(transparent 60%, ${color} 60%)` });
  return (
    <div>
      <p className="text-xs font-bold text-slate-700 mb-1">プレビュー（{frames.length}画面・{story ? 'ストーリーズ' : 'リール'}）</p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {frames.map(({ sg, page, k }) => {
          const accent = page ? registeredHeadingAccent(page.heading) : null;
          return (
            <div
              key={`${sg.id}-${k}`}
              data-testid="registered-preview-frame"
              className="shrink-0 w-[135px] h-[240px] rounded-lg border p-2 flex flex-col text-[9px] leading-tight"
              style={{ background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgMid} 42%, ${C.bgBottom} 100%)`, borderColor: C.line, color: C.ink }}
            >
              <div className="text-[8px] mb-1" style={{ color: C.muted }}>
                {sg.slotSeconds.toFixed(1)}秒{sg.pages && sg.pages.length > 1 ? ` ÷ ${sg.pages.length}` : ''} ・ {SEGMENT_KIND_LABEL[sg.kind]}
              </div>
              {page && accent ? (
                <>
                  <div className="flex justify-between items-center font-bold mb-1 gap-1">
                    <span className="truncate rounded-full px-1" style={{ backgroundColor: accent.soft, color: accent.ink }}>{page.heading}</span>
                    <span className="shrink-0" style={{ color: C.head }}>
                      <span style={marker(C.yellow)}>{page.count}</span>
                      <span className="ml-0.5" style={{ color: C.ink }}>組</span>
                      {page.parts > 1 ? (
                        <span className="ml-1 rounded-full border bg-white px-1 text-[7px]" style={{ color: C.muted, borderColor: C.line }}>
                          {page.part}/{page.parts}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${page.columns}, minmax(0, 1fr))` }}>
                    {page.items.map((it) => (
                      <div
                        key={it.name}
                        style={{ ...(it.wide ? { gridColumn: '1 / -1' } : {}), backgroundColor: C.surface, borderColor: C.line, boxShadow: `inset 0 -2px 0 ${accent.soft}, 0 2px 0 ${C.yellow}`, fontSize: previewNameSize(it.name, it.wide ? 1 : page.columns) }}
                        className="rounded-md border px-1 py-1.5 text-center font-bold [overflow-wrap:anywhere]"
                      >
                        {it.name}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
                  {sg.label && (
                    <span className="rounded-full px-1.5 font-bold border" style={sg.kind === 'outro' ? { color: C.head } : { backgroundColor: C.yellow, borderColor: C.yellowDeep, color: C.head }}>
                      {sg.label}
                    </span>
                  )}
                  {sg.title &&
                    (sg.kind === 'outro' ? (
                      <span className="font-bold text-[11px] whitespace-pre-line rounded-lg border-2 border-white px-1 py-1.5 w-full" style={{ backgroundColor: C.yellow, color: C.head }}>
                        {sg.title}
                      </span>
                    ) : (
                      <span className="font-bold text-[11px] whitespace-pre-line" style={{ color: C.head }}>{sg.title}</span>
                    ))}
                  {sg.stats && (
                    <span>
                      登録人物 <b style={{ color: C.head }}>{sg.stats.persons}</b>人<br />
                      登録グループ <b style={{ color: C.head }}>{sg.stats.groups}</b>組
                    </span>
                  )}
                  {sg.screen && <span style={{ color: C.muted }}>（トップページ「グループで探す」{sg.screen === 'male' ? '男性アイドル' : sg.screen === 'female' ? '女性アイドル' : 'すべて'}の実画面を撮影）</span>}
                  {(sg.lines ?? []).map((l) => (
                    <span
                      key={l}
                      className="font-bold rounded-full border px-1.5"
                      style={sg.kind === 'outro' ? { backgroundColor: C.surface, borderColor: C.pink, color: C.ink } : { backgroundColor: C.yellow, borderColor: C.yellowDeep, color: C.head }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
