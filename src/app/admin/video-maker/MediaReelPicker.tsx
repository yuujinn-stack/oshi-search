'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from './CopyButton';
import {
  MEDIA_GROUP_READING_SOURCE_LABELS,
  MEDIA_GROUP_TOKEN,
  MEDIA_TEMPLATE_CATEGORY,
  parseMediaScriptReport,
  renderMediaScript,
  resolveMediaGroupReading,
  type MediaScriptReport,
} from '@/lib/video-media-reel';
import { checkReadingInput } from '@/lib/video-first3-script';
import type { OshiMediaTemplateInput } from '@/lib/video-template-input';
import type { SonkamoGroupOption } from './SonkamoTargetPicker';
import MediaGroupCombobox, { type MediaGroupsStatus } from './MediaGroupCombobox';

// 推しサーチ総合紹介動画（10種類）: テンプレートの台本（Worker の報告）を表示・コピーし、グループ版はグループを選ぶ。
// 台本・演出は oshi-video-maker のコードが正本（ここでは編集しない）。音声なしで作り、完成した動画の「詳細」から CapCut の WAV・SRT を付ける

export interface MediaPick {
  /** グループ版だけ: 一覧から選んだグループの正式名称（null=まだ選んでいない。例のグループを自動では選ばない） */
  groupName: string | null;
}

export const EMPTY_MEDIA_PICK: MediaPick = { groupName: null };

/**
 * グループ版で使うグループ名（一覧から選んだグループ。未選択なら空）。
 * テンプレートの例のグループ（M!LK）を自動では選ばない（選び忘れて別のグループの動画を作らないため）
 */
export function effectiveMediaGroup(pick: MediaPick, _report: MediaScriptReport | null, _groups: SonkamoGroupOption[]): string {
  return (pick.groupName ?? '').trim();
}

/** 生成できる状態か（一般版は常に可。グループ版は登録済みのグループを選んだとき） */
export function mediaPickReady(pick: MediaPick, report: MediaScriptReport | null, groups: SonkamoGroupOption[]): boolean {
  if (!report) return false;
  if (report.selectionMode === 'none') return true;
  const g = effectiveMediaGroup(pick, report, groups);
  return !!g && groups.some((x) => x.name === g);
}

export function mediaTemplateInput(groupName: string, selectionMode: 'none' | 'group'): OshiMediaTemplateInput {
  return { version: 1, templateCategory: MEDIA_TEMPLATE_CATEGORY, groupName: selectionMode === 'group' ? groupName.trim() : null };
}

export default function MediaReelPicker({
  mediaScript,
  groups,
  fixedReadings,
  value,
  onChange,
  groupsStatus = 'ready',
  groupsError = null,
}: {
  /** 登録済みグループの取得状態（取得できなかったときは error と理由） */
  groupsStatus?: MediaGroupsStatus;
  groupsError?: string | null;
  /** Worker が報告した台本（parseMediaScriptReport で読む） */
  mediaScript: unknown;
  groups: SonkamoGroupOption[];
  /** 人物名・グループ名などの固定辞書の読み（Worker の報告。グループ名の読み台本の表示に使う） */
  fixedReadings: Record<string, string>;
  value: MediaPick;
  onChange: (next: MediaPick) => void;
}) {
  const report = useMemo(() => parseMediaScriptReport(mediaScript), [mediaScript]);
  const isGroup = report?.selectionMode === 'group';
  const groupName = effectiveMediaGroup(value, report, groups);
  const groupKnown = !!groupName && groups.some((g) => g.name === groupName);

  // グループ名の読み: 推しサーチで登録した読み（pronunciation_readings。まず見る3作・フォロー獲得リールと共通）を読み込み、
  // Worker と同じ順番で決める（登録した読み → 固定辞書 → Worker のグループ名の辞書）。ここで登録した読みは Worker が次の生存報告で受け取る
  const [registered, setRegistered] = useState<Record<string, string> | null>(null);
  const [readingsStatus, setReadingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [readingInput, setReadingInput] = useState('');
  const [readingBusy, setReadingBusy] = useState(false);
  const [readingNote, setReadingNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const loadReadings = useCallback(async () => {
    setReadingsStatus('loading');
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { readings?: Array<{ sourceText: string; reading: string }>; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRegistered(Object.fromEntries((data.readings ?? []).map((r) => [r.sourceText, r.reading])));
      setReadingsStatus('ready');
    } catch (err) {
      setReadingNote({ kind: 'error', text: `登録済みの読みを読み込めませんでした: ${String(err instanceof Error ? err.message : err)}` });
      setReadingsStatus('error');
    }
  }, []);
  useEffect(() => {
    if (isGroup) void loadReadings();
  }, [isGroup, loadReadings]);
  // グループを変えたら、入力中の読みとお知らせを消す（別のグループの読みとして登録しないため）
  useEffect(() => {
    setReadingInput('');
    setReadingNote(null);
  }, [groupName]);

  const groupReadings = report?.groupReadings;
  const resolved = useMemo(
    () => (isGroup && groupKnown ? resolveMediaGroupReading(groupName, { registered, fixed: fixedReadings, groupReadings }) : null),
    [isGroup, groupKnown, groupName, registered, fixedReadings, groupReadings],
  );
  // グループの検索で読みも使う（登録した読みを優先）
  const searchReadings = useMemo(() => ({ ...(groupReadings ?? {}), ...fixedReadings, ...(registered ?? {}) }), [groupReadings, fixedReadings, registered]);
  const preview = useMemo(
    () => (report ? renderMediaScript(report, isGroup ? (groupKnown ? groupName : null) : null, resolved?.reading ?? null) : null),
    [report, isGroup, groupKnown, groupName, resolved],
  );

  async function registerGroupReading() {
    const checked = checkReadingInput(groupName, readingInput);
    if (!checked.ok) {
      setReadingNote({ kind: 'error', text: checked.error });
      return;
    }
    setReadingBusy(true);
    setReadingNote(null);
    try {
      const res = await fetch('/api/admin/video-jobs/pronunciation-readings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceText: checked.sourceText, reading: checked.reading }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReadingInput('');
      setReadingNote({
        kind: 'ok',
        text: `「${checked.sourceText}」の読みを「${checked.reading}」で登録しました。Worker に反映されるまで1分ほどかかります。読み台本が変わったので、CapCut 音声はこの読み台本で作ってください。`,
      });
      await loadReadings();
    } catch (err) {
      setReadingNote({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
    } finally {
      setReadingBusy(false);
    }
  }

  if (!report || !preview) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
        Workerから台本がまだ届いていません（oshi-video-maker の Worker を更新すると表示されます）。台本を確認できないため、ここからは生成できません。
      </p>
    );
  }
  const groupMissing = isGroup && !groupKnown;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-1 text-xs">
        <span className="text-gray-500">用途</span>
        <span>{report.goal || '-'}</span>
        <span className="text-gray-500">サムネイル</span>
        <span>{preview.coverText.replace(/\n/g, ' ／ ')}</span>
        <span className="text-gray-500">締め（CTA）</span>
        <span>{report.cta || '-'}</span>
        <span className="text-gray-500">長さの目安</span>
        <span>約{report.targetDurationSec}秒（CapCut 音声を付けると読み上げ＋約1秒。最長30秒）</span>
        <span className="text-gray-500">対象</span>
        <span>{isGroup ? 'グループ版（推しサーチに登録されたグループから選ぶ）' : '一般向け（人物・グループの選択は不要）'}</span>
      </div>

      {isGroup && (
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="vm-media-group">
            グループ（推しサーチに登録されたグループ）
          </label>
          <MediaGroupCombobox groups={groups} readings={searchReadings} status={groupsStatus} errorMessage={groupsError} value={groupKnown ? groupName : ''} onChange={(name) => onChange({ groupName: name })} />
          {groupMissing && groupsStatus === 'ready' && groups.length > 0 && (
            <p className="text-xs text-amber-700 mt-1">
              {groupName ? `「${groupName}」は登録済みのグループにありません。一覧から選び直してください。` : 'グループが未選択のため生成できません。欄をクリックして一覧から選んでください。'}
            </p>
          )}
        </div>
      )}

      {isGroup && groupKnown && (
        <div className="rounded border border-gray-200 p-2 space-y-1.5" data-testid="vm-media-group-reading">
          <p className="text-xs font-bold text-slate-700">グループ名の読み（ナレーションの読み台本と、CapCut 音声のグループ確認に使う）</p>
          {readingsStatus === 'loading' && !registered ? (
            <p className="text-xs text-gray-500">登録済みの読みを読み込み中…</p>
          ) : (
            <p className="text-xs">
              「{groupName}」→{' '}
              {resolved ? (
                <>
                  <b className="text-slate-800">{resolved.reading}</b>
                  <span className="text-gray-500">（{MEDIA_GROUP_READING_SOURCE_LABELS[resolved.source]}）</span>
                </>
              ) : (
                <b className="text-amber-700">読み未登録</b>
              )}
              {readingsStatus === 'error' && (
                <button type="button" onClick={() => void loadReadings()} className="ml-2 underline text-violet-700">
                  登録済みの読みを読み込み直す
                </button>
              )}
            </p>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <input
              value={readingInput}
              onChange={(e) => setReadingInput(e.target.value)}
              placeholder={resolved ? '読みを変えるときだけ入力（ひらがな・カタカナ）' : '読みをひらがな・カタカナで入力（確認してから登録）'}
              aria-label={`「${groupName}」の読み`}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-72 bg-white"
            />
            <button
              type="button"
              disabled={readingBusy || readingsStatus === 'loading' || !readingInput.trim()}
              onClick={() => void registerGroupReading()}
              className="px-3 py-1 rounded bg-violet-600 text-white text-xs font-bold disabled:bg-gray-300"
            >
              {readingBusy ? '登録中...' : resolved?.source === 'registered' ? '読みを変更' : '読みを登録'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            登録した読みは、この語を使うほかの動画（まず見る3作など）の読み台本にも使われます。読みを変えたら、前の読みで録音した CapCut 音声は使わず、新しい読み台本で作り直してください。
          </p>
          {readingNote && <p className={`text-xs ${readingNote.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{readingNote.text}</p>}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-gray-200">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-1.5 text-left w-24">シーン</th>
              <th className="p-1.5 text-left w-12">目安</th>
              <th className="p-1.5 text-left">画面の文字</th>
              <th className="p-1.5 text-left">ナレーション（字幕）</th>
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((l) => (
              <tr key={l.id} className="border-t border-gray-100 align-top">
                <td className="p-1.5 text-gray-500">{l.id}</td>
                <td className="p-1.5 text-gray-500">約{l.approxSeconds}秒</td>
                <td className="p-1.5 whitespace-pre-wrap">{l.overlay.includes(MEDIA_GROUP_TOKEN) ? l.overlay.split(MEDIA_GROUP_TOKEN).join('（グループ名）') : l.overlay}</td>
                <td className="p-1.5">{l.text.includes(MEDIA_GROUP_TOKEN) ? l.text.split(MEDIA_GROUP_TOKEN).join('（グループ名）') : l.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-violet-700 font-bold text-xs mb-1">音声生成用台本（ひらがな）← CapCutにはこちらを貼る</p>
        <pre className="whitespace-pre-wrap bg-violet-50 rounded p-2 text-xs text-slate-700">
          {groupMissing ? preview.kanaText.split(MEDIA_GROUP_TOKEN).join('（グループ名）') : preview.kanaText}
        </pre>
        {preview.groupReadingMissing && (
          <p className="text-xs text-amber-700 mt-1">
            「{groupName}」の読みが未登録のため、読み台本にグループ名をそのまま入れています。上の「グループ名の読み」で読みを登録してから CapCut 音声を作ってください（読みが違うと、CapCut 音声のグループ確認で止まることがあります）。
          </p>
        )}
        <div className="flex gap-3 flex-wrap mt-1">
          <CopyButton text={preview.scriptText} label="台本をコピー" />
          {!groupMissing && <CopyButton text={preview.kanaText} label="読み台本をコピー" primary />}
        </div>
      </div>

      <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">
        台本・デザイン・演出は動画メーカー（oshi-video-maker）の完成版をそのまま使います（ここでは編集できません）。
        まず音声なしで生成し、完成した動画の「詳細」から CapCut の WAV・SRT を取り込むと、読み上げに合わせた音声付きの動画を作れます。
      </p>
    </div>
  );
}
