'use client';

import { useState, useRef } from 'react';
import type { VodTitlePreviewRow } from '@/app/api/admin/vod-title-import/route';

const SAMPLE_CSV = `workTitle,vodService,availabilityType,sourceUrl,confidence,note
量産型ルカ,Lemino,flatrate,https://lemino.docomo.ne.jp/...,high,公式確認
乃木坂スター誕生,Hulu,flatrate,https://www.hulu.jp/...,high,公式確認
あの夏のルカ,Netflix,flatrate,,high,`;

const ACTION_BADGE: Record<VodTitlePreviewRow['action'], string> = {
  add:       'bg-green-100 text-green-700',
  update:    'bg-yellow-100 text-yellow-700',
  unmatched: 'bg-gray-100 text-gray-500',
  error:     'bg-red-100 text-red-700',
};
const ACTION_LABEL: Record<VodTitlePreviewRow['action'], string> = {
  add:       '追加',
  update:    '更新',
  unmatched: '未照合',
  error:     'エラー',
};

interface PreviewSummary {
  previewRows: VodTitlePreviewRow[];
  matchedTitleCount: number;
  unmatchedTitleCount: number;
  addCount: number;
  errorCount: number;
}

interface CommitResult {
  savedWorkCount: number;
  savedProviderCount: number;
  unmatchedTitles: string[];
  errors: string[];
}

type Phase = 'input' | 'preview' | 'done';

export default function VodImportForm() {
  const [phase, setPhase]         = useState<Phase>('input');
  const [csvText, setCsvText]     = useState('');
  const [preview, setPreview]     = useState<PreviewSummary | null>(null);
  const [result, setResult]       = useState<CommitResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const fileRef                   = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText((ev.target?.result as string) ?? ''); setPreview(null); };
    reader.readAsText(file, 'utf-8');
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText((ev.target?.result as string) ?? ''); setPreview(null); };
    reader.readAsText(file, 'utf-8');
  }

  async function handlePreview() {
    if (!csvText.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true); setError(''); setPreview(null);
    try {
      const res = await fetch('/api/admin/vod-title-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        const d = data as { error: string; details?: { foundColumns: string; missingColumns: string; example: string } };
        let msg = d.error;
        if (d.details) msg += `\n不足列: ${d.details.missingColumns}\n読込列: ${d.details.foundColumns}`;
        setError(msg);
        return;
      }
      setPreview(data as PreviewSummary);
      setPhase('preview');
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  async function handleCommit() {
    if (!csvText.trim() || !preview || preview.addCount === 0) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/vod-title-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent: csvText, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError((data as { error: string }).error ?? '登録に失敗しました'); return; }
      setResult(data as CommitResult);
      setCsvText('');
      setPreview(null);
      setPhase('done');
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setPhase('input'); setCsvText(''); setPreview(null); setResult(null); setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── 完了 ─────────────────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-green-800 text-sm">配信情報CSV インポート完了</h3>
        <div className="grid grid-cols-2 gap-3 text-center text-xs">
          <div className="bg-white rounded-xl border border-green-100 py-3">
            <div className="text-2xl font-black text-green-700">{result.savedWorkCount}</div>
            <div className="text-gray-500 mt-0.5">更新した作品数</div>
          </div>
          <div className="bg-white rounded-xl border border-green-100 py-3">
            <div className="text-2xl font-black text-green-700">{result.savedProviderCount}</div>
            <div className="text-gray-500 mt-0.5">登録した配信情報</div>
          </div>
        </div>
        {result.unmatchedTitles.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs">
            <p className="font-semibold text-amber-700 mb-1">
              照合できなかったタイトル ({result.unmatchedTitles.length}件)
            </p>
            <p className="text-amber-600 text-[11px] mb-1">
              先にデータ取得（TMDb）を実行してから再インポートしてください。
            </p>
            <ul className="space-y-0.5">
              {result.unmatchedTitles.map((t) => (
                <li key={t} className="text-amber-700">・{t}</li>
              ))}
            </ul>
          </div>
        )}
        {result.errors.length > 0 && (
          <div className="text-xs text-red-600 bg-red-50 rounded-xl p-3">
            <p className="font-semibold mb-1">エラー {result.errors.length}件</p>
            {result.errors.slice(0, 3).map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
          >
            続けてインポート
          </button>
          <a
            href="/admin/work-check"
            className="px-4 py-2 text-sm text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50 transition-colors"
          >
            作品確認画面
          </a>
        </div>
      </div>
    );
  }

  // ── プレビュー ────────────────────────────────────────────────────────────
  if (phase === 'preview' && preview) {
    const unmatchedRows = preview.previewRows.filter((r) => r.action === 'unmatched');
    const uniqueUnmatched = [...new Set(unmatchedRows.map((r) => r.workTitle))];

    return (
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* サマリーバー */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <button
            onClick={() => { setPhase('input'); setPreview(null); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← 戻る
          </button>
          <span className="font-bold text-slate-700 text-sm">プレビュー</span>
          {preview.addCount > 0 && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              追加 {preview.addCount}件
            </span>
          )}
          {preview.matchedTitleCount > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
              照合タイトル {preview.matchedTitleCount}件
            </span>
          )}
          {preview.unmatchedTitleCount > 0 && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              未照合 {preview.unmatchedTitleCount}件
            </span>
          )}
          {preview.errorCount > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
              エラー {preview.errorCount}件
            </span>
          )}
          <div className="ml-auto flex-shrink-0">
            <button
              onClick={handleCommit}
              disabled={loading || preview.addCount === 0}
              className="px-5 py-1.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-40 transition-colors"
            >
              {loading ? '登録中…' : `${preview.addCount}件を登録する`}
            </button>
          </div>
        </div>

        {/* 未照合タイトルの注意 */}
        {uniqueUnmatched.length > 0 && (
          <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
            <strong>未照合タイトル {uniqueUnmatched.length}件</strong>: 先にデータ取得（TMDb）を実行してください。
            <span className="ml-2 text-amber-600">{uniqueUnmatched.slice(0, 5).join('、')}{uniqueUnmatched.length > 5 ? '…' : ''}</span>
          </div>
        )}

        {error && (
          <div className="px-5 py-2 bg-red-50 border-b border-red-100">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* テーブル */}
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-left text-gray-500">
                <th className="px-3 py-2 font-medium w-10">行</th>
                <th className="px-3 py-2 font-medium">CSV タイトル</th>
                <th className="px-3 py-2 font-medium">配信サービス</th>
                <th className="px-3 py-2 font-medium w-16">種別</th>
                <th className="px-3 py-2 font-medium">照合先 (人物 / 作品)</th>
                <th className="px-3 py-2 font-medium w-16">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.previewRows.slice(0, 300).map((row, idx) => (
                <tr
                  key={idx}
                  className={
                    row.action === 'error'     ? 'bg-red-50' :
                    row.action === 'unmatched' ? 'bg-gray-50 opacity-60' :
                    'hover:bg-indigo-50'
                  }
                >
                  <td className="px-3 py-2 text-gray-400">{row.rowNum}</td>
                  <td className="px-3 py-2 font-medium text-slate-800 max-w-[160px] truncate" title={row.workTitle}>
                    {row.workTitle}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.vodService}</td>
                  <td className="px-3 py-2 text-gray-500">{row.availabilityType}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {row.personName ? (
                      <span>
                        <span className="text-indigo-600">{row.personName}</span>
                        <span className="text-gray-400 mx-1">/</span>
                        <span className="truncate max-w-[120px] inline-block align-bottom" title={row.matchedWorkTitle}>
                          {row.matchedWorkTitle}
                        </span>
                      </span>
                    ) : (
                      <span className="text-gray-400">{row.reason}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ACTION_BADGE[row.action]}`}>
                      {ACTION_LABEL[row.action]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.previewRows.length > 300 && (
            <p className="text-[10px] text-gray-400 p-3">
              … 他 {preview.previewRows.length - 300}行（先頭300行を表示中）
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── 入力 ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-bold text-slate-700 text-sm mb-1">配信情報CSV</h3>
          <p className="text-xs text-gray-500">
            列:{' '}
            <code className="bg-gray-100 px-1 rounded">workTitle</code>（必須）、
            <code className="bg-gray-100 px-1 rounded">vodService</code>（必須）、
            <code className="bg-gray-100 px-1 rounded">availabilityType</code>、
            <code className="bg-gray-100 px-1 rounded">sourceUrl</code>、
            <code className="bg-gray-100 px-1 rounded">confidence</code>、
            <code className="bg-gray-100 px-1 rounded">note</code>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            TMDb 取得済みの作品タイトルと照合します。先にデータ取得を完了させてください。
          </p>
        </div>

        <div
          className="px-5 py-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <textarea
            value={csvText}
            onChange={(e) => { setCsvText(e.target.value); setPreview(null); }}
            placeholder={SAMPLE_CSV}
            rows={8}
            className="w-full font-mono text-xs border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
          />
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <label className="cursor-pointer px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              ファイルを選択
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <button
              type="button"
              onClick={() => { setCsvText(SAMPLE_CSV); setPreview(null); }}
              className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              サンプルを挿入
            </button>
            {csvText.trim() && (
              <button
                type="button"
                onClick={() => { setCsvText(''); setPreview(null); setError(''); if (fileRef.current) fileRef.current.value = ''; }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-red-500"
              >
                クリア
              </button>
            )}
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || !csvText.trim()}
              className="ml-auto px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {loading ? '照合中…' : 'プレビュー'}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-4">
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
              {error}
            </p>
          </div>
        )}
      </div>

      {/* 仕様メモ */}
      <details className="bg-gray-50 border border-gray-200 rounded-xl">
        <summary className="px-4 py-3 text-xs font-semibold text-gray-600 cursor-pointer select-none">
          配信情報CSV 仕様
        </summary>
        <div className="px-4 pb-4 text-xs text-gray-500 space-y-2">
          <p className="font-semibold text-gray-700">照合の仕組み</p>
          <p>workTitle を TMDb 取得済み全作品のタイトル（日本語 / 原題）と照合します。</p>
          <p>同一タイトルが複数人物の作品一覧に存在する場合、全員に適用されます。</p>
          <p className="font-semibold text-gray-700 mt-3">availabilityType の値</p>
          <ul className="ml-2 space-y-0.5">
            <li><code className="bg-gray-100 px-1 rounded">flatrate</code> — 見放題（デフォルト）</li>
            <li><code className="bg-gray-100 px-1 rounded">rent</code> — レンタル</li>
            <li><code className="bg-gray-100 px-1 rounded">buy</code> — 購入</li>
            <li><code className="bg-gray-100 px-1 rounded">free</code> — 無料</li>
            <li><code className="bg-gray-100 px-1 rounded">ads</code> — 広告付き無料</li>
          </ul>
          <p className="font-semibold text-gray-700 mt-3">confidence の値</p>
          <p>high / medium / low　（low は公開ページ非表示）</p>
          <pre className="bg-white border border-gray-200 rounded p-2 overflow-x-auto leading-relaxed mt-2">
{`workTitle,vodService,availabilityType,sourceUrl,confidence,note
量産型ルカ,Lemino,flatrate,https://lemino.docomo.ne.jp/...,high,公式確認
ザ・ファブル,Netflix,flatrate,,high,`}
          </pre>
        </div>
      </details>
    </div>
  );
}
