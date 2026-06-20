'use client';

import { useState, useRef } from 'react';

// ─────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────

interface PersonInfo {
  name: string;
  group: string;
}

type ExportFilter =
  | 'all'
  | 'auto_published'
  | 'needs_review'
  | 'hidden'
  | 'no_vod'
  | 'ai_only'
  | 'tmdb_only';

const FILTER_LABELS: Record<ExportFilter, string> = {
  all: '全作品',
  auto_published: '公開中のみ',
  needs_review: '確認待ちのみ',
  hidden: '非表示のみ',
  no_vod: '配信情報なし',
  ai_only: 'AI補完VOD作品',
  tmdb_only: 'TMDb VOD取得作品',
};

const STATUS_LABEL: Record<string, string> = {
  auto_published: '公開中',
  needs_review: '確認待ち',
  hidden: '非表示',
};
const STATUS_BADGE: Record<string, string> = {
  auto_published: 'bg-green-100 text-green-700',
  needs_review: 'bg-yellow-100 text-yellow-700',
  hidden: 'bg-gray-100 text-gray-500',
};

// ─────────────────────────────────────────
// インポート関連型
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
// エクスポートプレビュー型
// ─────────────────────────────────────────

interface ExportPreviewWork {
  workId: string;
  title: string;
  personName: string;
  status: string;
  releaseYear: number | null;
  currentVodServices: string;
}

interface ExportPreviewResult {
  count: number;
  personName: string;
  filter: string;
  works: ExportPreviewWork[];
  warning?: string;
}

// ─────────────────────────────────────────
// バッジ定義
// ─────────────────────────────────────────

const ACTION_BADGE: Record<ImportPreviewRow['action'], string> = {
  add: 'bg-green-100 text-green-700',
  update: 'bg-yellow-100 text-yellow-700',
  delete: 'bg-red-100 text-red-700',
  ignore: 'bg-gray-100 text-gray-500',
  skip: 'bg-sky-100 text-sky-700',
  error: 'bg-orange-100 text-orange-700',
};
const ACTION_LABEL: Record<ImportPreviewRow['action'], string> = {
  add: '追加',
  update: '上書',
  delete: '削除',
  ignore: '無視',
  skip: 'スキップ',
  error: 'エラー',
};

// ─────────────────────────────────────────
// ChatGPT調査用プロンプトを生成（入力: 8列簡略CSV、出力指示: 10列統合CSV形式）
// ─────────────────────────────────────────

function buildChatGptPrompt(simpleCsv: string): string {
  return `━━━━━━━━━━━━━━━━━━
調査依頼
━━━━━━━━━━━━━━━━━━

以下のCSVに含まれる作品について調査してください。

条件

・TMDbに存在しない作品も調査対象
・ドラマ
・映画
・バラエティ
・配信限定番組
・アイドル番組
・特番
・舞台映像作品

を含めて調査

推測禁止

確認できた情報のみ記載

出力は以下のCSV形式

personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note

CSV:

${simpleCsv}

━━━━━━━━━━━━━━━━━━`;
}

// ─────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────

export default function CsvSection({ persons }: { persons: PersonInfo[] }) {
  // ── エクスポート状態 ──
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [exportPersons, setExportPersons] = useState<string[]>([]); // 空 = 全人物
  const [personSelectorOpen, setPersonSelectorOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreviewResult | null>(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [exportPreviewError, setExportPreviewError] = useState('');
  const [csvText, setCsvText] = useState<string | null>(null);         // 詳細CSV（ダウンロード・クリップボード用）
  const [simpleCsvText, setSimpleCsvText] = useState<string | null>(null); // 8列CSV（ChatGPT用）
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'csv' | 'prompt'>('idle');

  // ── インポート状態 ──
  const [importMode, setImportMode] = useState<'upsert' | 'sync'>('upsert');
  const [importPerson, setImportPerson] = useState('');
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importCommitResult, setImportCommitResult] = useState<ImportCommitResult | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // ── 重複整理状態 ──
  const [dedupPerson, setDedupPerson] = useState('');
  const [deduping, setDeduping] = useState(false);
  const [dedupResult, setDedupResult] = useState<{ checkedWorks: number; deduplicatedWorks: number; removedCount: number } | null>(null);
  const [dedupError, setDedupError] = useState('');

  // ─────────────────────────────────────────
  // グループ別に人物をまとめる（UI表示用）
  // ─────────────────────────────────────────

  const groupedPersons: Record<string, PersonInfo[]> = {};
  for (const p of persons) {
    const key = p.group || '（グループなし）';
    if (!groupedPersons[key]) groupedPersons[key] = [];
    groupedPersons[key].push(p);
  }
  const groupNames = Object.keys(groupedPersons).sort();

  // ─────────────────────────────────────────
  // URL ビルダー
  // ─────────────────────────────────────────

  function buildExportUrl(extraParams?: Record<string, string>): string {
    const params = new URLSearchParams();
    if (exportFilter !== 'all') params.set('filter', exportFilter);
    if (exportPersons.length > 0) params.set('persons', exportPersons.join(','));
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    }
    const qs = params.toString();
    return `/api/admin/csv-export${qs ? `?${qs}` : ''}`;
  }

  function buildSimpleExportUrl(): string {
    return buildExportUrl({ format: 'simple' });
  }

  // ─────────────────────────────────────────
  // エクスポートハンドラー
  // ─────────────────────────────────────────

  function resetExportPreview() {
    setExportPreview(null);
    setExportPreviewError('');
    setCsvText(null);
    setSimpleCsvText(null);
    setCopyStatus('idle');
  }

  async function handleExportPreview() {
    setExportPreviewLoading(true);
    resetExportPreview();
    try {
      const res = await fetch(buildExportUrl({ mode: 'preview' }));
      const data = (await res.json()) as ExportPreviewResult;
      if (res.ok) {
        setExportPreview(data);
      } else {
        setExportPreviewError((data as { error?: string }).error ?? 'プレビュー取得に失敗しました');
      }
    } catch {
      setExportPreviewError('通信エラーが発生しました');
    }
    setExportPreviewLoading(false);
  }

  // ① 補完CSVダウンロード（詳細CSV）
  async function handleCsvDownload() {
    if (!exportPreview || exportPreview.count === 0) return;
    try {
      const res = await fetch(buildExportUrl());
      if (!res.ok) {
        setExportPreviewError('CSV取得に失敗しました');
        return;
      }
      const text = await res.text();
      setCsvText(text);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') ?? '';
      const fnMatch = cd.match(/filename\*=UTF-8''(.+)$/i);
      a.download = fnMatch ? decodeURIComponent(fnMatch[1]) : `works_export.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setExportPreviewError('ダウンロードに失敗しました');
    }
  }

  // 詳細CSV（ダウンロード・クリップボード用）をキャッシュ付きで取得
  async function fetchCsvAsText(): Promise<string | null> {
    if (csvText !== null) return csvText;
    const res = await fetch(buildExportUrl());
    if (!res.ok) return null;
    const text = await res.text();
    setCsvText(text);
    return text;
  }

  // 8列簡略CSV（ChatGPT用）をキャッシュ付きで取得
  async function fetchSimpleCsvAsText(): Promise<string | null> {
    if (simpleCsvText !== null) return simpleCsvText;
    const res = await fetch(buildSimpleExportUrl());
    if (!res.ok) return null;
    const text = await res.text();
    setSimpleCsvText(text);
    return text;
  }

  // ③ CSVをクリップボードへコピー（詳細CSV）
  async function handleCopyCsv() {
    if (!exportPreview || exportPreview.count === 0) return;
    setCopyLoading(true);
    try {
      const text = await fetchCsvAsText();
      if (!text) { setExportPreviewError('CSV取得に失敗しました'); return; }
      await navigator.clipboard.writeText(text);
      setCopyStatus('csv');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setExportPreviewError('クリップボードへのコピーに失敗しました');
    } finally {
      setCopyLoading(false);
    }
  }

  // ② ChatGPT調査用コピー（8列簡略CSV + プロンプト）
  async function handleCopyPrompt() {
    if (!exportPreview || exportPreview.count === 0) return;
    setCopyLoading(true);
    try {
      const text = await fetchSimpleCsvAsText();
      if (!text) { setExportPreviewError('ChatGPT用CSV取得に失敗しました'); return; }
      await navigator.clipboard.writeText(buildChatGptPrompt(text));
      setCopyStatus('prompt');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setExportPreviewError('クリップボードへのコピーに失敗しました');
    } finally {
      setCopyLoading(false);
    }
  }

  // ─────────────────────────────────────────
  // 人物選択ヘルパー
  // ─────────────────────────────────────────

  function togglePerson(name: string) {
    setExportPersons((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
    resetExportPreview();
  }

  function toggleGroup(groupKey: string) {
    const groupNames = (groupedPersons[groupKey] ?? []).map((p) => p.name);
    const allSelected = groupNames.every((n) => exportPersons.includes(n));
    if (allSelected) {
      setExportPersons((prev) => prev.filter((n) => !groupNames.includes(n)));
    } else {
      setExportPersons((prev) => [...new Set([...prev, ...groupNames])]);
    }
    resetExportPreview();
  }

  function selectAll() {
    setExportPersons([]);
    resetExportPreview();
  }

  function deselectAll() {
    setExportPersons(persons.map((p) => p.name));
    resetExportPreview();
  }

  // ─────────────────────────────────────────
  // インポートハンドラー
  // ─────────────────────────────────────────

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

  const importPersonParam = importPerson || undefined;

  async function handleImportPreview() {
    if (!csvContent) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, commit: false, personName: importPersonParam, syncMode: importMode === 'sync' }),
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
  }

  async function handleImportCommit() {
    if (!csvContent || !importPreview) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch('/api/admin/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, commit: true, personName: importPersonParam, syncMode: importMode === 'sync' }),
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
  }

  function handleImportReset() {
    setImportPreview(null);
    setCsvContent(null);
    setFileName('');
    setImportError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleDedup() {
    setDeduping(true);
    setDedupResult(null);
    setDedupError('');
    try {
      const res = await fetch('/api/admin/vod-dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName: dedupPerson || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setDedupResult(data as { checkedWorks: number; deduplicatedWorks: number; removedCount: number });
      } else {
        setDedupError((data as { error?: string }).error ?? '重複整理に失敗しました');
      }
    } catch {
      setDedupError('通信エラーが発生しました');
    }
    setDeduping(false);
  }

  const importTotal = (importPreview?.addCount ?? 0) + (importPreview?.updateCount ?? 0);
  const importDeleteCount = importPreview?.deleteCount ?? 0;

  // 人物選択ラベル（ヘッダー表示用）
  const personSelectionLabel =
    exportPersons.length === 0
      ? '全人物'
      : exportPersons.length === persons.length
      ? '全人物'
      : `${exportPersons.length}人選択中`;

  // ─────────────────────────────────────────
  // レンダリング
  // ─────────────────────────────────────────

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-white space-y-5">
      <h2 className="text-sm font-bold text-slate-700">CSV 出力 / VOD調査インポート</h2>

      {/* ════════════════════════════════
          エクスポートセクション
      ════════════════════════════════ */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-slate-600">作品データ CSV出力</p>
        <p className="text-[11px] text-gray-400">
          プレビューで対象件数を確認してからCSVをダウンロードしてください。
        </p>

        {/* ── フィルター選択 ── */}
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={exportFilter}
            onChange={(e) => {
              setExportFilter(e.target.value as ExportFilter);
              resetExportPreview();
            }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            {(Object.entries(FILTER_LABELS) as [ExportFilter, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={handleExportPreview}
            disabled={exportPreviewLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-colors disabled:opacity-50 font-medium"
          >
            {exportPreviewLoading ? '確認中...' : '🔍 プレビュー確認'}
          </button>
        </div>

        {/* ── 対象人物 複数選択（折りたたみ式） ── */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setPersonSelectorOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-xs transition-colors"
          >
            <span className="font-medium text-slate-700">
              対象人物:{' '}
              <span className={exportPersons.length > 0 && exportPersons.length < persons.length ? 'text-indigo-600' : 'text-gray-500'}>
                {personSelectionLabel}
              </span>
            </span>
            <span className="text-gray-400 text-[10px]">{personSelectorOpen ? '▲ 閉じる' : '▼ 選択する'}</span>
          </button>

          {personSelectorOpen && (
            <div className="border-t border-gray-100">
              {/* 全選択/全解除 */}
              <div className="flex items-center gap-3 px-3 py-2 bg-white border-b border-gray-100 text-[11px]">
                <button
                  type="button"
                  onClick={selectAll}
                  className={`font-medium transition-colors ${exportPersons.length === 0 ? 'text-indigo-600' : 'text-gray-400 hover:text-indigo-500'}`}
                >
                  全人物
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  全員選択
                </button>
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  全解除
                </button>
                {exportPersons.length > 0 && exportPersons.length < persons.length && (
                  <span className="ml-auto text-indigo-500 font-medium">
                    {exportPersons.length}人選択
                  </span>
                )}
              </div>

              {/* グループ別チェックボックスリスト */}
              <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-3">
                {groupNames.map((groupKey) => {
                  const groupPersons = groupedPersons[groupKey] ?? [];
                  const selectedInGroup = groupPersons.filter((p) => exportPersons.includes(p.name)).length;
                  const allInGroupSelected = selectedInGroup === groupPersons.length;
                  const someInGroupSelected = selectedInGroup > 0 && !allInGroupSelected;

                  return (
                    <div key={groupKey}>
                      {/* グループ名（クリックでグループ全選択/解除） */}
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupKey)}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-gray-500 hover:text-indigo-600 mb-1.5 transition-colors"
                      >
                        <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${
                          allInGroupSelected
                            ? 'bg-indigo-600 border-indigo-600'
                            : someInGroupSelected
                            ? 'bg-indigo-200 border-indigo-400'
                            : 'border-gray-300'
                        }`}>
                          {(allInGroupSelected || someInGroupSelected) && (
                            <span className="text-white text-[8px] leading-none">{allInGroupSelected ? '✓' : '−'}</span>
                          )}
                        </span>
                        {groupKey}
                        <span className="text-gray-400 font-normal">（{groupPersons.length}人）</span>
                      </button>

                      {/* 個人チェックボックス */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 ml-4">
                        {groupPersons.map((p) => (
                          <label
                            key={p.name}
                            className="flex items-center gap-1.5 text-[11px] cursor-pointer hover:text-slate-700 py-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={exportPersons.includes(p.name)}
                              onChange={() => togglePerson(p.name)}
                              className="w-3 h-3 rounded accent-indigo-600 flex-shrink-0"
                            />
                            <span className="truncate">{p.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* エクスポートプレビューエラー */}
        {exportPreviewError && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {exportPreviewError}
          </p>
        )}

        {/* エクスポートプレビュー結果 */}
        {exportPreview && (
          <div className="space-y-2">
            {/* 件数バナー */}
            {exportPreview.warning ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <p className="text-xs text-orange-700 font-semibold">⚠️ {exportPreview.warning}</p>
              </div>
            ) : exportPreview.count === 0 ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <p className="text-xs text-yellow-700 font-semibold">
                  出力対象作品がありません（{exportPreview.personName} / {FILTER_LABELS[exportPreview.filter as ExportFilter] ?? exportPreview.filter}）
                </p>
                <p className="text-[11px] text-yellow-600 mt-0.5">
                  フィルターまたは人物を変更してください。
                </p>
              </div>
            ) : (
              <>
                <div className="bg-slate-50 rounded-lg px-3 py-2 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-slate-700">
                      {exportPreview.personName} / {FILTER_LABELS[exportPreview.filter as ExportFilter] ?? exportPreview.filter}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {exportPreview.count}件
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {/* ① 補完CSVダウンロード（詳細CSV） */}
                    <button
                      onClick={handleCsvDownload}
                      className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-bold"
                    >
                      📄 補完CSVダウンロード
                    </button>
                    {/* ② ChatGPT調査用コピー（8列簡略CSV + プロンプト） */}
                    <button
                      onClick={handleCopyPrompt}
                      disabled={copyLoading}
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50 ${
                        copyStatus === 'prompt'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-violet-600 text-white hover:bg-violet-700'
                      }`}
                    >
                      {copyLoading && copyStatus !== 'csv'
                        ? '取得中...'
                        : copyStatus === 'prompt'
                        ? 'コピー済み!'
                        : '🤖 ChatGPT調査用コピー'}
                    </button>
                    {/* ③ CSVをクリップボードへコピー（詳細CSV） */}
                    <button
                      onClick={handleCopyCsv}
                      disabled={copyLoading}
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors disabled:opacity-50 ${
                        copyStatus === 'csv'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-slate-500 text-white hover:bg-slate-600'
                      }`}
                    >
                      {copyLoading && copyStatus !== 'prompt'
                        ? '取得中...'
                        : copyStatus === 'csv'
                        ? 'コピー済み!'
                        : '📋 CSVをクリップボードへコピー'}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    ※ ChatGPT調査用コピーは8列簡略形式（personName/groupName/workTitle/workType/releaseYear/roleName/source/vodServices）
                  </p>
                </div>

                {/* 作品リスト */}
                <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-gray-500">
                        <th className="text-left p-1.5 border-b border-gray-200">人物</th>
                        <th className="text-left p-1.5 border-b border-gray-200">作品タイトル</th>
                        <th className="text-left p-1.5 border-b border-gray-200">年</th>
                        <th className="text-left p-1.5 border-b border-gray-200">ステータス</th>
                        <th className="text-left p-1.5 border-b border-gray-200">配信</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportPreview.works.slice(0, 200).map((w, i) => (
                        <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                          <td className="p-1.5 text-gray-500 whitespace-nowrap">{w.personName}</td>
                          <td className="p-1.5 text-slate-700 max-w-[180px] truncate" title={w.title}>
                            {w.title}
                          </td>
                          <td className="p-1.5 text-gray-400 whitespace-nowrap">{w.releaseYear ?? '—'}</td>
                          <td className="p-1.5">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${STATUS_BADGE[w.status] ?? 'bg-gray-100 text-gray-500'}`}>
                              {STATUS_LABEL[w.status] ?? w.status}
                            </span>
                          </td>
                          <td className="p-1.5 text-gray-500 max-w-[120px] truncate" title={w.currentVodServices}>
                            {w.currentVodServices}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exportPreview.works.length > 200 && (
                    <p className="text-[10px] text-gray-400 p-2">
                      ... 他 {exportPreview.works.length - 200}件（先頭200件を表示中）
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <hr className="border-gray-100" />

      {/* ════════════════════════════════
          インポートセクション
      ════════════════════════════════ */}
      <div className="space-y-3">
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
              onClick={() => { setImportMode('upsert'); setImportPreview(null); setImportError(null); }}
              className={`px-3 py-1.5 transition-colors ${
                importMode === 'upsert'
                  ? 'bg-slate-700 text-white font-medium'
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              追加/更新モード
            </button>
            <button
              type="button"
              onClick={() => { setImportMode('sync'); setImportPreview(null); setImportError(null); }}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${
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

        {/* 対象人物セレクター（インポート用: 従来の単一select） */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-gray-600 font-medium whitespace-nowrap">対象人物:</label>
          <select
            value={importPerson}
            onChange={(e) => {
              setImportPerson(e.target.value);
              setImportPreview(null);
              setImportError(null);
            }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            <option value="">CSVのpersonId列を使用</option>
            {persons.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
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
              <span className="bg-green-100 text-green-700 px-2 py-1 rounded-lg font-medium">追加 {importPreview.addCount}件</span>
              <span className="bg-yellow-100 text-yellow-700 px-2 py-1 rounded-lg font-medium">上書 {importPreview.updateCount}件</span>
              {importPreview.syncMode && (
                <span className="bg-red-100 text-red-700 px-2 py-1 rounded-lg font-medium">削除 {importDeleteCount}件</span>
              )}
              {(importPreview.skipCount ?? 0) > 0 && (
                <span className="bg-sky-100 text-sky-700 px-2 py-1 rounded-lg font-medium">重複スキップ {importPreview.skipCount}件</span>
              )}
              <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-lg font-medium">無視 {importPreview.ignoreCount}件</span>
              <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-lg font-medium">エラー {importPreview.errorCount}件</span>
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

      <hr className="border-gray-100" />

      {/* ════════════════════════════════
          重複整理セクション
      ════════════════════════════════ */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-600">配信情報の重複を整理</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            同じ配信サービスが複数ソース（TMDb・AI・CSV）に存在する場合、優先度の高いソースを1件残して重複を削除します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={dedupPerson}
            onChange={(e) => { setDedupPerson(e.target.value); setDedupResult(null); setDedupError(''); }}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
          >
            <option value="">全人物</option>
            {persons.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleDedup}
            disabled={deduping}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-colors disabled:opacity-50 font-medium"
          >
            {deduping ? '整理中...' : '🧹 重複を整理'}
          </button>
        </div>

        {dedupError && (
          <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{dedupError}</p>
        )}
        {dedupResult && (
          <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 space-y-0.5">
            <p className="font-semibold text-slate-700">
              重複整理完了: {dedupResult.removedCount === 0 ? '重複なし' : `${dedupResult.removedCount}件削除`}
            </p>
            <p className="text-gray-500">
              確認作品: {dedupResult.checkedWorks}件 / 整理した作品: {dedupResult.deduplicatedWorks}件
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
