'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import type { RecheckListResult, RecheckListItem } from '@/lib/vod-recheck-list';
import type { RecheckReasonCode, RecheckPriority, RecheckAction } from '@/lib/vod-recheck';
import type { RecheckListMode, RecheckSortOption } from '@/lib/vod-recheck-store';
import type { VodRecheckCsvImportMode } from '@/lib/vod-recheck-csv-import';
import type { ChatgptSyncDiff } from '@/lib/vod-chatgpt-sync';
import type { VodStaleStatus } from '@/lib/vod-stale';
import { parseCSV } from '@/lib/csv-parse';
import { validateCsvFile, formatFileSize } from '@/lib/csv-file-validation';
import { addSelection, removeSelection, computeNextBatch } from '@/lib/vod-recheck-selection';
import { CHATGPT_PROTECTION_DAYS } from '@/lib/vod-chatgpt-sync';
import ChatGptPromptResultPanel from '@/components/admin/ChatGptPromptResultPanel';

const CHATGPT_STALE_DAY_OPTIONS = [30, 60, 90, 180] as const;

interface CsvPreviewWork {
  workId: string;
  resolvedFrom?: string[];
  title: string | null;
  persons: string[];
  services: Array<{ providerName: string; availabilityType: string }>;
  currentVodCount: number;
  afterVodCount: number;
  warnings: string[];
  errors: string[];
  diff?: ChatgptSyncDiff;
  ambiguous?: boolean;
}

interface CsvPreviewResponse {
  commit: false;
  mode: VodRecheckCsvImportMode;
  preview: CsvPreviewWork[];
  unresolvedWorkIds: string[];
  hasFatalErrors: boolean;
  totalWorkIds: number;
  totalRows: number;
  summary?: { added: number; updated: number; removed: number; unchanged: number; zeroVod: number };
  missingFromLastPrompt?: string[];
}

const MODE_OPTIONS: Array<{ value: RecheckListMode; label: string; description: string }> = [
  { value: 'candidates', label: '要調査', description: '再確認が必要な理由がある作品のみ表示' },
  { value: 'all', label: '全作品', description: 'VOD調査対象の全作品を表示（一度に送るわけではありません）' },
];

const SORT_OPTIONS: Array<{ value: RecheckSortOption; label: string }> = [
  { value: 'priority', label: '調査優先順' },
  { value: 'unchecked_first', label: '未調査優先' },
  { value: 'oldest_checked', label: '最終調査が古い順' },
  { value: 'newest_checked', label: '最終調査が新しい順' },
  { value: 'recently_added', label: '最近追加された作品順' },
];

const BULK_STEPS = [5, 10, 15, 20, 25, 30, 35, 40] as const;

const REASON_OPTIONS: Array<{ value: RecheckReasonCode; label: string }> = [
  { value: 'stale_180_days', label: '180日以上未確認' },
  { value: 'never_checked', label: '確認日なし' },
  { value: 'unknown_only', label: 'unknownのみ' },
  { value: 'no_active_provider', label: '有効VODなし' },
  { value: 'high_traffic', label: 'アクセス上位' },
  { value: 'deprecated_provider', label: '終了済みサービス候補' },
  { value: 'post_merge_unchecked', label: '統合後未確認' },
  { value: 'missing_source', label: 'sourceUrlなし' },
  { value: 'low_confidence', label: 'confidenceが低い' },
  { value: 'inconsistent_checked_at', label: '確認日時がVODごとに不一致' },
];

const PRIORITY_OPTIONS: Array<{ value: RecheckPriority; label: string; cls: string }> = [
  { value: 'critical', label: '最優先', cls: 'bg-red-100 text-red-700' },
  { value: 'high', label: '高', cls: 'bg-orange-100 text-orange-700' },
  { value: 'medium', label: '中', cls: 'bg-yellow-100 text-yellow-700' },
  { value: 'low', label: '低', cls: 'bg-gray-100 text-gray-600' },
];

const PRIORITY_CLS: Record<RecheckPriority, string> = Object.fromEntries(
  PRIORITY_OPTIONS.map((p) => [p.value, p.cls]),
) as Record<RecheckPriority, string>;

// D-1: 確認からの経過日数による分類（既存のPRIORITY_OPTIONS等と同じ「色＋テキスト」表示規約に合わせる）
const STALE_STATUS_CLS: Record<VodStaleStatus, string> = {
  fresh: 'bg-green-100 text-green-700',
  aging: 'bg-yellow-100 text-yellow-700',
  stale: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-500',
};

const ACTION_OPTIONS: Array<{ value: RecheckAction; label: string }> = [
  { value: 'start', label: '処理開始' },
  { value: 'complete', label: '再確認完了' },
  { value: 'needs_review', label: '要確認' },
  { value: 'skip', label: '今回はスキップ' },
];

const WORK_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'movie', label: '映画' },
  { value: 'tv', label: 'ドラマ' },
  { value: 'variety', label: 'バラエティ' },
  { value: 'anime', label: 'アニメ' },
];

const PROCESS_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'not_started', label: '未処理' },
  { value: 'checking', label: '処理中' },
  { value: 'needs_recheck', label: '要確認' },
  { value: 'checked', label: '完了' },
  { value: 'failed', label: '失敗' },
  { value: 'skipped', label: 'スキップ' },
];

// ChatGPT完全調査プロンプトへ一度に含められる作品数の上限（対象14サービス完全調査を前提とした運用上限）
const MAX_BULK_ITEMS = 40;

function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function rowKey(item: Pick<RecheckListItem, 'personName' | 'workId'>): string {
  return `${item.personName}::${item.workId}`;
}

export default function VodRecheckClient({ initial }: { initial: RecheckListResult }) {
  const [data, setData] = useState<RecheckListResult>(initial);
  const [page, setPage] = useState(initial.page);
  const [mode, setMode] = useState<RecheckListMode>('candidates');
  const [sortBy, setSortBy] = useState<RecheckSortOption>('priority');
  const [chatgptStaleDays, setChatgptStaleDays] = useState<typeof CHATGPT_STALE_DAY_OPTIONS[number] | ''>('');
  const [search, setSearch] = useState('');
  const [workIdSearch, setWorkIdSearch] = useState('');
  const [reason, setReason] = useState<RecheckReasonCode | ''>('');
  const [priority, setPriority] = useState<RecheckPriority | ''>('');
  const [workType, setWorkType] = useState('');
  const [processStatus, setProcessStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 選択状態はkeyだけでなく作品オブジェクト本体を保持する（Map）。
  // 「次のN件」で選択される作品は現在テーブルに表示中のページ外（data.items外）にも
  // なりうるため、Set<string>だけでは選択後にCSV出力・プロンプト生成等が対象作品の
  // 詳細情報を参照できなくなる。Map.has()/Map.sizeはSetと同じAPIのため、
  // 表示側（selected.size・selected.has(key)）のコードは変更不要。
  const [selected, setSelected] = useState<Map<string, RecheckListItem>>(new Map());
  const [note, setNote] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [researchPrompt, setResearchPrompt] = useState<string | null>(null);
  const [researchWorkCount, setResearchWorkCount] = useState(0);
  const [researchBusy, setResearchBusy] = useState(false);
  const [researchError, setResearchError] = useState('');
  // 直前に生成したChatGPT調査プロンプトの対象workId（同一セッション内のみ保持。
  // ブラウザ再読み込み等で失われてもCSVインポート自体は引き続き可能）
  const [lastPromptWorkIds, setLastPromptWorkIds] = useState<string[] | null>(null);
  // 「次のN件」バッチ選択のカーソル位置（現在のフィルター＋並び順の中で、
  // 直前までにバッチとして扱った作品数）。フィルター・並び順変更時に0へリセットする。
  const [batchCursor, setBatchCursor] = useState(0);
  const [nextBatchBusy, setNextBatchBusy] = useState(false);
  const [nextBatchMessage, setNextBatchMessage] = useState('');
  const [importMode, setImportMode] = useState<VodRecheckCsvImportMode>('chatgpt_full_sync');
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState<CsvPreviewResponse | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvFileError, setCsvFileError] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [selectedFileSize, setSelectedFileSize] = useState<number | null>(null);
  const [csvRowCount, setCsvRowCount] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isFirstRun = useRef(true);
  const csvSubmitLockRef = useRef(false); // 二重送信防止（state更新の非同期性に依存しない同期ガード）
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('mode', mode);
      params.set('sortBy', sortBy);
      if (chatgptStaleDays) params.set('chatgptStaleDays', String(chatgptStaleDays));
      if (search.trim()) params.set('search', search.trim());
      if (workIdSearch.trim()) params.set('workId', workIdSearch.trim());
      if (reason) params.set('reason', reason);
      if (priority) params.set('priority', priority);
      if (workType) params.set('workType', workType);
      if (processStatus) params.set('processStatus', processStatus);

      const res = await fetch(`/api/admin/vod-recheck/candidates?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '取得に失敗しました');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, mode, sortBy, chatgptStaleDays, search, workIdSearch, reason, priority, workType, processStatus]);

  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // フィルタ・モード・並び替え変更時は1ページ目に戻して再取得し、
  // 「次のN件」バッチカーソルも先頭へリセットする（新しい絞り込み結果の先頭から
  // 選択し直せるようにするため。ケース7）。
  useEffect(() => {
    if (isFirstRun.current) return;
    setBatchCursor(0);
    setNextBatchMessage('');
    if (page !== 1) { setPage(1); return; }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sortBy, chatgptStaleDays, search, workIdSearch, reason, priority, workType, processStatus]);

  function toggleSelect(item: RecheckListItem) {
    const key = rowKey(item);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_BULK_ITEMS) next.set(key, item);
      return next;
    });
  }

  function selectedItems(): RecheckListItem[] {
    return [...selected.values()];
  }

  // 一括選択の増減ロジックは src/lib/vod-recheck-selection.ts の純粋関数（Set<string>ベース）を
  // 使う（ブラウザ実地確認ができない環境でもユニットテストで検証できるようにするため）。
  // selected自体はMap<string, RecheckListItem>のため、鍵集合だけを取り出して既存の
  // 純粋関数へ渡し、結果の鍵集合をもとにMapへ反映し直す。
  const currentRowKeys = data.items.map((item) => ({ key: rowKey(item) }));

  function addN(n: number) {
    setSelected((prev) => {
      const prevKeys = new Set(prev.keys());
      const nextKeys = addSelection(prevKeys, currentRowKeys, n, MAX_BULK_ITEMS);
      const next = new Map(prev);
      for (const item of data.items) {
        const key = rowKey(item);
        if (nextKeys.has(key) && !next.has(key)) next.set(key, item);
      }
      return next;
    });
  }

  function removeN(n: number) {
    setSelected((prev) => {
      const prevKeys = new Set(prev.keys());
      const nextKeys = removeSelection(prevKeys, currentRowKeys, n);
      const next = new Map(prev);
      for (const key of prev.keys()) {
        if (!nextKeys.has(key)) next.delete(key);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Map());
  }

  // ── 「次のN件」バッチ選択 ────────────────────────────────────────────────
  // 現在のフィルター＋並び順に対して、直前までに「バッチ」として扱った位置（batchCursor）
  // より後ろからN件を選び、選択を追加ではなく置き換える。同じ作品へ毎回戻らないよう、
  // カーソルは常に前進のみ（フィルター変更時のみ0へリセットする）。
  //
  // 1回のfetchでMAX_BULK_ITEMS（40）件分先読みし、そのうち先頭N件だけをバッチとして
  // 選択・カーソル前進に使う。残り（N+1件目〜40件目）はdata.itemsとしてテーブルにも
  // 表示し、直後に+Nを押した場合に「そのバッチへさらに追加」できるようにする
  // （+N自体はdata.itemsの中から未選択分を追加する既存ロジックのまま）。
  function buildFilterParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set('mode', mode);
    params.set('sortBy', sortBy);
    if (chatgptStaleDays) params.set('chatgptStaleDays', String(chatgptStaleDays));
    if (search.trim()) params.set('search', search.trim());
    if (workIdSearch.trim()) params.set('workId', workIdSearch.trim());
    if (reason) params.set('reason', reason);
    if (priority) params.set('priority', priority);
    if (workType) params.set('workType', workType);
    if (processStatus) params.set('processStatus', processStatus);
    return params;
  }

  async function nextBatch(n: number) {
    if (nextBatchBusy) return;
    setNextBatchBusy(true);
    setNextBatchMessage('');
    try {
      const params = buildFilterParams();
      params.set('offset', String(batchCursor));
      params.set('pageSize', String(MAX_BULK_ITEMS));
      const res = await fetch(`/api/admin/vod-recheck/candidates?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '取得に失敗しました');
      const fetched: RecheckListItem[] = json.items ?? [];
      const result = computeNextBatch(fetched, n);
      if (result.isEnd) {
        setNextBatchMessage('次の作品はありません（一覧の末尾に到達しました）');
        return;
      }
      const next = new Map<string, RecheckListItem>();
      for (const item of result.batchItems) next.set(rowKey(item), item);
      setSelected(next);
      setBatchCursor((c) => c + result.advancedBy);
      // テーブル表示もこのバッチ位置の一覧へ更新する（+Nでの追加対象と一致させるため）。
      // 通常のページネーション状態（page）はここでは変更しない。
      setData(json);
      if (result.isPartial) {
        setNextBatchMessage(`残り${result.batchItems.length}件のみ選択しました（一覧の末尾に到達）`);
      }
    } catch (err) {
      setNextBatchMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setNextBatchBusy(false);
    }
  }

  function resetBatchCursor() {
    setBatchCursor(0);
    setNextBatchMessage('');
  }

  async function runAction(action: RecheckAction, items: RecheckListItem[]) {
    if (items.length === 0) return;
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/vod-recheck/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ personName: i.personName, workId: i.workId })),
          action,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '操作に失敗しました');
      setActionMsg(`${json.processed}件を更新しました${json.failed > 0 ? `（失敗${json.failed}件）` : ''}`);
      setSelected(new Map());
      setNote('');
      fetchData();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function exportCsv() {
    const items = selectedItems();
    if (items.length === 0) return;
    const res = await fetch('/api/admin/vod-recheck/csv-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.map((i) => ({ personName: i.personName, workId: i.workId })) }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setActionMsg(json.error ?? 'CSV出力に失敗しました');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vod-recheck_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 選択した作品から、ChatGPTへ配信状況調査を依頼するプロンプト全文を生成する。
  // データ解決・プロンプトのテンプレートは /admin/work-check の調査プロンプト生成と共通
  // （src/lib/vod-research-prompt.ts・src/lib/vod-recheck-export-data.ts）を使う。
  async function generateResearchPrompt() {
    const items = selectedItems();
    if (items.length === 0) return;
    setResearchBusy(true);
    setResearchError('');
    setResearchPrompt(null);
    try {
      const res = await fetch('/api/admin/vod-recheck/research-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((i) => ({ personName: i.personName, workId: i.workId })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'プロンプト生成に失敗しました');
      setResearchPrompt(json.prompt);
      setResearchWorkCount(json.workCount);
      // プロンプトを生成・コピーしただけでは調査済みにしない（DB書き込みなし）。
      // ここではCSVインポート時の「結果が足りない作品」警告のためworkId一覧を覚えておくだけ。
      setLastPromptWorkIds(Array.isArray(json.workIds) ? json.workIds : null);
    } catch (err) {
      setResearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setResearchBusy(false);
    }
  }

  // CSVテキスト（ファイル読み込み・貼り付け共通）が変わったら、行数表示を更新し、
  // 既存のプレビュー結果を無効化する（古いプレビューのまま反映されるのを防ぐ）。
  function applyCsvText(text: string) {
    setCsvText(text);
    setCsvPreview(null);
    setCsvFileError('');
    if (text.trim()) {
      try {
        const table = parseCSV(text);
        setCsvRowCount(Math.max(0, table.length - 1)); // ヘッダー行を除いた行数
      } catch {
        setCsvRowCount(null);
      }
    } else {
      setCsvRowCount(null);
    }
  }

  function handleFileSelected(file: File) {
    const validation = validateCsvFile({ name: file.name, size: file.size });
    if (!validation.ok) {
      setCsvFileError(validation.error);
      setSelectedFileName('');
      setSelectedFileSize(null);
      return;
    }
    setSelectedFileName(file.name);
    setSelectedFileSize(file.size);
    setCsvFileError('');

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      applyCsvText(text);
    };
    reader.onerror = () => {
      setCsvFileError('ファイルの読み込みに失敗しました。');
    };
    // ファイルはブラウザ内でテキストとして読み取るのみ。サーバーへアップロード保存はしない。
    reader.readAsText(file, 'utf-8');
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelected(file);
    e.target.value = ''; // 同じファイルを選び直しても onChange が発火するようにリセット
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  }

  function clearFile() {
    setSelectedFileName('');
    setSelectedFileSize(null);
    setCsvRowCount(null);
    setCsvFileError('');
    setCsvText('');
    setCsvPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function previewCsvImport() {
    if (csvSubmitLockRef.current) return;
    csvSubmitLockRef.current = true;
    setCsvBusy(true);
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/vod-recheck/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csvText,
          commit: false,
          mode: importMode,
          expectedWorkIds: importMode === 'chatgpt_full_sync' && lastPromptWorkIds ? lastPromptWorkIds : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? (json.details ? json.details.join(' / ') : 'CSVの解析に失敗しました'));
      setCsvPreview(json);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCsvBusy(false);
      csvSubmitLockRef.current = false;
    }
  }

  async function commitCsvImport() {
    if (csvSubmitLockRef.current) return;
    if (!csvPreview || csvPreview.hasFatalErrors) return; // 致命的エラーがある場合は反映しない（念のための二重ガード）
    csvSubmitLockRef.current = true;
    setCsvBusy(true);
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/vod-recheck/csv-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csvText,
          commit: true,
          mode: importMode,
          expectedWorkIds: importMode === 'chatgpt_full_sync' && lastPromptWorkIds ? lastPromptWorkIds : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'CSVの反映に失敗しました');
      const failedNote = Array.isArray(json.failedWorkIds) && json.failedWorkIds.length > 0
        ? `（失敗: ${json.failedWorkIds.join(', ')} は調査済みにしていません）`
        : '';
      setActionMsg(`${json.updatedWorks}件のVOD情報を反映しました。同じCSVを再度反映しないようご注意ください。${failedNote}`);
      // 成功後は状態をリセット（同じCSVを誤って再反映することを防ぐ）
      clearFile();
      // 「未調査」フィルター等を使用している場合、今回調査済みになった作品は次回取得時に
      // 自動的に一覧から外れる（別データ保存等はしていない・既存のfetchDataをそのまま再利用）
      fetchData();
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCsvBusy(false);
      csvSubmitLockRef.current = false;
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="space-y-4">
      {/* モード切り替え */}
      <div className="flex flex-wrap gap-2 items-center bg-white border border-gray-200 rounded-xl p-3">
        <span className="text-xs font-semibold text-slate-600">表示モード:</span>
        <div className="flex rounded-lg overflow-hidden border border-gray-300">
          {MODE_OPTIONS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              title={m.description}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === m.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-gray-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-400">{MODE_OPTIONS.find((m) => m.value === mode)?.description}</span>
        <span className="text-xs font-semibold text-slate-600 ml-4">並び替え:</span>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as RecheckSortOption)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="text-xs font-semibold text-slate-600 ml-4">ChatGPT再調査フィルター:</span>
        <select
          value={chatgptStaleDays}
          onChange={(e) => setChatgptStaleDays(e.target.value ? (Number(e.target.value) as typeof CHATGPT_STALE_DAY_OPTIONS[number]) : '')}
          title="ChatGPT完全調査からの経過日数で絞り込みます（未調査の作品は含まれません）"
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
        >
          <option value="">指定なし</option>
          {CHATGPT_STALE_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}日以上経過</option>)}
        </select>
      </div>

      {/* ChatGPT完全調査 進捗 */}
      <div className="flex flex-wrap items-center gap-3 bg-white border border-gray-200 rounded-xl p-3 text-xs">
        <span className="font-semibold text-slate-600">ChatGPT完全調査 進捗：</span>
        <span>
          {data.chatgptProgress.researched.toLocaleString()} / {data.chatgptProgress.total.toLocaleString()}件
          （{data.chatgptProgress.total > 0 ? Math.round((data.chatgptProgress.researched / data.chatgptProgress.total) * 1000) / 10 : 0}%）
        </span>
        <div className="flex-1 min-w-[120px] max-w-xs h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500"
            style={{ width: `${data.chatgptProgress.total > 0 ? Math.min(100, (data.chatgptProgress.researched / data.chatgptProgress.total) * 100) : 0}%` }}
          />
        </div>
        <span className="text-gray-400">完全同期結果は同期後{CHATGPT_PROTECTION_DAYS}日間、TMDb/AI自動更新による対象14サービスへの追加・上書きから保護されます</span>
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap gap-2 items-center bg-white border border-gray-200 rounded-xl p-3">
        <input
          type="text"
          placeholder="タイトル検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40"
        />
        <input
          type="text"
          placeholder="workId検索"
          value={workIdSearch}
          onChange={(e) => setWorkIdSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-40"
        />
        <select value={reason} onChange={(e) => setReason(e.target.value as RecheckReasonCode | '')} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">理由: すべて</option>
          {REASON_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as RecheckPriority | '')} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">優先度: すべて</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <select value={workType} onChange={(e) => setWorkType(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">作品種別: すべて</option>
          {WORK_TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={processStatus} onChange={(e) => setProcessStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
          <option value="">処理状態: すべて</option>
          {PROCESS_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">
          {loading ? '読み込み中…' : `全${data.total.toLocaleString()}件`}
        </span>
      </div>

      {!data.clickCountsAvailable && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-3 py-2">
          Redisからアクセス数を取得できませんでした。アクセス数列は「不明」として表示しています（0件と確認できたわけではありません）。
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
      {actionMsg && <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg px-3 py-2">{actionMsg}</div>}

      {/* 一括選択（現在のフィルター＋並び順に対して動作） */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
        <span className="text-xs font-semibold text-slate-700">選択中：{selected.size}作品（最大40作品）</span>
        <div className="flex flex-wrap gap-1">
          {BULK_STEPS.map((n) => (
            <button
              key={`add-${n}`}
              type="button"
              onClick={() => addN(n)}
              disabled={selected.size >= MAX_BULK_ITEMS}
              title="現在の一覧の上から、まだ選択されていない作品を追加します"
              className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
            >
              +{n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {BULK_STEPS.map((n) => (
            <button
              key={`remove-${n}`}
              type="button"
              onClick={() => removeN(n)}
              disabled={selected.size === 0}
              title="現在の一覧順で後ろにある選択済み作品から解除します"
              className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
            >
              -{n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={clearSelection}
          disabled={selected.size === 0}
          className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors"
        >
          全解除
        </button>
        <span className="text-[11px] text-gray-400">ChatGPTプロンプトには最大40作品まで含められます（10〜20作品程度が扱いやすい目安です）</span>
      </div>

      {/* 次のN件（バッチ入れ替え・現在の選択を置き換えて未処理分へ進む） */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl p-3">
        <span className="text-xs font-semibold text-slate-700">
          次のバッチへ進む：<span className="text-gray-400 font-normal">（{batchCursor}件目まで処理済み）</span>
        </span>
        <div className="flex flex-wrap gap-1">
          {BULK_STEPS.map((n) => (
            <button
              key={`next-${n}`}
              type="button"
              onClick={() => nextBatch(n)}
              disabled={nextBatchBusy}
              title="現在の選択を解除し、直前のバッチより後ろの未処理分からN件を新たに選択します（追加ではなく置き換え）"
              className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 disabled:opacity-40 transition-colors"
            >
              次の{n}件
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={resetBatchCursor}
          disabled={nextBatchBusy || batchCursor === 0}
          title="バッチ位置を先頭へ戻します（選択自体は解除されません）"
          className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 transition-colors"
        >
          先頭から
        </button>
        {nextBatchBusy && <span className="text-[11px] text-gray-400">取得中...</span>}
        {nextBatchMessage && <span className="text-[11px] text-amber-600">{nextBatchMessage}</span>}
      </div>

      {/* 一括操作バー */}
      <div className="flex flex-wrap items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
        <span className="text-xs text-indigo-700 font-semibold">選択中: {selected.size}件（最大{MAX_BULK_ITEMS}件）</span>
        <input
          type="text"
          placeholder="管理メモ（任意）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]"
        />
        {ACTION_OPTIONS.map((a) => (
          <button
            key={a.value}
            type="button"
            disabled={selected.size === 0}
            onClick={() => runAction(a.value, selectedItems())}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          disabled={selected.size === 0 || !note.trim()}
          onClick={() => runAction('note', selectedItems())}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          メモのみ保存
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={exportCsv}
          title="チェックボックスで選択した作品のみをCSV出力します（絞り込み結果全体ではありません）"
          className={
            selected.size === 0
              ? 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 text-gray-400 cursor-not-allowed'
              : 'px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors'
          }
        >
          選択した作品をCSV出力（{selected.size}件）
        </button>
        <button
          type="button"
          disabled={selected.size === 0 || selected.size > MAX_BULK_ITEMS || researchBusy}
          onClick={generateResearchPrompt}
          title="選択した作品からChatGPTへ配信状況調査を依頼するプロンプトを生成します"
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40"
        >
          {researchBusy ? '生成中...' : `ChatGPT調査用プロンプトを生成（${selected.size}件）`}
        </button>
      </div>

      {researchError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{researchError}</div>}
      {researchPrompt && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <h2 className="text-sm font-bold text-slate-700">ChatGPT調査用プロンプト</h2>
          <ChatGptPromptResultPanel
            prompt={researchPrompt}
            workCount={researchWorkCount}
            filename={`vod-recheck_ChatGPT調査プロンプト_${new Date().toISOString().slice(0, 10)}.txt`}
            onChangePrompt={setResearchPrompt}
          />
        </div>
      )}

      {/* 一覧テーブル */}
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="p-2"></th>
              <th className="p-2 text-left">workId</th>
              <th className="p-2 text-left">タイトル</th>
              <th className="p-2">種別</th>
              <th className="p-2">公開年</th>
              <th className="p-2">出演者数</th>
              <th className="p-2">現在のVOD</th>
              <th className="p-2">unknown</th>
              <th className="p-2">最終確認日</th>
              <th className="p-2">経過日数</th>
              <th className="p-2">鮮度</th>
              <th className="p-2">アクセス数</th>
              <th className="p-2 text-left">再確認理由</th>
              <th className="p-2">優先度</th>
              <th className="p-2">処理状態</th>
              <th className="p-2">ChatGPT調査</th>
              <th className="p-2">リンク</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => {
              const key = rowKey(item);
              return (
                <tr key={key} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-2 text-center">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(item)} />
                  </td>
                  <td className="p-2 font-mono text-[10px] max-w-[140px] truncate" title={item.workId}>{item.workId}</td>
                  <td className="p-2 max-w-[180px] truncate" title={item.title}>
                    {item.title}
                    {item.hasSameTitleWork && (
                      <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[9px] font-semibold whitespace-nowrap" title="同じタイトルの別workIdが存在します。CSVインポート時はworkId基準で処理されるため誤紐付けの心配はありませんが、ChatGPTへの調査依頼時は結果を確認してください。">
                        同名作品あり
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">{item.workTypeLabel}</td>
                  <td className="p-2 text-center">{item.releaseYear ?? '—'}</td>
                  <td className="p-2 text-center">{item.personCount}</td>
                  <td className="p-2 text-center">{item.activeCount}</td>
                  <td className="p-2 text-center">{item.unknownCount}</td>
                  <td className="p-2 text-center whitespace-nowrap">{fmtDate(item.lastCheckedAt)}</td>
                  <td className="p-2 text-center">{item.daysSinceLastCheck ?? '—'}</td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${STALE_STATUS_CLS[item.staleStatus]}`}>
                      {item.staleStatusLabel}
                    </span>
                  </td>
                  <td className="p-2 text-center">
                    {item.clickCount === null
                      ? <span className="text-gray-400" title="Redisからアクセス数を取得できませんでした">不明</span>
                      : item.clickCount}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {item.reasonLabels.map((label, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">{label}</span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${PRIORITY_CLS[item.priority]}`}>
                      {item.priorityLabel}
                    </span>
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">{item.processStatusLabel}</td>
                  <td className="p-2 text-center whitespace-nowrap">
                    {item.lastChatgptResearchAt
                      ? <span title={`結果${item.chatgptResultCount ?? 0}件`}>{fmtDate(item.lastChatgptResearchAt)}（{item.chatgptResultCount ?? 0}件）</span>
                      : <span className="text-gray-400">未調査</span>}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {item.workUrl && (
                      <Link href={item.workUrl} target="_blank" className="text-indigo-600 hover:underline mr-2">作品</Link>
                    )}
                    <Link href={item.adminUrl} target="_blank" className="text-indigo-600 hover:underline">管理</Link>
                  </td>
                </tr>
              );
            })}
            {data.items.length === 0 && !loading && (
              <tr><td colSpan={16} className="p-6 text-center text-gray-400">該当する作品はありません</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ページング */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{(data.page - 1) * data.pageSize + 1}〜{Math.min(data.page * data.pageSize, data.total)}件 / 全{data.total.toLocaleString()}件（{data.page} / {totalPages}ページ）</span>
        <div className="flex gap-1">
          <button type="button" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
            ← 前へ
          </button>
          <button type="button" disabled={data.page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors">
            次へ →
          </button>
        </div>
      </div>

      {/* CSVインポート */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-700">調査結果CSVの取り込み</h2>

        {/* インポート方式 */}
        <div className="flex flex-wrap items-center gap-4 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <span className="text-xs font-semibold text-slate-600">インポート方式:</span>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="radio"
              checked={importMode === 'merge'}
              onChange={() => { setImportMode('merge'); setCsvPreview(null); }}
            />
            追加・更新（CSVにあるサービスのみ追加・更新。ないものは削除しません）
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="radio"
              checked={importMode === 'chatgpt_full_sync'}
              onChange={() => { setImportMode('chatgpt_full_sync'); setCsvPreview(null); }}
            />
            ChatGPT完全同期（対象14サービスをCSVの内容で完全に置き換えます。14サービス以外は変更しません）
          </label>
        </div>

        <p className="text-xs text-gray-500">
          必須列: workId, vodService（1作品1サービス1行）。任意列: availabilityType（flatrate/rent/buy/free/unknown）, sourceUrl, confidence, note
        </p>
        <p className="text-xs text-slate-600 font-medium">
          CSVファイルを選択するか、下の入力欄へCSVを貼り付けてください
        </p>

        {importMode === 'chatgpt_full_sync' && lastPromptWorkIds === null && (
          <p className="text-xs text-gray-400">
            （このブラウザセッション内でChatGPT調査用プロンプトを生成していないため、CSVがプロンプト対象を全てカバーしているかの照合は行われません。インポート自体は可能です）
          </p>
        )}

        {/* ファイル選択・ドラッグ＆ドロップ領域 */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors ${
            isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-gray-50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileInputChange}
            className="hidden"
            id="csv-file-input"
          />
          <label
            htmlFor="csv-file-input"
            className="inline-block px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
          >
            CSVファイルを選択
          </label>
          <p className="text-xs text-gray-400 mt-2">またはここにCSVファイルをドラッグ＆ドロップ</p>

          {selectedFileName && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-700 bg-white border border-gray-200 rounded-lg px-3 py-2 inline-flex">
              <span className="font-mono">{selectedFileName}</span>
              <span className="text-gray-400">
                {selectedFileSize !== null ? formatFileSize(selectedFileSize) : ''}
                {csvRowCount !== null ? ` / ${csvRowCount.toLocaleString()}行` : ''}
              </span>
              <button type="button" onClick={clearFile} className="text-red-500 hover:underline">解除</button>
            </div>
          )}
          {csvFileError && <p className="text-xs text-red-600 mt-2">{csvFileError}</p>}
        </div>

        <textarea
          value={csvText}
          onChange={(e) => applyCsvText(e.target.value)}
          rows={6}
          placeholder="workId,vodService,availabilityType,sourceUrl,confidence,note"
          className="w-full border border-gray-300 rounded-lg p-2 text-xs font-mono"
        />

        <div className="flex gap-2">
          <button
            type="button"
            disabled={csvBusy || !csvText.trim()}
            onClick={previewCsvImport}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
          >
            プレビュー
          </button>
          <button
            type="button"
            disabled={csvBusy || !csvPreview || csvPreview.hasFatalErrors}
            onClick={commitCsvImport}
            title={csvPreview?.hasFatalErrors ? '致命的エラーがあるため反映できません。CSVを修正して再プレビューしてください。' : undefined}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {importMode === 'chatgpt_full_sync' ? 'この内容で完全同期' : '反映する'}
          </button>
        </div>
        {importMode === 'chatgpt_full_sync' && csvPreview && !csvPreview.hasFatalErrors && (csvPreview.summary?.removed ?? 0) > 0 && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ この操作には削除（{csvPreview.summary?.removed}件）が含まれます。「この内容で完全同期」を押すと、CSVに含まれない対象14サービスの登録は削除されます。内容を確認してから実行してください。
          </p>
        )}

        {csvPreview && (
          <div className="text-xs text-gray-600 space-y-2">
            <div className="bg-gray-50 rounded-lg p-2">
              対象作品: {csvPreview.totalWorkIds}件 / 行数: {csvPreview.totalRows}件
              {csvPreview.unresolvedWorkIds.length > 0 && (
                <p className="text-red-600 mt-1">未解決のworkId（公開作品として見つかりません）: {csvPreview.unresolvedWorkIds.join(', ')}</p>
              )}
              {csvPreview.hasFatalErrors && (
                <p className="text-red-600 mt-1 font-semibold">
                  致命的エラーがあるため「{importMode === 'chatgpt_full_sync' ? 'この内容で完全同期' : '反映する'}」は無効化されています。
                </p>
              )}
              {csvPreview.missingFromLastPrompt && csvPreview.missingFromLastPrompt.length > 0 && (
                <p className="text-amber-600 mt-1 font-semibold">
                  {csvPreview.missingFromLastPrompt.length}作品分の結果がありません（直前に生成したプロンプトに含まれていましたが、このCSVには含まれていません）:
                  {' '}{csvPreview.missingFromLastPrompt.join(', ')}
                </p>
              )}
            </div>

            {importMode === 'chatgpt_full_sync' && csvPreview.summary && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {[
                  { label: '対象作品', value: csvPreview.totalWorkIds, cls: 'bg-slate-50 text-slate-700' },
                  { label: '追加', value: csvPreview.summary.added, cls: 'bg-green-50 text-green-700' },
                  { label: '更新', value: csvPreview.summary.updated, cls: 'bg-yellow-50 text-yellow-700' },
                  { label: '削除', value: csvPreview.summary.removed, cls: 'bg-red-50 text-red-700' },
                  { label: '変更なし', value: csvPreview.summary.unchanged, cls: 'bg-gray-50 text-gray-600' },
                  { label: 'VODなし', value: csvPreview.summary.zeroVod, cls: 'bg-gray-50 text-gray-500' },
                ].map((s) => (
                  <div key={s.label} className={`rounded-lg px-2 py-1.5 ${s.cls}`}>
                    <div className="text-sm font-black">{s.value}</div>
                    <div className="text-[10px]">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="p-2 text-left">workId</th>
                    <th className="p-2 text-left">タイトル</th>
                    {importMode === 'chatgpt_full_sync' ? (
                      <th className="p-2 text-left">差分（追加 / 更新 / 削除 / 変更なし）</th>
                    ) : (
                      <th className="p-2 text-left">追加/更新サービス</th>
                    )}
                    <th className="p-2">現在のVOD件数</th>
                    <th className="p-2">{importMode === 'chatgpt_full_sync' ? '同期後のVOD件数' : '反映後のVOD件数'}</th>
                    <th className="p-2 text-left">注意</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreview.preview.map((w) => (
                    <tr key={w.workId} className={`border-t border-gray-100 ${w.ambiguous ? 'bg-amber-50/50' : ''}`}>
                      <td className="p-2 font-mono max-w-[160px] truncate" title={w.workId}>
                        {w.workId}
                        {w.resolvedFrom && (
                          <div className="text-[10px] text-indigo-600">旧workId「{w.resolvedFrom.join(', ')}」から解決</div>
                        )}
                      </td>
                      <td className="p-2 max-w-[160px] truncate" title={w.title ?? undefined}>{w.title ?? '(取得できず)'}</td>
                      {importMode === 'chatgpt_full_sync' && w.diff ? (
                        <td className="p-2">
                          {w.diff.added.map((s, i) => <span key={`a${i}`} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-green-100 text-green-700 whitespace-nowrap">+ {s}</span>)}
                          {w.diff.updated.map((u, i) => <span key={`u${i}`} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-yellow-100 text-yellow-700 whitespace-nowrap">{u.service}: {u.before}→{u.after}</span>)}
                          {w.diff.removed.map((s, i) => <span key={`r${i}`} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-red-100 text-red-700 whitespace-nowrap">- {s}</span>)}
                          {w.diff.unchanged.map((s, i) => <span key={`n${i}`} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">{s}</span>)}
                          {w.diff.added.length + w.diff.updated.length + w.diff.removed.length + w.diff.unchanged.length === 0 && (
                            <span className="text-gray-400">対象14サービスなし（0件）</span>
                          )}
                        </td>
                      ) : (
                        <td className="p-2">
                          {w.services.map((s, i) => (
                            <span key={i} className="inline-block px-1.5 py-0.5 mr-1 mb-1 rounded-full bg-slate-100 text-slate-600 whitespace-nowrap">
                              {s.providerName}（{s.availabilityType}）
                            </span>
                          ))}
                        </td>
                      )}
                      <td className="p-2 text-center">{w.currentVodCount}</td>
                      <td className="p-2 text-center font-semibold">{w.afterVodCount}</td>
                      <td className="p-2">
                        {w.ambiguous && <p className="text-orange-600 font-semibold">⚠️ 同名作品あり：ChatGPTが対象作品を特定できなかった可能性</p>}
                        {w.warnings.map((msg, i) => <p key={i} className="text-amber-600">{msg}</p>)}
                        {w.errors.map((msg, i) => <p key={i} className="text-red-600">{msg}</p>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
