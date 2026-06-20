'use client';

import { useState, useRef } from 'react';
import type { WorkVodPreviewRow, WorkVodRowAction } from '@/app/api/admin/work-vod-import/route';

const ACTION_BADGE: Record<WorkVodRowAction, { label: string; className: string }> = {
  add_vod:        { label: '配信追加',          className: 'bg-teal-100 text-teal-700' },
  create_work:    { label: '新規作品＋配信',     className: 'bg-blue-100 text-blue-700' },
  unknown_person: { label: '人物未一致',         className: 'bg-red-100 text-red-600' },
  error:          { label: 'エラー',             className: 'bg-red-100 text-red-600' },
};

const EXAMPLE_CSV = `personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note
加藤史帆,これから配信はじめます,tv,2024,,Lemino,flatrate,https://example.com,high,ChatGPT調査
齊藤京子,泥濘の食卓,tv,2023,捻木深愛,U-NEXT,flatrate,https://example.com,high,ChatGPT調査`;

type Phase = 'input' | 'preview' | 'done';

interface PreviewResult {
  previewRows: WorkVodPreviewRow[];
  addVodCount: number;
  createWorkCount: number;
  unknownPersonCount: number;
  errorCount: number;
}

interface DoneResult {
  savedWorkCount: number;
  savedVodCount: number;
  errors: string[];
  unknownPersons: string[];
}

export default function WorkVodImportForm() {
  const [phase, setPhase] = useState<Phase>('input');
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [done, setDone] = useState<DoneResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handlePreview() {
    if (!csvText.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/work-vod-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent: csvText, commit: false }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'プレビューに失敗しました');
    } else {
      setPreview(data as PreviewResult);
      setPhase('preview');
    }
    setLoading(false);
  }

  async function handleCommit() {
    if (!preview) return;
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin/work-vod-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvContent: csvText, commit: true, fileName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'インポートに失敗しました');
    } else {
      setDone(data as DoneResult);
      setPhase('done');
    }
    setLoading(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? '');
    reader.readAsText(file, 'UTF-8');
  }

  function handleReset() {
    setPhase('input');
    setCsvText('');
    setPreview(null);
    setDone(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── INPUT PHASE ─────────────────────────────────────────────────────────────
  if (phase === 'input') {
    return (
      <div className="space-y-4">
        {/* フォーマット説明 */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
          <p className="font-semibold text-slate-700">CSVフォーマット（必須: personName, workTitle, workType, vodService）</p>
          <pre className="text-[10px] font-mono text-slate-500 overflow-x-auto leading-relaxed">
{`personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note`}
          </pre>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px] text-slate-500">
            <span><code>workType</code>: movie / tv</span>
            <span><code>availabilityType</code>: flatrate / rent / buy / free / ads</span>
            <span><code>confidence</code>: high / medium / low</span>
          </div>
          <button
            onClick={() => setCsvText(EXAMPLE_CSV)}
            className="text-[10px] text-indigo-500 hover:text-indigo-700 underline"
          >
            サンプルを入力
          </button>
        </div>

        {/* ファイルアップロード */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">
            CSVファイル（UTF-8 / Shift_JIS 対応）
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>

        {/* テキスト入力 */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">
            または直接貼り付け
          </label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={8}
            placeholder={EXAMPLE_CSV}
            className="w-full text-xs font-mono border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <button
          onClick={handlePreview}
          disabled={loading || !csvText.trim()}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {loading ? 'プレビュー中...' : 'プレビュー →'}
        </button>
      </div>
    );
  }

  // ── PREVIEW PHASE ────────────────────────────────────────────────────────────
  if (phase === 'preview' && preview) {
    const executableRows = preview.previewRows.filter(
      (r) => r.action === 'add_vod' || r.action === 'create_work',
    );
    return (
      <div className="space-y-4">
        {/* サマリー */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
          {[
            { label: '配信追加', value: preview.addVodCount, className: 'bg-teal-50 border-teal-200 text-teal-700' },
            { label: '新規作品＋配信', value: preview.createWorkCount, className: 'bg-blue-50 border-blue-200 text-blue-700' },
            { label: '人物未一致', value: preview.unknownPersonCount, className: 'bg-red-50 border-red-200 text-red-600' },
            { label: 'エラー', value: preview.errorCount, className: 'bg-gray-50 border-gray-200 text-gray-500' },
          ].map((item) => (
            <div key={item.label} className={`p-3 rounded-xl border ${item.className}`}>
              <div className="text-2xl font-black">{item.value}</div>
              <div className="text-[10px] mt-0.5 opacity-80">{item.label}</div>
            </div>
          ))}
        </div>

        {preview.unknownPersonCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">⚠️ 人物未一致（登録されません）</p>
            <p className="text-[10px]">
              未一致の人物名は確認してください。人物登録後に再インポートすることで追加できます。
            </p>
            <p className="text-[10px] mt-1">
              {[...new Set(preview.previewRows.filter((r) => r.action === 'unknown_person').map((r) => r.personName))].join('、')}
            </p>
          </div>
        )}

        {preview.createWorkCount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
            <p className="font-semibold mb-1">📝 新規作品について</p>
            <p className="text-[10px]">
              新規作品はステータス「確認待ち」で登録されます。作品管理画面で確認・公開してください。
            </p>
          </div>
        )}

        {/* 詳細テーブル */}
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 border-b border-gray-200">
            詳細（{preview.previewRows.length}行）
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs border-collapse min-w-[700px]">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-gray-500 text-[10px]">
                  <th className="text-right p-2 border-b border-gray-100 font-medium w-8">行</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium">人物</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium">作品タイトル</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium w-14">種別</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium">配信サービス</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium w-24">アクション</th>
                  <th className="text-left p-2 border-b border-gray-100 font-medium">理由・マッチ</th>
                </tr>
              </thead>
              <tbody>
                {preview.previewRows.map((row) => {
                  const badge = ACTION_BADGE[row.action];
                  return (
                    <tr
                      key={row.rowNum}
                      className={
                        row.action === 'unknown_person' || row.action === 'error'
                          ? 'bg-red-50/40'
                          : row.action === 'create_work'
                          ? 'bg-blue-50/30'
                          : ''
                      }
                    >
                      <td className="p-2 border-b border-gray-100 text-right text-gray-400">{row.rowNum}</td>
                      <td className="p-2 border-b border-gray-100 font-medium text-slate-700">{row.personName || '—'}</td>
                      <td className="p-2 border-b border-gray-100">
                        <span className="text-slate-700">{row.workTitle || '—'}</span>
                        {row.releaseYear && (
                          <span className="text-gray-400 ml-1 text-[10px]">{row.releaseYear}</span>
                        )}
                        {row.roleName && (
                          <span className="text-indigo-500 ml-1 text-[10px]">役:{row.roleName}</span>
                        )}
                        {row.isNewWork && (
                          <span className="ml-1 text-[9px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded">NEW</span>
                        )}
                      </td>
                      <td className="p-2 border-b border-gray-100 text-gray-500">
                        {row.workType === 'movie' ? '映画' : 'ドラマ'}
                      </td>
                      <td className="p-2 border-b border-gray-100 text-teal-700">
                        {row.vodService}
                        <span className="text-gray-400 ml-1 text-[10px]">{row.availabilityType}</span>
                        {row.confidence !== 'high' && (
                          <span className={`ml-1 text-[9px] px-1 py-0.5 rounded ${
                            row.confidence === 'medium' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-500'
                          }`}>
                            {row.confidence}
                          </span>
                        )}
                      </td>
                      <td className="p-2 border-b border-gray-100">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="p-2 border-b border-gray-100 text-gray-500 text-[10px] max-w-xs">
                        {row.reason}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={handleReset}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-colors disabled:opacity-50"
          >
            ← 修正
          </button>
          <button
            onClick={handleCommit}
            disabled={loading || executableRows.length === 0}
            className="flex-2 py-2.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {loading
              ? 'インポート中...'
              : `✅ ${executableRows.length}件をインポート実行`}
          </button>
        </div>
      </div>
    );
  }

  // ── DONE PHASE ───────────────────────────────────────────────────────────────
  if (phase === 'done' && done) {
    return (
      <div className="space-y-5">
        <div className="text-center py-6 space-y-3">
          <div className="text-5xl">✅</div>
          <p className="text-xl font-bold text-slate-800">インポート完了</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-center text-xs">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="text-2xl font-black text-blue-700">{done.savedWorkCount}</div>
            <div className="text-gray-500 mt-0.5">新規作品登録</div>
          </div>
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
            <div className="text-2xl font-black text-teal-700">{done.savedVodCount}</div>
            <div className="text-gray-500 mt-0.5">配信情報追加・更新</div>
          </div>
        </div>

        {done.unknownPersons.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
            <p className="font-semibold mb-1">未登録のためスキップした人物</p>
            <p>{done.unknownPersons.join('、')}</p>
          </div>
        )}

        {done.savedWorkCount > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-800">
            <p className="font-semibold">次のステップ</p>
            <p className="mt-1">
              新規作品はステータス「確認待ち」です。
              <a href="/admin/work-check" className="underline ml-1 font-medium">作品管理画面</a>
              で確認・公開してください。
            </p>
          </div>
        )}

        {done.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
            <p className="font-semibold mb-1">エラー ({done.errors.length}件)</p>
            <ul className="space-y-0.5">
              {done.errors.map((e, i) => <li key={i} className="font-mono">{e}</li>)}
            </ul>
          </div>
        )}

        <button
          onClick={handleReset}
          className="w-full py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-colors"
        >
          続けてインポート
        </button>
      </div>
    );
  }

  return null;
}
