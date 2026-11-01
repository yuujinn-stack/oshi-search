'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import CopyButton from './CopyButton';
import type { SonkamoGroupOption } from './SonkamoTargetPicker';
import { nonReadableParts } from '@/lib/video-sonkamo-script';
import {
  FOLLOW_MAX_SECONDS,
  FOLLOW_RELEASE_KINDS,
  FOLLOW_TEMPLATE_SPECS,
  buildFollowPlan,
  checkFollowLines,
  isEligibleFollowWork,
  nextMondayJst,
  shortDateLabel,
  addDays,
  validateFollowFacts,
  validateFollowWorks,
  type FollowFact,
  type FollowLine,
  type FollowScene,
  type FollowSelection,
  type FollowTargetType,
  type FollowTemplateId,
  type FollowWork,
} from '@/lib/video-follow-reel';

// 動画「フォロー獲得リール」（10種類）の対象・作品・確認済みの事実・台本。
// 1. 人物 または グループを選ぶ → 推しサーチの公開作品を読み込む（グループはメンバーの作品を同じ作品ごとにまとめる）
// 2. テンプレートに必要な作品を選ぶ／公式情報で確認した事実を出典URL・確認日時と一緒に入力する（足りなければ不足を表示して作らない）
// 3. 「台本を生成」→ 読み仮名（固定辞書・登録読み）を当てた台本。読み未登録の語はここで登録できる → 音声用台本を一括コピーして CapCut へ
// 選択・事実・読みが変わったら台本は作り直す（作り直すまで生成できない）。シーンはジョブ作成時にサーバーがDBから作り直す。

export interface FollowPick {
  targetType: FollowTargetType;
  name: string;
  selection: FollowSelection;
  lines: FollowLine[] | null;
  scenes: FollowScene[] | null;
  title: string | null;
  /** 台本を作ったときの選択・読み（変わったら作り直す） */
  scriptKey: string | null;
}

const EMPTY_SELECTION: FollowSelection = { selectedWorkIds: [], facts: [], periodStart: null, pickWorkId: null };
export const EMPTY_FOLLOW_PICK: FollowPick = { targetType: 'person', name: '', selection: EMPTY_SELECTION, lines: null, scenes: null, title: null, scriptKey: null };

const selectionKey = (p: Pick<FollowPick, 'targetType' | 'name' | 'selection'>, templateId: string) => JSON.stringify([templateId, p.targetType, p.name, p.selection]);

export function followPickReady(p: FollowPick, templateId: string): boolean {
  return !!p.name && !!p.lines && p.lines.every((l) => l.text.trim() && l.kana.trim()) && (p.scriptKey ?? '').startsWith(selectionKey(p, templateId));
}

/** 管理画面からジョブに送る入力（シーン等はサーバーが付ける） */
export function followTemplateInput(p: FollowPick) {
  return { version: 1, targetType: p.targetType, ...p.selection, lines: p.lines };
}

const SCENE_KIND_LABEL: Record<FollowScene['kind'], string> = { hook: '冒頭', item: '紹介', compare: 'まとめ・比較', chart: 'グラフ', outro: '締め' };
const FACT_KIND_TITLE = { schedule: '出演予定', release: '新作', streamStart: '新しく配信開始した作品', streamEnd: '配信終了予定' } as const;

const nowLocalInput = () => {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 16);
};

export default function FollowReelPicker({
  templateId,
  persons,
  groups,
  fixedReadings,
  value,
  onChange,
}: {
  templateId: FollowTemplateId;
  persons: PersonOption[];
  groups: SonkamoGroupOption[];
  fixedReadings: Record<string, string>;
  value: FollowPick;
  onChange: (next: FollowPick) => void;
}) {
  const spec = FOLLOW_TEMPLATE_SPECS[templateId];
  const [works, setWorks] = useState<FollowWork[] | null>(null);
  const [personNames, setPersonNames] = useState<string[]>([]);
  const [worksError, setWorksError] = useState<string | null>(null);
  const [readings, setReadings] = useState<Record<string, string> | null>(null);
  const [readingsStatus, setReadingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readingInputs, setReadingInputs] = useState<Record<string, string>>({});
  const [readingBusy, setReadingBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [unresolved, setUnresolved] = useState<string[]>([]);

  const loadReadings = useCallback(async () => {
    setReadingsStatus('loading');
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', { cache: 'no-store' });
      const data = (await res.json()) as { readings?: Array<{ sourceText: string; reading: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReadings(Object.fromEntries((data.readings ?? []).map((r) => [r.sourceText, r.reading])));
      setReadingsStatus('ready');
    } catch (err) {
      setNote({ kind: 'error', text: `登録済みの読みを読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
      setReadingsStatus('error');
    }
  }, []);
  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  // 人物・グループが決まったら公開作品を読み込む
  useEffect(() => {
    setWorks(null);
    setWorksError(null);
    setPersonNames([]);
    if (!value.name) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/video-jobs/follow-candidates?targetType=${value.targetType}&name=${encodeURIComponent(value.name)}`, { cache: 'no-store' });
        const data = (await res.json()) as { works?: FollowWork[]; personNames?: string[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!cancelled) {
          setWorks(data.works ?? []);
          setPersonNames(data.personNames ?? []);
        }
      } catch (err) {
        if (!cancelled) setWorksError(String(err instanceof Error ? err.message : err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value.targetType, value.name]);

  // 出演予定の対象期間は、既定で来週（次の月曜日から7日間）
  useEffect(() => {
    if (spec.period && !value.selection.periodStart) onChange({ ...value, selection: { ...value.selection, periodStart: nextMondayJst(Date.now()) } });
  }, [spec.period, value, onChange]);

  const readingsVersion = useMemo(() => JSON.stringify(readings ? Object.keys(readings).length : 0) + JSON.stringify(Object.keys(fixedReadings).length), [readings, fixedReadings]);
  const currentKey = selectionKey(value, templateId) + readingsVersion;

  const generate = useCallback(
    (base: FollowPick) => {
      if (!works || !readings) return;
      setNote(null);
      const plan = buildFollowPlan({ templateId, targetType: base.targetType, name: base.name, works, selection: base.selection, readings: { fixed: fixedReadings, registered: readings }, nowMs: Date.now() });
      if (!plan.ok) {
        setMissing(plan.missing);
        setUnresolved([]);
        onChange({ ...base, lines: null, scenes: null, title: null, scriptKey: null });
        return;
      }
      setMissing([]);
      setUnresolved(plan.unresolved);
      onChange({ ...base, lines: plan.lines, scenes: plan.scenes, title: plan.title, scriptKey: selectionKey(base, templateId) + readingsVersion });
    },
    [works, readings, templateId, fixedReadings, onChange, readingsVersion],
  );

  // 読みを登録したら（台本を作ってあれば）作り直す
  useEffect(() => {
    if (value.lines && value.scriptKey && value.scriptKey !== currentKey && value.scriptKey.startsWith(selectionKey(value, templateId)) && readingsStatus === 'ready') generate(value);
  }, [value, currentKey, templateId, readingsStatus, generate]);

  const setSelection = (patch: Partial<FollowSelection>) => onChange({ ...value, selection: { ...value.selection, ...patch } });
  const setTarget = (targetType: FollowTargetType, name: string) => {
    setMissing([]);
    setUnresolved([]);
    onChange({ ...EMPTY_FOLLOW_PICK, targetType, name, selection: { ...EMPTY_SELECTION, periodStart: value.selection.periodStart } });
  };

  const toggleWork = (id: string) => {
    const ids = value.selection.selectedWorkIds;
    if (ids.includes(id)) setSelection({ selectedWorkIds: ids.filter((x) => x !== id), pickWorkId: value.selection.pickWorkId === id ? null : value.selection.pickWorkId });
    else if (ids.length < spec.works.max) setSelection({ selectedWorkIds: [...ids, id] });
  };
  const facts = value.selection.facts;
  const setFact = (i: number, patch: Partial<FollowFact>) => setSelection({ facts: facts.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  const addFact = () => spec.facts && setSelection({ facts: [...facts, { kind: spec.facts.kind, date: '', sourceUrl: '', checkedAt: '', ...(spec.facts.kind === 'release' ? { releaseKind: '放送' } : {}) }] });

  async function registerReading(term: string) {
    const reading = (readingInputs[term] ?? '').trim();
    if (!reading) return;
    setReadingBusy(term);
    setNote(null);
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText: term, reading }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNote({ kind: 'ok', text: `「${term}」の読みを「${reading}」で登録しました。` });
      setReadingInputs((prev) => ({ ...prev, [term]: '' }));
      await loadReadings();
    } catch (err) {
      setNote({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setReadingBusy(null);
    }
  }

  const eligible = works?.filter((w) => isEligibleFollowWork(templateId, w)) ?? [];
  const nowMs = Date.now();
  const liveErrors = works ? [...validateFollowWorks(templateId, value.targetType, value.selection, works), ...validateFollowFacts(templateId, value.selection, works, nowMs)] : [];
  const stale = !!value.lines && !(value.scriptKey ?? '').startsWith(selectionKey(value, templateId));
  const lines = value.lines;
  const checks = lines && value.scenes ? checkFollowLines(value.scenes, lines) : [];
  const unreadable = lines ? [...new Set(lines.flatMap((l) => nonReadableParts(l.kana)))] : [];
  const speechScript = lines ? lines.map((l) => l.kana).join('\n') : '';
  const totalSeconds = value.scenes?.reduce((a, s) => a + s.slotSeconds, 0) ?? 0;
  const editLine = (id: string, key: 'text' | 'kana', v: string) => onChange({ ...value, lines: (value.lines ?? []).map((l) => (l.id === id ? { ...l, [key]: v } : l)) });

  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-gray-600 bg-gray-50 rounded p-2">{spec.guide}</p>

      <div className="flex flex-wrap gap-4">
        {(
          [
            ['person', '人物'],
            ['group', 'グループ'],
          ] as const
        ).map(([t, label]) => (
          <label key={t} className={spec.personOnly && t === 'group' ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer'} title={spec.personOnly && t === 'group' ? '1人の人物の役柄を比べるテンプレートのため、グループは選べません' : ''}>
            <input type="radio" name="follow-target" className="mr-1" disabled={spec.personOnly && t === 'group'} checked={value.targetType === t} onChange={() => setTarget(t, '')} />
            {label}
          </label>
        ))}
      </div>
      {value.targetType === 'group' ? (
        <label className="text-xs text-gray-600 block">
          グループ
          <select value={value.name} onChange={(e) => setTarget('group', e.target.value)} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">選択してください</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}（{g.members.length}人）
              </option>
            ))}
          </select>
        </label>
      ) : (
        <PersonCombobox persons={persons} value={value.name} onChange={(n) => setTarget('person', n)} placeholder="人物を選択" />
      )}

      {worksError && <p className="text-xs text-red-600">作品を読み込めませんでした: {worksError}</p>}
      {value.name && !works && !worksError && <p className="text-xs text-gray-500">推しサーチの公開作品を読み込み中…</p>}
      {works && (
        <p className="text-xs text-gray-500">
          推しサーチの公開作品 {works.length}件{value.targetType === 'group' ? `（メンバー${personNames.length}人の作品を同じ作品ごとにまとめた件数）` : ''}
          {spec.works.max > 0 && `／このテンプレートで選べる作品 ${eligible.length}件`}
        </p>
      )}

      {works && spec.works.max > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-bold text-slate-700">
            作品（{spec.works.min === spec.works.max ? `${spec.works.min}本` : `${spec.works.min}〜${spec.works.max}本`}・選んだ順に紹介）
          </p>
          {eligible.length < spec.works.min && <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">⚠ 条件に合う作品が{spec.works.min}本に足りません（{eligible.length}本）。このテンプレートでは生成できません。</p>}
          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded divide-y divide-gray-50">
            {eligible.map((w) => {
              const order = value.selection.selectedWorkIds.indexOf(w.id);
              return (
                <label key={w.id} className="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-violet-50">
                  <input type="checkbox" checked={order >= 0} disabled={order < 0 && value.selection.selectedWorkIds.length >= spec.works.max} onChange={() => toggleWork(w.id)} className="mt-0.5" />
                  <span className="w-5 text-violet-700 font-bold">{order >= 0 ? order + 1 : ''}</span>
                  <span className="flex-1">
                    <span className="font-bold text-slate-800">{w.title}</span>
                    <span className="text-gray-500">
                      {' '}
                      {w.year ? `${w.year}年` : '年不明'}・{w.genreLabel}
                      {w.roleName ? `・${w.roleName}役` : ''}
                      {w.streaming.length > 0 ? `・${w.streaming.map((s) => `${s.provider}（${s.typeLabel}）`).join('・')}` : ''}
                      {value.targetType === 'group' ? `・出演: ${w.persons.join('・')}` : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {spec.pick && value.selection.selectedWorkIds.length > 0 && works && (
        <label className="text-xs text-gray-600 block">
          最後に勧める作品
          <select value={value.selection.pickWorkId ?? ''} onChange={(e) => setSelection({ pickWorkId: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm">
            <option value="">選択してください</option>
            {value.selection.selectedWorkIds.map((id) => (
              <option key={id} value={id}>
                {works.find((w) => w.id === id)?.title ?? id}
              </option>
            ))}
          </select>
        </label>
      )}

      {spec.period && (
        <label className="text-xs text-gray-600 block">
          対象期間の開始日
          <input type="date" value={value.selection.periodStart ?? ''} onChange={(e) => setSelection({ periodStart: e.target.value || null })} className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm" />
          {value.selection.periodStart && <span className="ml-2 text-gray-500">{shortDateLabel(value.selection.periodStart)}〜{shortDateLabel(addDays(value.selection.periodStart, 6))}（7日間）</span>}
        </label>
      )}

      {spec.facts && works && (
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">
            {FACT_KIND_TITLE[spec.facts.kind]}（公式情報で確認できたものだけ・{spec.facts.min}〜{spec.facts.max}件）
          </p>
          {facts.map((f, i) => (
            <div key={i} className="rounded border border-gray-200 p-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {(f.kind === 'schedule' || f.kind === 'release') && (
                <input value={f.title ?? ''} onChange={(e) => setFact(i, { title: e.target.value })} placeholder={f.kind === 'schedule' ? '番組名・作品名（公式の表記）' : '新作の作品名（公式の表記）'} aria-label="番組名・作品名" className="border border-gray-300 rounded px-2 py-1" />
              )}
              {(f.kind === 'streamStart' || f.kind === 'streamEnd') && (
                <select value={f.workId ?? ''} onChange={(e) => setFact(i, { workId: e.target.value || undefined })} aria-label="作品" className="border border-gray-300 rounded px-2 py-1">
                  <option value="">作品を選択（推しサーチの登録作品）</option>
                  {works.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                      {w.year ? `（${w.year}）` : ''}
                    </option>
                  ))}
                </select>
              )}
              {(f.kind === 'streamStart' || f.kind === 'streamEnd') && (
                <input value={f.provider ?? ''} onChange={(e) => setFact(i, { provider: e.target.value })} placeholder="配信サービス名（例: U-NEXT）" aria-label="配信サービス" list="follow-providers" className="border border-gray-300 rounded px-2 py-1" />
              )}
              {f.kind === 'schedule' && <input value={f.media ?? ''} onChange={(e) => setFact(i, { media: e.target.value })} placeholder="放送局・配信先（任意）" aria-label="放送局・配信先" className="border border-gray-300 rounded px-2 py-1" />}
              {f.kind === 'release' && (
                <select value={f.releaseKind ?? ''} onChange={(e) => setFact(i, { releaseKind: e.target.value })} aria-label="放送・公開・配信" className="border border-gray-300 rounded px-2 py-1">
                  {FOLLOW_RELEASE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-1">
                {f.kind === 'schedule' ? '日付' : f.kind === 'release' ? '放送・公開・配信日' : f.kind === 'streamStart' ? '配信開始日' : '配信終了予定日'}
                <input type="date" value={f.date} onChange={(e) => setFact(i, { date: e.target.value })} className="border border-gray-300 rounded px-2 py-1" />
                {f.kind === 'schedule' && <input type="time" value={f.time ?? ''} onChange={(e) => setFact(i, { time: e.target.value || undefined })} aria-label="時刻（任意）" className="border border-gray-300 rounded px-2 py-1" />}
              </label>
              <input value={f.sourceUrl} onChange={(e) => setFact(i, { sourceUrl: e.target.value.trim() })} placeholder="公式情報のURL（必須）" aria-label="出典URL" className="border border-gray-300 rounded px-2 py-1" />
              <label className="flex items-center gap-1">
                確認日時
                <input type="datetime-local" value={f.checkedAt} onChange={(e) => setFact(i, { checkedAt: e.target.value })} className="border border-gray-300 rounded px-2 py-1" />
                <button type="button" onClick={() => setFact(i, { checkedAt: nowLocalInput() })} className="text-violet-600 hover:underline whitespace-nowrap">
                  今確認した
                </button>
              </label>
              <button type="button" onClick={() => setSelection({ facts: facts.filter((_, k) => k !== i) })} className="text-left text-red-600 hover:underline">
                この情報を削除
              </button>
            </div>
          ))}
          <datalist id="follow-providers">
            {[...new Set(works.flatMap((w) => w.streaming.map((s) => s.provider)))].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {facts.length < spec.facts.max && (
            <button type="button" onClick={addFact} className="text-xs text-violet-700 hover:underline">
              ＋ 確認済みの{FACT_KIND_TITLE[spec.facts.kind]}を追加
            </button>
          )}
        </div>
      )}

      {works && liveErrors.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 rounded p-2">
          <p className="font-bold">不足している情報（そろうまで台本・動画は作れません）</p>
          <ul className="list-disc ml-5">
            {liveErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={!works || liveErrors.length > 0 || readingsStatus !== 'ready'}
          onClick={() => generate(value)}
          className="px-4 py-1.5 rounded-lg border border-violet-600 text-violet-700 text-sm font-bold disabled:border-gray-300 disabled:text-gray-400"
        >
          {lines ? '台本を作り直す' : '台本を生成'}
        </button>
        {readingsStatus === 'loading' && <span className="text-xs text-gray-500">読み仮名を読み込み中…</span>}
        {readingsStatus === 'error' && (
          <span className="text-xs text-red-600">
            読み仮名を読み込めないため、台本を生成できません。
            <button type="button" onClick={() => void loadReadings()} className="ml-2 underline">
              再読み込み
            </button>
          </span>
        )}
        {stale && <span className="text-xs text-amber-700">選択・入力が変わりました。「台本を作り直す」を押してください。</span>}
        {note && <span className={`text-xs ${note.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</span>}
      </div>
      {missing.length > 0 && <p className="text-xs text-red-600">{missing.join(' / ')}</p>}

      {lines && value.scenes && (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="text-xs text-gray-600 flex flex-wrap gap-3">
            <span>
              動画タイトル: <b className="text-slate-800">{value.title}</b>
            </span>
            <span className={totalSeconds > FOLLOW_MAX_SECONDS ? 'text-red-600' : ''}>音声なし動画の長さの目安 {totalSeconds.toFixed(1)}秒（{FOLLOW_MAX_SECONDS}秒まで）</span>
          </div>
          {unresolved.length > 0 && (
            <div className="bg-amber-50 text-amber-800 rounded p-2 space-y-2 text-xs">
              <p className="font-bold">⚠ 読み未登録：{unresolved.join('・')}（登録すると台本を自動で作り直します）</p>
              {unresolved.map((term) => (
                <div key={term} className="flex gap-2 items-center flex-wrap">
                  <span className="w-48 truncate">{term}</span>
                  <input
                    value={readingInputs[term] ?? ''}
                    onChange={(e) => setReadingInputs((prev) => ({ ...prev, [term]: e.target.value }))}
                    placeholder="読みをひらがな・カタカナで（確認してから登録）"
                    className="border border-amber-300 rounded px-2 py-1 text-sm w-64 bg-white"
                  />
                  <button
                    type="button"
                    disabled={readingBusy === term || !(readingInputs[term] ?? '').trim()}
                    onClick={() => void registerReading(term)}
                    className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-bold disabled:bg-gray-300"
                  >
                    {readingBusy === term ? '登録中...' : '読みを登録'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
              <span className="text-xs font-bold text-violet-700">音声生成用台本（読み）← CapCutにはこちらを貼る</span>
              <CopyButton text={speechScript} label="音声用台本をコピー" primary disabled={unreadable.length > 0} disabledTitle="読み未登録の語があるためコピーできません" />
            </div>
            <pre className="whitespace-pre-wrap text-xs bg-violet-50 rounded p-2 text-slate-700">{speechScript}</pre>
            {unreadable.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded p-2 mt-1">⚠ 読みに漢字・英字・数字が残っています：{unreadable.join('・')}</p>}
          </div>
          <details open className="text-xs">
            <summary className="cursor-pointer text-gray-600">シーンと台本（字幕＝画面の正式表記／読み＝音声用。1文ずつ直せます）</summary>
            <div className="space-y-2 mt-2">
              {value.scenes.map((sc, i) => {
                const l = lines[i];
                const c = checks.find((x) => x.id === l.id);
                return (
                  <div key={sc.id} className="rounded border border-gray-100 p-2 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-700">
                        {i + 1}. {SCENE_KIND_LABEL[sc.kind]}
                      </span>
                      <span className="text-gray-500">
                        画面: {[sc.label, sc.title, ...(sc.lines ?? [])].filter(Boolean).join(' ／ ')}
                        {sc.bars ? ` ／ ${sc.bars.map((b) => `${b.label} ${b.count}`).join('・')}` : ''}
                      </span>
                      {c && <span className={c.overlong ? 'text-amber-700' : 'text-emerald-700'}>{c.overlong ? '⚠ ' : '✓ '}約{c.estimateSeconds.toFixed(1)}秒 / {c.slotSeconds.toFixed(1)}秒</span>}
                    </div>
                    {sc.note && <p className="text-gray-400">注記: {sc.note}</p>}
                    <input value={l.text} onChange={(e) => editLine(l.id, 'text', e.target.value)} aria-label={`${i + 1}文目の字幕`} className="w-full border border-gray-200 rounded px-2 py-1 text-sm" />
                    <input value={l.kana} onChange={(e) => editLine(l.id, 'kana', e.target.value)} aria-label={`${i + 1}文目の読み`} className="w-full border border-gray-100 bg-gray-50 rounded px-2 py-1 text-xs text-slate-600" />
                  </div>
                );
              })}
            </div>
          </details>
          <p className="text-xs text-gray-500">まず音声なしで動画を作り、完成した動画の「詳細」から CapCut で書き出した WAV と SRT を取り込むと、音声付きの動画ができます。</p>
        </div>
      )}
    </div>
  );
}
