'use client';

import { useState } from 'react';
import WorkCard from '@/components/WorkCard';
import type { WorkRecord } from '@/types/work';
import type { WorkImageDisplaySetting } from '@/lib/site-settings';
import {
  WORK_IMAGE_DISPLAY_MODES,
  WORK_IMAGE_DISPLAY_MODE_LABEL,
  type WorkImageDisplayMode,
} from '@/lib/work-image-display';

const MODE_DESCRIPTION: Record<WorkImageDisplayMode, string> = {
  d1: '白地に作品タイトルを表示する共通デザイン。従来の作品画像（TMDb・OG・手動画像）は読み込みません。カード下の作品名は重ねて表示しません。作品ページの OGP・構造化データの画像も D-1 になります。',
  legacy: '従来どおり、手動画像 > TMDb画像 > 自動取得OG画像 の順で作品画像を表示します。OGP・構造化データの画像も従来どおりです（切り戻し用）。',
};

// D-1 の確認用の作品名（短い・長い・英語・記号混じり・公開年不明）。プレビュー専用で保存はしない
function sample(id: string, title: string, type: WorkRecord['type'], releaseYear?: number): WorkRecord {
  return {
    id: `preview-${id}`,
    personName: 'プレビュー',
    title,
    normalizedTitle: title,
    type,
    source: 'manual',
    releaseYear,
    confidenceScore: 0,
    status: 'auto_published',
    vodProviders: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
const SAMPLE_WORKS: WorkRecord[] = [
  sample('short', '海', 'movie', 2024),
  sample('long', '君の名前で僕を呼んで、そしてまた明日の朝に会いに行くための長い長い物語 〜特別編・完全版〜', 'tv', 2021),
  sample('english', 'The Extraordinarily Long Adventures of Somebody Unforgettable', 'movie', 2019),
  sample('symbol', '【推し活】Re:スタート!! ～第2章～ #A&B', 'variety', 2023),
  sample('noyear', '公開年不明の作品', 'anime'),
];

type Viewport = 'sp' | 'tab' | 'pc';
const VIEWPORTS: { key: Viewport; label: string; width: string; cols: string }[] = [
  { key: 'sp', label: 'スマホ（2列）', width: '375px', cols: 'grid-cols-2' },
  { key: 'tab', label: '中間画面（3列）', width: '640px', cols: 'grid-cols-3' },
  { key: 'pc', label: 'PC（4列）', width: '100%', cols: 'grid-cols-4' },
];

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; at: string }
  | { kind: 'error'; message: string };

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

export default function WorkImageDisplayClient({
  initialSetting,
  previewWorks,
}: {
  initialSetting: WorkImageDisplaySetting;
  previewWorks: WorkRecord[];
}) {
  const [saved, setSaved] = useState<WorkImageDisplaySetting>(initialSetting);
  const [selected, setSelected] = useState<WorkImageDisplayMode>(initialSetting.mode);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [viewport, setViewport] = useState<Viewport>('sp');

  const dirty = selected !== saved.mode || !saved.saved;
  const vp = VIEWPORTS.find((v) => v.key === viewport)!;
  const previewList = [...previewWorks, ...SAMPLE_WORKS];

  async function handleSave() {
    setSaveState({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/work-image-display', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: selected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setSaveState({ kind: 'error', message: data?.error ?? `保存に失敗しました（HTTP ${res.status}）` });
        return;
      }
      setSaved(data.setting as WorkImageDisplaySetting);
      setSaveState({ kind: 'success', at: (data.setting as WorkImageDisplaySetting).updatedAt ?? new Date().toISOString() });
    } catch (err) {
      setSaveState({ kind: 'error', message: `通信に失敗しました: ${String(err)}` });
    }
  }

  return (
    <div className="space-y-6">
      {/* 現在の設定 */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <p>
            <span className="text-gray-500">サイトに反映中：</span>
            <span className="font-bold text-slate-800">{WORK_IMAGE_DISPLAY_MODE_LABEL[saved.mode]}</span>
            {!saved.saved && <span className="ml-2 text-xs text-gray-400">（未保存のため初期設定で表示中）</span>}
          </p>
          <p className="text-xs text-gray-500">最終保存：{formatDate(saved.updatedAt)}</p>
        </div>
        {saved.loadError && (
          <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">⚠ {saved.loadError}</p>
        )}
      </section>

      {/* 選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-bold text-slate-800 mb-3">表示方式</h2>
        <div className="grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="作品画像の表示方式">
          {WORK_IMAGE_DISPLAY_MODES.map((mode) => (
            <label
              key={mode}
              className={`block cursor-pointer rounded-lg border p-3 transition-colors ${
                selected === mode ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="work-image-display-mode"
                  value={mode}
                  checked={selected === mode}
                  onChange={() => { setSelected(mode); setSaveState({ kind: 'idle' }); }}
                />
                <span className="font-bold text-slate-800">{WORK_IMAGE_DISPLAY_MODE_LABEL[mode]}</span>
                {saved.mode === mode && saved.saved && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">反映中</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{MODE_DESCRIPTION[mode]}</p>
            </label>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState.kind === 'saving' || !dirty}
            className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saveState.kind === 'saving' ? '保存中…' : '保存してサイトに反映'}
          </button>
          {saved.mode === 'd1' && saved.saved && selected === 'd1' && (
            <button
              type="button"
              onClick={() => { setSelected('legacy'); setSaveState({ kind: 'idle' }); }}
              className="px-3 py-2 rounded-lg text-xs font-semibold border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              従来画像表示に戻す（選択のみ・保存で反映）
            </button>
          )}
          <span aria-live="polite" className="text-sm">
            {saveState.kind === 'success' && (
              <span className="text-green-700">✓ 保存しました（{formatDate(saveState.at)}）。公開ページの次の表示から反映されます</span>
            )}
            {saveState.kind === 'error' && <span className="text-red-600">✕ {saveState.message}</span>}
            {saveState.kind !== 'success' && saveState.kind !== 'error' && dirty && saveState.kind !== 'saving' && (
              <span className="text-amber-700">● 未保存の変更があります（「{WORK_IMAGE_DISPLAY_MODE_LABEL[selected]}」はまだサイトに反映されていません）</span>
            )}
          </span>
        </div>
      </section>

      {/* プレビュー */}
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-bold text-slate-800">
            プレビュー：{WORK_IMAGE_DISPLAY_MODE_LABEL[selected]}
            {dirty && <span className="ml-2 text-xs font-normal text-amber-700">（未保存）</span>}
          </h2>
          <div className="flex gap-1">
            {VIEWPORTS.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => setViewport(v.key)}
                className={`text-xs px-2.5 py-1 rounded-md border ${
                  viewport === v.key ? 'bg-slate-800 text-white border-slate-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          先頭{previewWorks.length}件は登録済みの公開作品、残りは確認用の作品名（短い・長い・英語・記号混じり・公開年不明）です。プレビュー内のリンクは押せません。
        </p>
        <div className="overflow-x-auto bg-gray-50 rounded-lg p-3">
          {/* inert: プレビュー内のリンクを無効にする（作品詳細やクリック計測へ進まない） */}
          <div inert className="mx-auto" style={{ width: vp.width, maxWidth: '100%' }}>
            <div className={`grid ${vp.cols} gap-3`}>
              {previewList.map((w) => (
                <WorkCard key={`${selected}-${w.id}`} work={w} imageMode={selected} />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="text-xs text-gray-500 leading-relaxed space-y-1">
        <p>・対象：人物ページ・グループページ・作品詳細ページ・配信サービス別ページ（/vod）・推しのサブスク診断の作品画像。楽天の商品画像・配信サービスのロゴ・人物の画像には適用しません。</p>
        <p>・作品の画像URL・DBのデータは変更しません（表示方法だけを切り替えます）。「従来画像表示」を保存すれば、いつでも元の表示に戻せます。</p>
        <p>・作品詳細ページの OGP 画像（SNSで共有したときの画像）・構造化データ（JSON-LD）の画像も切り替わります。D-1 では作品名入りの D-1 画像になり、従来の作品画像URLは出しません。SNS側は画像をしばらく保存するため、共有済みのカードの画像は SNS 側の更新まで変わらないことがあります。</p>
      </section>
    </div>
  );
}
