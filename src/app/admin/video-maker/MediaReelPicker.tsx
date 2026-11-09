'use client';

import { useMemo } from 'react';
import CopyButton from './CopyButton';
import { MEDIA_GROUP_TOKEN, MEDIA_TEMPLATE_CATEGORY, parseMediaScriptReport, renderMediaScript, type MediaScriptReport } from '@/lib/video-media-reel';
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
  const preview = useMemo(
    () => (report ? renderMediaScript(report, isGroup ? (groupKnown ? groupName : null) : null, isGroup && groupKnown ? fixedReadings[groupName] ?? null : null) : null),
    [report, isGroup, groupKnown, groupName, fixedReadings],
  );

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
          <MediaGroupCombobox groups={groups} readings={fixedReadings} status={groupsStatus} errorMessage={groupsError} value={groupKnown ? groupName : ''} onChange={(name) => onChange({ groupName: name })} />
          {groupMissing && groupsStatus === 'ready' && groups.length > 0 && (
            <p className="text-xs text-amber-700 mt-1">
              {groupName ? `「${groupName}」は登録済みのグループにありません。一覧から選び直してください。` : 'グループが未選択のため生成できません。欄をクリックして一覧から選んでください。'}
            </p>
          )}
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
            「{groupName}」の読みが辞書にないため、読み台本にグループ名をそのまま入れています。CapCut に貼る前に読み方を確認してください（生成時の読み台本は動画の「詳細」にも出ます）。
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
