'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import PersonMultiSelect from '../instagram-schedule/PersonMultiSelect';
import CopyButton from './CopyButton';
import {
  buildSonkamoLines,
  buildSonkamoTitle,
  checkSonkamoLines,
  resolveSonkamoNameKana,
  type SonkamoLine,
  type SonkamoScriptTemplate,
  type SonkamoTarget,
} from '@/lib/video-sonkamo-script';

// 動画「推し活で損してるかも？ V1」の対象と原稿。
// ・グループ紹介: グループを1つ選ぶ → グループ全体の動画1本（グループページだけで作る。メンバー個人の選択は不要）
// ・人物紹介: 人物を1人以上選ぶ → 1人につき1本
// 「ナレーション原稿を生成」で選んだ対象ごとに原稿を作る（雛形は Worker の報告。正本は oshi-video-maker）。
// 音声は今までのテンプレートと同じ運用: 動画全体の音声用台本（ひらがな中心の読み）を一括コピー → CapCut に貼って好きなAI音声で読み上げる
// （動画には音声を入れない）。名前の読みが無いときは、既存の読み登録（pronunciation_readings）に登録する。
// 原稿を作ったあとで対象・敬称・読みが変わったら、原稿を自動で作り直す。

export interface SonkamoGroupOption {
  name: string;
  members: string[];
}

export interface SonkamoPick {
  target: SonkamoTarget;
  /** グループ紹介はグループ名1つ、人物紹介は人物名（選んだ順。1人につき1本） */
  names: string[];
  honorific: string;
  /** 対象ごとの原稿（「ナレーション原稿を生成」で作る。編集後） */
  scripts: Record<string, SonkamoLine[]>;
  /** 対象ごとに、原稿を作ったときの種類・敬称・名前の読み（変わったら自動で作り直す） */
  scriptKeys: Record<string, string>;
}

export const EMPTY_SONKAMO_PICK: SonkamoPick = { target: 'group', names: [], honorific: '', scripts: {}, scriptKeys: {} };

const LINE_LABELS: Record<string, string> = {
  '01-hook': '1. 冒頭の呼びかけ',
  '02-works': '2. 出演作品',
  '03-vod': '3. 配信先',
  '04-goods': '4. 関連商品',
  '05-cta': '5. 推しサーチへ',
};

const keyPrefix = (p: Pick<SonkamoPick, 'target' | 'honorific'>) => `${p.target}|${p.honorific}|`;
const scriptKey = (p: Pick<SonkamoPick, 'target' | 'honorific'>, kana: string | null) => `${keyPrefix(p)}${kana ?? ''}`;

/** 生成できるか（対象を選び、全員ぶんの原稿が今の種類・敬称で作ってある） */
export function sonkamoPickReady(p: SonkamoPick): boolean {
  return (
    p.names.length > 0 &&
    p.names.every((n) => p.scripts[n]?.every((l) => l.text.trim() && l.kana.trim()) && (p.scriptKeys[n] ?? '').startsWith(keyPrefix(p)))
  );
}

export default function SonkamoTargetPicker({
  template,
  persons,
  groups,
  value,
  onChange,
}: {
  template: SonkamoScriptTemplate | null;
  persons: PersonOption[];
  groups: SonkamoGroupOption[];
  value: SonkamoPick;
  onChange: (next: SonkamoPick) => void;
}) {
  const [readings, setReadings] = useState<Record<string, string> | null>(null);
  // 登録済みの読みの読み込み状態。読み込み中・失敗の間は原稿を作らない（名前が読みに変換されない原稿を防ぐ）
  const [readingsStatus, setReadingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readingInputs, setReadingInputs] = useState<Record<string, string>>({});
  const [readingBusy, setReadingBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const loadReadings = useCallback(async () => {
    setReadingsStatus('loading');
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', { cache: 'no-store' });
      const data = (await res.json()) as { readings?: Array<{ sourceText: string; reading: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReadings(Object.fromEntries((data.readings ?? []).map((r) => [r.sourceText, r.reading])));
      setReadingsStatus('ready');
    } catch (err) {
      // 失敗したときは空の一覧で代用しない（全員が「読み未登録」扱いの原稿になってしまうため）。再読み込みできるようにする
      setNote({ kind: 'error', text: `登録済みの読みを読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
      setReadingsStatus('error');
    }
  }, []);
  useEffect(() => {
    void loadReadings();
  }, [loadReadings]);

  /** 対象ごとの名前の読み（固定辞書 → 登録済みの読み → ひらがな・カタカナの名前。無ければ null） */
  const kanaByName = useMemo(() => {
    const out: Record<string, ReturnType<typeof resolveSonkamoNameKana>> = {};
    if (template && readings) for (const n of value.names) out[n] = resolveSonkamoNameKana(n, template, readings);
    return out;
  }, [template, readings, value.names]);

  // 原稿を作ったあとで種類・敬称・読みが変わった対象は原稿を自動で作り直し（手で直した文はそのとき消える）、選択から外した対象の原稿は消す
  useEffect(() => {
    if (!template || !readings || readingsStatus !== 'ready') return;
    const scripts: Record<string, SonkamoLine[]> = {};
    const scriptKeys: Record<string, string> = {};
    let changed = false;
    for (const n of value.names) {
      if (!value.scripts[n]) continue;
      const kana = kanaByName[n]?.kana ?? null;
      const key = scriptKey(value, kana);
      if (value.scriptKeys[n] === key) {
        scripts[n] = value.scripts[n];
        scriptKeys[n] = key;
      } else {
        scripts[n] = buildSonkamoLines(template, value.target, n, kana, value.honorific);
        scriptKeys[n] = key;
        changed = true;
      }
    }
    if (Object.keys(value.scripts).some((n) => !value.names.includes(n))) changed = true;
    if (changed) onChange({ ...value, scripts, scriptKeys });
  }, [template, readings, readingsStatus, value, kanaByName, onChange]);

  if (!template) {
    return <p className="text-sm text-amber-700 bg-amber-50 rounded p-2">Workerから台本の雛形が届いていません（Workerを最新のコードで再起動してください）。</p>;
  }

  const set = (patch: Partial<SonkamoPick>) => onChange({ ...value, ...patch });
  const generate = () => {
    if (value.names.length === 0 || readingsStatus !== 'ready') return;
    setNote(null);
    const scripts: Record<string, SonkamoLine[]> = {};
    const scriptKeys: Record<string, string> = {};
    for (const n of value.names) {
      const kana = kanaByName[n]?.kana ?? null;
      scripts[n] = buildSonkamoLines(template, value.target, n, kana, value.honorific);
      scriptKeys[n] = scriptKey(value, kana);
    }
    onChange({ ...value, scripts, scriptKeys });
  };
  const editLine = (name: string, id: string, key: 'text' | 'kana', v: string) =>
    set({ scripts: { ...value.scripts, [name]: (value.scripts[name] ?? []).map((l) => (l.id === id ? { ...l, [key]: v } : l)) } });

  async function registerReading(name: string) {
    const reading = (readingInputs[name] ?? '').trim();
    if (!reading) return;
    setReadingBusy(name);
    setNote(null);
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText: name, reading }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setNote({ kind: 'ok', text: `「${name}」の読みを「${reading}」で登録しました。` });
      setReadingInputs((prev) => ({ ...prev, [name]: '' }));
      await loadReadings();
    } catch (err) {
      setNote({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setReadingBusy(null);
    }
  }

  const generated = value.names.filter((n) => value.scripts[n]);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-4">
        {(
          [
            ['group', 'グループ紹介（グループ全体で1本）'],
            ['person', '人物紹介（1人につき1本）'],
          ] as const
        ).map(([t, label]) => (
          <label key={t} className="cursor-pointer">
            <input type="radio" name="sonkamo-target" className="mr-1" checked={value.target === t} onChange={() => onChange({ ...EMPTY_SONKAMO_PICK, target: t })} />
            {label}
          </label>
        ))}
      </div>

      {value.target === 'group' ? (
        <label className="text-xs text-gray-600 block">
          グループ
          <select
            value={value.names[0] ?? ''}
            onChange={(e) => set({ names: e.target.value ? [e.target.value] : [] })}
            className="ml-2 border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="">選択してください</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}（{g.members.length}人）
              </option>
            ))}
          </select>
          <span className="ml-2 text-gray-400">メンバー個人を選ぶ必要はありません（グループページのメンバー・出演作品・配信先・関連商品を紹介します）</span>
        </label>
      ) : (
        <PersonMultiSelect
          persons={persons}
          postedPersonNames={new Set()}
          selected={value.names}
          onChange={(names) => set({ names })}
          showPersonPostedBadge={false}
          selectionOrderNote="この順番で1人1本ずつ生成されます"
        />
      )}

      <div className="flex flex-wrap gap-4 items-center">
        <span className="text-xs text-gray-600">敬称</span>
        {template.honorifics.map((h) => (
          <label key={h || 'none'} className="cursor-pointer text-sm">
            <input type="radio" name="sonkamo-honorific" className="mr-1" checked={value.honorific === h} onChange={() => set({ honorific: h })} />
            {h || 'なし'}
          </label>
        ))}
        <span className="text-xs text-gray-400">名前のあとに付けます（例: 佐野勇斗くん推し！）。グループは通常「なし」</span>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={value.names.length === 0 || readingsStatus !== 'ready'}
          onClick={generate}
          className="px-4 py-1.5 rounded-lg border border-violet-600 text-violet-700 text-sm font-bold disabled:border-gray-300 disabled:text-gray-400"
        >
          {generated.length > 0 ? 'ナレーション原稿を作り直す' : 'ナレーション原稿を生成'}
        </button>
        {readingsStatus === 'loading' && (
          <span className="text-xs text-gray-500" role="status">
            読み仮名を読み込み中…（読み込みが終わると原稿を生成できます）
          </span>
        )}
        {readingsStatus === 'error' && (
          <span className="text-xs text-red-600" role="alert">
            読み仮名を読み込めないため、原稿を生成できません。
            <button type="button" onClick={() => void loadReadings()} className="ml-2 underline hover:text-red-800">
              再読み込み
            </button>
          </span>
        )}
        {note && <span className={`text-xs ${note.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</span>}
      </div>

      {value.names.map((name) => {
        const lines = value.scripts[name];
        const kana = kanaByName[name];
        const checks = lines ? checkSonkamoLines(template, lines) : [];
        const unreadable = [...new Set(checks.flatMap((c) => c.nonReadable))];
        const speechScript = lines ? lines.map((l) => l.kana).join('\n') : '';
        return (
          <div key={name} className="rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="font-bold text-slate-800 text-sm">{name}</span>
              <span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{value.target === 'group' ? 'グループ' : '人物'}</span>
              {readings && kana && (
                <span className="text-emerald-700">
                  読み: {kana.kana}（{kana.source === 'fixed' ? '固定辞書' : kana.source === 'registered' ? '登録済みの読み' : 'ひらがな・カタカナの名前'}）
                </span>
              )}
              {lines && <span className="text-gray-500">動画タイトル: {buildSonkamoTitle(name)}</span>}
            </div>
            {readings && !kana && (
              <div className="bg-amber-50 text-amber-800 rounded p-2 space-y-2 text-xs">
                <p className="font-bold">⚠ 読み未登録：{name}（登録しないと、音声用台本に「{name}」がそのまま残ります）</p>
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    value={readingInputs[name] ?? ''}
                    onChange={(e) => setReadingInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                    placeholder="読みをひらがな・カタカナで入力（確認してから登録）"
                    className="border border-amber-300 rounded px-2 py-1 text-sm w-72 bg-white"
                  />
                  <button
                    type="button"
                    disabled={readingBusy === name || !(readingInputs[name] ?? '').trim()}
                    onClick={() => void registerReading(name)}
                    className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-bold disabled:bg-gray-300"
                  >
                    {readingBusy === name ? '登録中...' : '読みを登録'}
                  </button>
                </div>
              </div>
            )}
            {lines && (
              <div>
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <span className="text-xs font-bold text-violet-700">音声生成用台本（読み）← CapCutにはこちらを貼る</span>
                  <CopyButton text={speechScript} label="音声用台本をコピー" primary disabled={unreadable.length > 0} disabledTitle="読み未登録の語があるためコピーできません" />
                </div>
                <pre className="whitespace-pre-wrap text-xs bg-violet-50 rounded p-2 text-slate-700">{speechScript}</pre>
                {unreadable.length > 0 && (
                  <p className="text-xs text-amber-800 bg-amber-50 rounded p-2 mt-1">
                    ⚠ 読み未登録：{unreadable.join('・')}（読みを登録するか、下の読みの欄を直すまで「音声用台本をコピー」は使えません）
                  </p>
                )}
              </div>
            )}
            {lines && (
              <details open={value.names.length === 1} className="text-xs">
                <summary className="cursor-pointer text-gray-600">
                  原稿を1文ずつ直す（字幕＝画面に表示する正式名称・漢字・英字 ／ 読み＝音声用。1秒あたり約{template.moraPerSecond}音で長さを見積もり）
                </summary>
                <div className="space-y-2 mt-2">
                  {lines.map((l) => {
                    const c = checks.find((x) => x.id === l.id);
                    return (
                      <div key={l.id} className="rounded border border-gray-100 p-2 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-700">{LINE_LABELS[l.id] ?? l.id}</span>
                          {c && (
                            <span className={c.overlong ? 'text-amber-700' : 'text-emerald-700'}>
                              {c.overlong ? '⚠ ' : '✓ '}約{c.estimateSeconds.toFixed(1)}秒 / {c.slotSeconds.toFixed(1)}秒
                            </span>
                          )}
                        </div>
                        <input
                          value={l.text}
                          onChange={(e) => editLine(name, l.id, 'text', e.target.value)}
                          aria-label={`${name} ${LINE_LABELS[l.id] ?? l.id}の字幕`}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                        />
                        <input
                          value={l.kana}
                          onChange={(e) => editLine(name, l.id, 'kana', e.target.value)}
                          aria-label={`${name} ${LINE_LABELS[l.id] ?? l.id}の読み`}
                          className="w-full border border-gray-100 bg-gray-50 rounded px-2 py-1 text-xs text-slate-600"
                        />
                      </div>
                    );
                  })}
                </div>
              </details>
            )}
          </div>
        );
      })}
      <p className="text-xs text-gray-500">CapCut に貼り付けて、好きなAI音声で読み上げてください（動画には音声を入れません）。</p>
    </div>
  );
}
