'use client';

import { useState, useRef } from 'react';
import PersonCombobox from '@/components/admin/PersonCombobox';

interface PersonInfo {
  name: string;
  group: string;
}

interface ImportPreviewRow {
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
  action: 'add' | 'update' | 'delete' | 'ignore' | 'skip' | 'error';
  reason: string;
}

interface ImportPreviewResult {
  syncMode: boolean;
  addCount: number;
  updateCount: number;
  deleteCount: number;
  ignoreCount: number;
  skipCount: number;
  errorCount: number;
  previewRows: ImportPreviewRow[];
}

interface ImportCommitResult {
  syncMode: boolean;
  savedWorkCount: number;
  savedProviderCount: number;
  deletedProviderCount: number;
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

const ACTION_BADGE: Record<ImportPreviewRow['action'], string> = {
  add:    'bg-green-100 text-green-700',
  update: 'bg-yellow-100 text-yellow-700',
  delete: 'bg-red-100 text-red-700',
  ignore: 'bg-gray-100 text-gray-500',
  skip:   'bg-sky-100 text-sky-700',
  error:  'bg-orange-100 text-orange-700',
};
const ACTION_LABEL: Record<ImportPreviewRow['action'], string> = {
  add:    '追加',
  update: '上書',
  delete: '削除',
  ignore: '無視',
  skip:   'スキップ',
  error:  'エラー',
};

export default function VodImportSection({ persons }: { persons: PersonInfo[] }) {
  const [importMode, setImportMode] = useState<'upsert' | 'sync'>('upsert');
  const [importPerson, setImportPerson] = useState('');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importCommitResult, setImportCommitResult] = useState<ImportCommitResult | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const isSubmitting = useRef(false);

  const importPersonParam = importPerson || undefined;
  const importTotal = (importPreview?.addCount ?? 0) + (importPreview?.updateCount ?? 0);
  const importDeleteCount = importPreview?.deleteCount ?? 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvContent(text);
    setFileName(file.name);
    setImportPreview(null);
    setImportCommitResult(null);
    setImportError(null);
  }

  async function handleImportPreview() {
    if (!csvContent || isSubmitting.current) return;
    isSubmitting.current = true;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent,
          commit: false,
          personName: importPersonParam,
          syncMode: importMode === 'sync',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportPreview(data as ImportPreviewResult);
      } else {
        setImportError(data as ImportError);
      }
    } catch {
      setImportError({ error: '通信エラーが発生しました' });
    }
    setImporting(false);
    isSubmitting.current = false;
  }

  async function handleImportCommit() {
    if (!importPreview || isSubmitting.current) return;
    isSubmitting.current = true;
    setImporting(true);
    setImportError(null);
    try {
      const rowsForSave = importPreview.previewRows.filter(
        (r) => r.action === 'add' || r.action === 'update' || r.action === 'delete',
      );
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commit: true,
          personName: importPersonParam,
          syncMode: importMode === 'sync',
          normalizedRows: rowsForSave,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setImportCommitResult(data as ImportCommitResult);
        setImportPreview(null);
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
    isSubmitting.current = false;
  }

  function handleImportReset() {
    setImportPreview(null);
    setCsvContent(null);
    setFileName('');
    setImportError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-600">VOD調査結果 CSVインポート</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          ChatGPT等で調査した結果をインポートします。既存のTMDb・AI情報は保持されます。
        </p>
        <div className="mt-1 bg-gray-50 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[10px] text-gray-500 font-semibold">
            必須列: <span className="font-mono">workId, vodService</span>　（列順・余分な列は自由）
          </p>
          <p className="text-[10px] text-gray-500">
            任意列: <span className="font-mono">personId, availabilityType, confidence, sourceUrl, note</span>
          </p>
          <p className="text-[10px] text-orange-500 font-medium">
            ※ CSVにpersonId列がない場合は、下の「対象人物」を必ず選択してください
          </p>
        </div>
      </div>

      {/* モード選択 */}
      <div className="flex items-center gap-3">
        <label className="text-[11px] text-gray-600 font-medium whitespace-nowrap">インポートモード:</label>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          <button
            type="button"
            disabled={importing}
            onClick={() => { setImportMode('upsert'); setImportPreview(null); setImportError(null); }}
            className={`px-3 py-1.5 transition-colors disabled:opacity-50 ${
              importMode === 'upsert'
                ? 'bg-slate-700 text-white font-medium'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            追加/更新モード
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={() => { setImportMode('sync'); setImportPreview(null); setImportError(null); }}
            className={`px-3 py-1.5 border-l border-gray-200 transition-colors disabled:opacity-50 ${
              importMode === 'sync'
                ? 'bg-red-600 text-white font-medium'
                : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            同期モード
          </button>
        </div>
        {importMode === 'sync' && (
          <span className="text-[11px] text-red-600 font-medium">
            ⚠️ CSVにない manual_csv 配信先を削除します
          </span>
        )}
      </div>
      {importMode === 'sync' && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700 space-y-0.5">
          <p className="font-semibold">同期モードの動作:</p>
          <p>• CSVに記載された配信先を追加/更新します</p>
          <p>• CSVに記載されていない既存の <span className="font-mono">manual_csv</span> 配信先を削除します</p>
          <p>• TMDb・AI・manual 由来の配信先は削除しません</p>
          <p>• 削除対象は CSV に記載された personId + workId の組み合わせのみです</p>
        </div>
      )}

      {/* 対象人物セレクター */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-gray-600 font-medium whitespace-nowrap">対象人物:</label>
        <PersonCombobox
          persons={persons}
          value={importPerson}
          onChange={(name) => {
            setImportPerson(name);
            setImportPreview(null);
            setImportError(null);
          }}
          allowEmpty
          emptyLabel="CSVのpersonId列を使用"
          placeholder="人物名・グループ名で検索..."
          className="w-64"
        />
        {importPerson && (
          <span className="text-[11px] text-orange-600 font-medium">
            → {importPerson} の作品のみ対象
          </span>
        )}
      </div>

      {/* ファイル選択 + プレビューボタン */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="text-xs text-gray-600 file:mr-2 file:text-xs file:border file:border-gray-200 file:rounded-lg file:px-2 file:py-1 file:bg-gray-50 file:text-gray-600 file:cursor-pointer hover:file:bg-gray-100"
        />
        {csvContent && !importPreview && (
          <button
            onClick={handleImportPreview}
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

      {/* インポートエラー表示 */}
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

      {/* コミット完了 */}
      {importCommitResult && (
        <div className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 space-y-0.5">
          <p className="font-semibold">
            {importCommitResult.syncMode ? '同期モード' : '追加/更新モード'}完了:
            {' '}{importCommitResult.savedWorkCount}件の作品を更新しました
          </p>
          <p>
            配信先 追加/更新: {importCommitResult.savedProviderCount}件
            {importCommitResult.syncMode && importCommitResult.deletedProviderCount > 0 && (
              <span className="text-red-600 ml-2">削除: {importCommitResult.deletedProviderCount}件</span>
            )}
          </p>
          {importCommitResult.errors.length > 0 && (
            <p className="text-orange-600">
              エラー {importCommitResult.errors.length}件: {importCommitResult.errors.slice(0, 2).join(' / ')}
            </p>
          )}
        </div>
      )}

      {/* インポートプレビュー */}
      {importPreview && (
        <div className="space-y-3">
          {/* サマリー */}
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="font-semibold text-slate-600">
              {importPreview.syncMode ? '同期モード' : '追加/更新モード'}:
            </span>
            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-medium">
              追加 {importPreview.addCount}件
            </span>
            <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-lg font-medium">
              上書 {importPreview.updateCount}件
            </span>
            {importPreview.syncMode && (
              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-lg font-medium">
                削除 {importDeleteCount}件
              </span>
            )}
            {(importPreview.skipCount ?? 0) > 0 && (
              <span className="bg-sky-100 text-sky-700 px-2 py-1 rounded-lg font-medium">
                重複スキップ {importPreview.skipCount}件
              </span>
            )}
            <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg font-medium">
              無視 {importPreview.ignoreCount}件
            </span>
            <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-lg font-medium">
              エラー {importPreview.errorCount}件
            </span>
          </div>

          {/* プレビューテーブル */}
          {importPreview.previewRows.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-72 overflow-y-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-gray-500">
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
                  {importPreview.previewRows.slice(0, 200).map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 last:border-0 ${
                        row.action === 'delete' ? 'bg-red-50/60' :
                        row.action === 'error'  ? 'bg-orange-50' :
                        row.action === 'ignore' ? 'opacity-50' : ''
                      }`}
                    >
                      <td className="p-1.5 text-gray-400">
                        {row.rowNum === 0 ? '—' : row.rowNum}
                      </td>
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
              {importPreview.previewRows.length > 200 && (
                <p className="text-[10px] text-gray-400 p-2">
                  ... 他 {importPreview.previewRows.length - 200}行（先頭200行を表示中）
                </p>
              )}
            </div>
          )}

          {/* インポート実行ボタン */}
          <div className="flex items-center gap-3">
            {importTotal > 0 || (importPreview.syncMode && importDeleteCount > 0) ? (
              <button
                onClick={handleImportCommit}
                disabled={importing}
                className={`text-xs px-4 py-2 rounded-lg transition-colors disabled:opacity-50 font-bold text-white ${
                  importPreview.syncMode
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {importing
                  ? '保存中...'
                  : importPreview.syncMode
                    ? `同期モード実行（追加/更新${importTotal}件・削除${importDeleteCount}件）`
                    : `インポート実行（${importTotal}件保存）`
                }
              </button>
            ) : (
              <p className="text-xs text-gray-500">保存対象がありません（エラー・スキップのみ）</p>
            )}
            <button
              onClick={handleImportReset}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
