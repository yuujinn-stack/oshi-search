'use client';

import { useState } from 'react';
import VodRecheckSection from './VodRecheckSection';
import PersonCombobox from '@/components/admin/PersonCombobox';

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
  all:            '全作品',
  auto_published: '公開中のみ',
  needs_review:   '確認待ちのみ',
  hidden:         '非表示のみ',
  no_vod:         '配信情報なし',
  ai_only:        'AI補完VOD作品',
  tmdb_only:      'TMDb VOD取得作品',
};

const STATUS_LABEL: Record<string, string> = {
  auto_published: '公開中',
  needs_review:   '確認待ち',
  hidden:         '非表示',
};
const STATUS_BADGE: Record<string, string> = {
  auto_published: 'bg-green-100 text-green-700',
  needs_review:   'bg-yellow-100 text-yellow-700',
  hidden:         'bg-gray-100 text-gray-500',
};

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

export default function ToolsSection({ persons }: { persons: PersonInfo[] }) {
  // ── エクスポート状態 ──
  const [exportFilter, setExportFilter] = useState<ExportFilter>('all');
  const [exportPersons, setExportPersons] = useState<string[]>([]);
  const [personSelectorOpen, setPersonSelectorOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<ExportPreviewResult | null>(null);
  const [exportPreviewLoading, setExportPreviewLoading] = useState(false);
  const [exportPreviewError, setExportPreviewError] = useState('');
  const [csvText, setCsvText] = useState<string | null>(null);
  const [simpleCsvText, setSimpleCsvText] = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'csv' | 'prompt'>('idle');

  // ── 重複整理状態 ──
  const [dedupPerson, setDedupPerson] = useState('');
  const [deduping, setDeduping] = useState(false);
  const [dedupResult, setDedupResult] = useState<{
    checkedWorks: number;
    deduplicatedWorks: number;
    removedCount: number;
  } | null>(null);
  const [dedupError, setDedupError] = useState('');

  // グループ別
  const groupedPersons: Record<string, PersonInfo[]> = {};
  for (const p of persons) {
    const key = p.group || '（グループなし）';
    if (!groupedPersons[key]) groupedPersons[key] = [];
    groupedPersons[key].push(p);
  }
  const groupKeys = Object.keys(groupedPersons).sort();

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

  function resetExportPreview() {
    setExportPreview(null);
    setExportPreviewError('');
    setCsvText(null);
    setSimpleCsvText(null);
    setCopyStatus('idle');
  }

  // ─────────────────────────────────────────
  // エクスポートハンドラー
  // ─────────────────────────────────────────

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

  async function handleCsvDownload() {
    if (!exportPreview || exportPreview.count === 0) return;
    try {
      const res = await fetch(buildExportUrl());
      if (!res.ok) { setExportPreviewError('CSV取得に失敗しました'); return; }
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

  async function fetchCsvAsText(): Promise<string | null> {
    if (csvText !== null) return csvText;
    const res = await fetch(buildExportUrl());
    if (!res.ok) return null;
    const text = await res.text();
    setCsvText(text);
    return text;
  }

  async function fetchSimpleCsvAsText(): Promise<string | null> {
    if (simpleCsvText !== null) return simpleCsvText;
    const res = await fetch(buildSimpleExportUrl());
    if (!res.ok) return null;
    const text = await res.text();
    setSimpleCsvText(text);
    return text;
  }

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
    const names = (groupedPersons[groupKey] ?? []).map((p) => p.name);
    const allSelected = names.every((n) => exportPersons.includes(n));
    if (allSelected) {
      setExportPersons((prev) => prev.filter((n) => !names.includes(n)));
    } else {
      setExportPersons((prev) => [...new Set([...prev, ...names])]);
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
  // 重複整理
  // ─────────────────────────────────────────

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

  const personSelectionLabel =
    exportPersons.length === 0 || exportPersons.length === persons.length
      ? '全人物'
      : `${exportPersons.length}人選択中`;

  // ─────────────────────────────────────────
  // レンダリング
  // ─────────────────────────────────────────

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-5">
      <h2 className="text-sm font-bold text-slate-700">補助ツール</h2>

      {/* ════════════════════════════════
          作品データ CSV出力
      ════════════════════════════════ */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-slate-600">作品データ CSV出力</p>
        <p className="text-[11px] text-gray-400">
          プレビューで対象件数を確認してからCSVをダウンロードしてください。
        </p>

        {/* フィルター選択 */}
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

        {/* 対象人物 複数選択（折りたたみ式） */}
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

              <div className="max-h-56 overflow-y-auto px-3 py-2 space-y-3">
                {groupKeys.map((groupKey) => {
                  const groupPersons = groupedPersons[groupKey] ?? [];
                  const selectedInGroup = groupPersons.filter((p) => exportPersons.includes(p.name)).length;
                  const allInGroupSelected = selectedInGroup === groupPersons.length;
                  const someInGroupSelected = selectedInGroup > 0 && !allInGroupSelected;

                  return (
                    <div key={groupKey}>
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
                            <span className="text-white text-[8px] leading-none">
                              {allInGroupSelected ? '✓' : '−'}
                            </span>
                          )}
                        </span>
                        {groupKey}
                        <span className="text-gray-400 font-normal">（{groupPersons.length}人）</span>
                      </button>

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
                    <span className="ml-2 text-xs text-slate-500">{exportPreview.count}件</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleCsvDownload}
                      className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-bold"
                    >
                      📄 補完CSVダウンロード
                    </button>
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
          VOD重複整理
      ════════════════════════════════ */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-600">配信情報の重複を整理</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            同じ配信サービスが複数ソース（TMDb・AI・CSV）に存在する場合、優先度の高いソースを1件残して重複を削除します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <PersonCombobox
            persons={persons}
            value={dedupPerson}
            onChange={(name) => { setDedupPerson(name); setDedupResult(null); setDedupError(''); }}
            allowEmpty
            emptyLabel="全人物"
            placeholder="人物名・グループ名で検索..."
            className="w-48"
          />
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

      <hr className="border-gray-100" />

      {/* ════════════════════════════════
          配信再確認対象一覧
      ════════════════════════════════ */}
      <VodRecheckSection />
    </div>
  );
}
