'use client';

import { useState, useRef } from 'react';
import PersonCombobox from '@/components/admin/PersonCombobox';

interface PersonInfo {
  name: string;
  group: string;
}

interface WorkImportPreviewRow {
  rowNum: number;
  personName: string;
  workTitle: string;
  workType: string;
  releaseYear: string;
  roleName: string;
  action: 'add' | 'existing' | 'error';
  reason: string;
  vodService: string;
  availabilityType: string;
  sourceUrl: string;
  confidence: string;
  note: string;
  vodAction: 'add' | 'skip' | 'none';
  vodSkipReason?: string;
}

interface WorkImportPreviewResult {
  addCount: number;
  existingCount: number;
  errorCount: number;
  vodAddCount: number;
  vodSkipCount: number;
  previewRows: WorkImportPreviewRow[];
}

interface WorkImportCommitResult {
  savedCount: number;
  existingCount: number;
  skipCount: number;
  vodSavedCount: number;
  vodSkippedCount: number;
  failedCount: number;
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

export default function WorksImportSection({ persons }: { persons: PersonInfo[] }) {
  const [workImportPerson, setWorkImportPerson] = useState('');
  const [workImportCsvContent, setWorkImportCsvContent] = useState<string | null>(null);
  const [workImportFileName, setWorkImportFileName] = useState('');
  const [workImporting, setWorkImporting] = useState(false);
  const [workImportPreview, setWorkImportPreview] = useState<WorkImportPreviewResult | null>(null);
  const [workImportCommitResult, setWorkImportCommitResult] = useState<WorkImportCommitResult | null>(null);
  const [workImportError, setWorkImportError] = useState<ImportError | null>(null);

  const workImportFileRef = useRef<HTMLInputElement>(null);

  async function handleWorkImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setWorkImportCsvContent(text);
    setWorkImportFileName(file.name);
    setWorkImportPreview(null);
    setWorkImportCommitResult(null);
    setWorkImportError(null);
  }

  async function handleWorkImportPreview() {
    if (!workImportCsvContent) return;
    setWorkImporting(true);
    setWorkImportError(null);
    try {
      const res = await fetch('/api/admin/work-csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent: workImportCsvContent,
          commit: false,
          personName: workImportPerson || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWorkImportPreview(data as WorkImportPreviewResult);
      } else {
        setWorkImportError(data as ImportError);
      }
    } catch {
      setWorkImportError({ error: '通信エラーが発生しました' });
    }
    setWorkImporting(false);
  }

  async function handleWorkImportCommit() {
    if (!workImportCsvContent || !workImportPreview) return;
    setWorkImporting(true);
    setWorkImportError(null);
    try {
      const res = await fetch('/api/admin/work-csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvContent: workImportCsvContent,
          commit: true,
          personName: workImportPerson || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setWorkImportCommitResult(data as WorkImportCommitResult);
        setWorkImportPreview(null);
        setWorkImportCsvContent(null);
        setWorkImportFileName('');
        if (workImportFileRef.current) workImportFileRef.current.value = '';
      } else {
        setWorkImportError(data as ImportError);
      }
    } catch {
      setWorkImportError({ error: '通信エラーが発生しました' });
    }
    setWorkImporting(false);
  }

  function handleWorkImportReset() {
    setWorkImportPreview(null);
    setWorkImportCsvContent(null);
    setWorkImportFileName('');
    setWorkImportError(null);
    setWorkImportCommitResult(null);
    if (workImportFileRef.current) workImportFileRef.current.value = '';
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
      <div>
        <p className="text-xs font-semibold text-slate-600">作品 CSVインポート</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          TMDbで取得できなかった出演作品をCSVから追加します。VOD情報も同時に登録できます。
        </p>
        <div className="mt-1 bg-gray-50 rounded-lg px-3 py-2 space-y-1">
          <p className="text-[10px] text-gray-500 font-semibold">
            必須列: <span className="font-mono">workTitle（またはtitle）, workType（またはtype）</span>
          </p>
          <p className="text-[10px] text-gray-500">
            任意列: <span className="font-mono">personId / personName, releaseYear, roleName, vodService, availabilityType, sourceUrl, confidence, note</span>
          </p>
          <p className="text-[10px] text-gray-500">
            workType: <span className="font-mono">movie / tv / variety / documentary / web / drama / special / stage</span> 等（日本語も可）
          </p>
          <p className="text-[10px] text-gray-400">
            ※ 補完CSVダウンロード（16列）・ChatGPT調査返却CSVそのまま使用可
          </p>
          <p className="text-[10px] text-orange-500 font-medium">
            ※ CSVにpersonId/personName列がない場合は、下の「対象人物」を必ず選択してください
          </p>
        </div>
      </div>

      {/* 対象人物セレクター */}
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-gray-600 font-medium whitespace-nowrap">対象人物:</label>
        <PersonCombobox
          persons={persons}
          value={workImportPerson}
          onChange={(name) => {
            setWorkImportPerson(name);
            setWorkImportPreview(null);
            setWorkImportError(null);
          }}
          allowEmpty
          emptyLabel="CSVのpersonId/personName列を使用"
          placeholder="人物名・グループ名で検索..."
          className="w-64"
        />
        {workImportPerson && (
          <span className="text-[11px] text-orange-600 font-medium">
            → {workImportPerson} の作品のみ対象
          </span>
        )}
      </div>

      {/* ファイル選択 */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          ref={workImportFileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleWorkImportFileChange}
          className="text-xs text-gray-600 file:mr-2 file:text-xs file:border file:border-gray-200 file:rounded-lg file:px-2 file:py-1 file:bg-gray-50 file:text-gray-600 file:cursor-pointer hover:file:bg-gray-100"
        />
        {workImportCsvContent && !workImportPreview && (
          <button
            onClick={handleWorkImportPreview}
            disabled={workImporting}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
          >
            {workImporting ? '確認中...' : 'プレビュー確認'}
          </button>
        )}
      </div>

      {workImportFileName && (
        <p className="text-[10px] text-gray-400">読み込み: {workImportFileName}</p>
      )}

      {/* エラー表示 */}
      {workImportError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-2">
          <p className="text-xs font-semibold text-red-700">{workImportError.error}</p>
          {workImportError.details && (
            <div className="space-y-1.5 text-[11px]">
              <div>
                <span className="text-red-500 font-medium">読み込んだ列: </span>
                <span className="text-gray-600 font-mono">{workImportError.details.foundColumns}</span>
              </div>
              <div>
                <span className="text-red-500 font-medium">不足している列: </span>
                <span className="text-red-700 font-mono font-semibold">{workImportError.details.missingColumns}</span>
              </div>
              <p className="text-gray-600">{workImportError.details.fix}</p>
              <div>
                <p className="text-gray-500 font-medium mb-0.5">正しいCSV例:</p>
                <pre className="bg-white border border-red-100 rounded p-2 text-[10px] text-gray-600 overflow-x-auto whitespace-pre">
                  {workImportError.details.example}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* コミット完了 */}
      {workImportCommitResult && (
        <div className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 space-y-0.5">
          <p className="font-semibold">
            インポート完了: 作品 {workImportCommitResult.savedCount}件追加
            {(workImportCommitResult.vodSavedCount ?? 0) > 0 && (
              <span className="ml-2">/ VOD {workImportCommitResult.vodSavedCount}件追加</span>
            )}
          </p>
          <p className="text-gray-500">
            {(workImportCommitResult.skipCount ?? 0) > 0 && `作品スキップ: ${workImportCommitResult.skipCount}件`}
            {(workImportCommitResult.vodSkippedCount ?? 0) > 0 && (
              <span className="ml-2">VOD重複スキップ: {workImportCommitResult.vodSkippedCount}件</span>
            )}
            {workImportCommitResult.failedCount > 0 && (
              <span className="text-red-600 ml-2">失敗: {workImportCommitResult.failedCount}件</span>
            )}
          </p>
          {workImportCommitResult.errors.length > 0 && (
            <p className="text-orange-600 text-[11px]">
              {workImportCommitResult.errors.slice(0, 3).join(' / ')}
            </p>
          )}
        </div>
      )}

      {/* プレビュー表示 */}
      {workImportPreview && (
        <div className="space-y-3">
          {/* サマリー */}
          <div className="flex flex-wrap gap-2 text-xs items-center">
            <span className="font-semibold text-slate-600">作品インポート:</span>
            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-medium">
              新規作品 {workImportPreview.addCount}件
            </span>
            {(workImportPreview.existingCount ?? 0) > 0 && (
              <span className="bg-sky-100 text-sky-700 px-2 py-1 rounded-lg font-medium">
                既存作品に紐付け {workImportPreview.existingCount}件
              </span>
            )}
            {workImportPreview.vodAddCount > 0 && (
              <span className="bg-teal-100 text-teal-700 px-2 py-1 rounded-lg font-medium">
                VOD追加 {workImportPreview.vodAddCount}件
              </span>
            )}
            {(workImportPreview.vodSkipCount ?? 0) > 0 && (
              <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg font-medium">
                VOD重複スキップ {workImportPreview.vodSkipCount}件
              </span>
            )}
            {workImportPreview.errorCount > 0 && (
              <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-lg font-medium">
                エラー {workImportPreview.errorCount}件
              </span>
            )}
          </div>

          {/* プレビューテーブル */}
          {workImportPreview.previewRows.length > 0 && (
            <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-gray-500">
                    <th className="text-left p-1.5 border-b border-gray-200 w-8">行</th>
                    <th className="text-left p-1.5 border-b border-gray-200 w-12">作品</th>
                    <th className="text-left p-1.5 border-b border-gray-200">人物</th>
                    <th className="text-left p-1.5 border-b border-gray-200">タイトル</th>
                    <th className="text-left p-1.5 border-b border-gray-200">種別/年</th>
                    <th className="text-left p-1.5 border-b border-gray-200 w-12">VOD</th>
                    <th className="text-left p-1.5 border-b border-gray-200">配信サービス</th>
                    <th className="text-left p-1.5 border-b border-gray-200">備考</th>
                  </tr>
                </thead>
                <tbody>
                  {workImportPreview.previewRows.slice(0, 200).map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-100 last:border-0 ${
                        row.action === 'error' ? 'bg-orange-50' : ''
                      }`}
                    >
                      <td className="p-1.5 text-gray-400">{row.rowNum}</td>
                      <td className="p-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          row.action === 'add'      ? 'bg-green-100 text-green-700' :
                          row.action === 'existing' ? 'bg-sky-100 text-sky-700' :
                                                      'bg-orange-100 text-orange-700'
                        }`}>
                          {row.action === 'add' ? '新規' : row.action === 'existing' ? '既存' : 'ERR'}
                        </span>
                      </td>
                      <td className="p-1.5 text-gray-600">{row.personName || '—'}</td>
                      <td className="p-1.5 text-slate-700 max-w-[120px] truncate" title={row.workTitle}>
                        {row.workTitle || '—'}
                      </td>
                      <td className="p-1.5 text-gray-400 whitespace-nowrap">
                        {row.workType}{row.releaseYear ? ` ${row.releaseYear}` : ''}
                      </td>
                      <td className="p-1.5">
                        {row.vodAction === 'none' ? (
                          <span className="text-gray-300 text-[9px]">—</span>
                        ) : (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                            row.vodAction === 'add' ? 'bg-teal-100 text-teal-700' : 'bg-gray-100 text-gray-400'
                          }`}>
                            {row.vodAction === 'add' ? 'VOD' : 'dup'}
                          </span>
                        )}
                      </td>
                      <td className="p-1.5 text-slate-600 max-w-[100px] truncate" title={row.vodService}>
                        {row.vodService || '—'}
                        {row.availabilityType ? (
                          <span className="text-gray-400 ml-1">({row.availabilityType})</span>
                        ) : null}
                      </td>
                      <td className="p-1.5 text-gray-400 max-w-[140px] truncate" title={row.vodSkipReason ?? row.reason}>
                        {row.vodSkipReason ?? row.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {workImportPreview.previewRows.length > 200 && (
                <p className="text-[10px] text-gray-400 p-2">
                  ... 他 {workImportPreview.previewRows.length - 200}行（先頭200行を表示中）
                </p>
              )}
            </div>
          )}

          {/* 実行ボタン */}
          <div className="flex items-center gap-3">
            {(workImportPreview.addCount > 0 || workImportPreview.vodAddCount > 0) ? (
              <button
                onClick={handleWorkImportCommit}
                disabled={workImporting}
                className="text-xs px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold transition-colors disabled:opacity-50"
              >
                {workImporting
                  ? '保存中...'
                  : [
                      workImportPreview.addCount > 0 ? `作品${workImportPreview.addCount}件追加` : '',
                      workImportPreview.vodAddCount > 0 ? `VOD${workImportPreview.vodAddCount}件追加` : '',
                    ].filter(Boolean).join(' + ') + ' 実行'
                }
              </button>
            ) : (
              <p className="text-xs text-gray-500">追加対象がありません（スキップ・エラーのみ）</p>
            )}
            <button
              onClick={handleWorkImportReset}
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
