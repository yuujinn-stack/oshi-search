'use client';

import { useState, useRef } from 'react';

type ExportFilter = 'all' | 'auto_published' | 'needs_review' | 'no_vod' | 'ai_only' | 'tmdb_only';

const FILTER_LABELS: Record<ExportFilter, string> = {
  all: '全作品',
  auto_published: '公開中のみ',
  needs_review: '確認待ちのみ',
  no_vod: '配信情報なし',
  ai_only: 'AI補完VOD作品',
  tmdb_only: 'TMDb VOD取得作品',
};

interface PreviewRow {
  rowNum: number;
  workId: string;
  personName: string;
  title: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
  action: 'add' | 'update' | 'ignore' | 'error';
  reason: string;
}

interface PreviewResult {
  addCount: number;
  updateCount: number;
  ignoreCount: number;
  errorCount: number;
  previewRows: PreviewRow[];
}

interface CommitResult {
  savedWorkCount: number;
  savedProviderCount: number;
  errors: string[];
}

interface ImportError {
  error: string;
  details?: {
    foundColumns: string;
    missingColumns: string;
    fix: string;
    example: string;
  };
}

const ACTION_BADGE: Record<PreviewRow['action'], string> = {
  add: 'bg-green-100 text-green-700',
  update: 'bg-yellow-100 text-yellow-700',
  ignore: 'bg-gray-100 text-gray-500',
  error: 'bg-red-100 text-red-700',
};
const ACTION_LABEL: Record<PreviewRow['action'], string> = {
  add: '追加',
  update: '上書',
  ignore: '無視',
  error: 'エラー',
};

export default function CsvSection({ persons }: { persons: string[] }) {
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [exportPerson, setExportPerson] = useState('');

  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  function buildExportUrl() {
    const params = new URLSearchParams();
    if (exportFilter !== 'all') params.set('filter', exportFilter);
    if (exportPerson) params.set('person', exportPerson);
    const qs = params.toString();
    return `/api/admin/csv-export${qs ? `?${qs}` : ''}`;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvContent(text);
    setFileName(file.name);
    setPreview(null);
    setCommitResult(null);
    setImportError(null);
  }

  async function handlePreview() {
    if (!csvContent) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, commit: false }),
      });
      const data = await res.json();
      if (res.ok) {
        setPreview(data as PreviewResult);
      } else {
        setImportError(data as ImportError);
      }
    } catch {
      setImportError({ error: '通信エラーが発生しました' });
    }
    setImporting(false);
  }

  async function handleCommit() {
    if (!csvContent || !preview) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, commit: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setCommitResult(data as CommitResult);
        setPreview(null);
        setCsvContent(null);
        setFileName('');
        if (fileRef.current) fileRef.current.value = '';
      } else {
        setImportError(data as ImportError);
      }
    } catch {
      setImportError({ error: '通信エラーが発生しました' });
    }
    setImporting(false);
  }

  function handleReset() {
    setPreview(null);
    setCsvContent(null);
    setFileName('');
    setImportError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  const importTotal = (preview?.addCount ?? 0) + (preview?.updateCount ?? 0);

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-white space-y-5">
      <h2 className="text-sm font-bold text-slate-700">CSV 出力 / VOD調査インポート</h2>

      {/* ── 出力セクション ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">作品データ CSV出力</p>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={exportFilter}
            onChange={(e) => setExportFilter(e.target.value as ExportFilter)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            {(Object.entries(FILTER_LABELS) as [ExportFilter, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select
            value={exportPerson}
            onChange={(e) => setExportPerson(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            <option value="">全人物</option>
            {persons.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <a
            href={buildExportUrl()}
            download
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-white hover:bg-slate-800 transition-colors font-medium"
          >
            📄 CSV出力
          </a>
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* ── インポートセクション ── */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-600">VOD調査結果 CSVインポート</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            ChatGPT等で調査した結果をインポートします。既存のTMDb・AI情報は保持されます。
          </p>
          <div className="mt-1 bg-gray-50 rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-500 font-semibold mb-0.5">必須列: workId, vodService　（列順・余分な列は自由）</p>
            <p className="text-[10px] font-mono text-gray-400">
              workId, vodService, availabilityType, confidence, sourceUrl, note
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="text-xs text-gray-600 file:mr-2 file:text-xs file:border file:border-gray-200 file:rounded-lg file:px-2 file:py-1 file:bg-gray-50 file:text-gray-600 file:cursor-pointer hover:file:bg-gray-100"
          />
          {csvContent && !preview && (
            <button
              onClick={handlePreview}
              disabled={importing}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
            >
              {importing ? '確認中...' : 'プレビュー確認'}
            </button>
          )}
        </div>

        {fileName && (
          <p className="text-[10px] text-gray-400">読み込み: {fileName}</p>
        )}

        {/* ── エラー表示（詳細付き） ── */}
        {importError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-2">
            <p className="text-xs font-semibold text-red-700">{importError.error}</p>
            {importError.details && (
              <div className="space-y-1.5 text-[11px]">
                <div>
                  <span className="text-red-500 font-medium">読み込んだ列: </span>
                  <span className="text-gray-600 font-mono">{importError.details.foundColumns}</span>
                </div>
                <div>
                  <span className="text-red-500 font-medium">不足している列: </span>
                  <span className="text-red-700 font-mono font-semibold">{importError.details.missingColumns}</span>
                </div>
                <div>
                  <span className="text-gray-600">{importError.details.fix}</span>
                </div>
                <div>
                  <p className="text-gray-500 font-medium mb-0.5">正しいCSV例:</p>
                  <pre className="bg-white border border-red-100 rounded p-2 text-[10px] text-gray-600 overflow-x-auto whitespace-pre">
                    {importError.details.example}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── コミット完了 ── */}
        {commitResult && (
          <div className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 space-y-0.5">
            <p className="font-semibold">
              インポート完了: {commitResult.savedWorkCount}件の作品に {commitResult.savedProviderCount}件の配信情報を保存しました
            </p>
            {commitResult.errors.length > 0 && (
              <p className="text-orange-600">
                エラー {commitResult.errors.length}件: {commitResult.errors.slice(0, 2).join(' / ')}
              </p>
            )}
          </div>
        )}

        {/* ── プレビュー ── */}
        {preview && (
          <div className="space-y-3">
            {/* サマリー */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="font-semibold text-slate-600 self-center">取込予定:</span>
              <span className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-medium">追加 {preview.addCount}件</span>
              <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-lg font-medium">上書 {preview.updateCount}件</span>
              <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg font-medium">スキップ {preview.ignoreCount}件</span>
              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-lg font-medium">エラー {preview.errorCount}件</span>
            </div>

            {/* プレビューテーブル */}
            {preview.previewRows.length > 0 && (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left p-1.5 border-b border-gray-200 w-8">行</th>
                      <th className="text-left p-1.5 border-b border-gray-200 w-12">操作</th>
                      <th className="text-left p-1.5 border-b border-gray-200">人物</th>
                      <th className="text-left p-1.5 border-b border-gray-200">作品</th>
                      <th className="text-left p-1.5 border-b border-gray-200">配信サービス</th>
                      <th className="text-left p-1.5 border-b border-gray-200">種別</th>
                      <th className="text-left p-1.5 border-b border-gray-200">確度</th>
                      <th className="text-left p-1.5 border-b border-gray-200">備考・理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.slice(0, 200).map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-gray-100 last:border-0 ${
                          row.action === 'error' ? 'bg-red-50' :
                          row.action === 'ignore' ? 'opacity-50' : ''
                        }`}
                      >
                        <td className="p-1.5 text-gray-400">{row.rowNum}</td>
                        <td className="p-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${ACTION_BADGE[row.action]}`}>
                            {ACTION_LABEL[row.action]}
                          </span>
                        </td>
                        <td className="p-1.5 text-gray-600">{row.personName || '—'}</td>
                        <td className="p-1.5 max-w-[100px] truncate text-slate-700" title={row.title}>
                          {row.title || row.workId}
                        </td>
                        <td className="p-1.5 font-medium text-slate-700">{row.vodService || '（空）'}</td>
                        <td className="p-1.5 text-gray-500">{row.availabilityType}</td>
                        <td className="p-1.5 text-gray-500">{row.confidence}</td>
                        <td className="p-1.5 text-gray-400 max-w-[180px] truncate" title={row.reason}>
                          {row.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.previewRows.length > 200 && (
                  <p className="text-[10px] text-gray-400 p-2">
                    ... 他 {preview.previewRows.length - 200}行（先頭200行を表示中）
                  </p>
                )}
              </div>
            )}

            {/* インポート実行ボタン */}
            <div className="flex items-center gap-3">
              {importTotal > 0 ? (
                <button
                  onClick={handleCommit}
                  disabled={importing}
                  className="text-xs px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 font-bold"
                >
                  {importing ? '保存中...' : `インポート実行（${importTotal}件保存）`}
                </button>
              ) : (
                <p className="text-xs text-gray-500">保存対象がありません（エラー・スキップのみ）</p>
              )}
              <button
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
