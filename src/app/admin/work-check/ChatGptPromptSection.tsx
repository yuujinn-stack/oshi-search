'use client';

import { useEffect, useMemo, useState } from 'react';
import type { WorkRecord } from '@/types/work';
import type { PersonWithCounts } from './work-check-types';
import { csvDownloadSection } from '@/lib/chatGptPromptUtil';
import SearchablePersonSelect from './SearchablePersonSelect';

interface WorkPreview {
  title: string;
  releaseYear: number | null;
}

// ─────────────────────────────────────────
// 一括配信調査のフィルタ定義
// ─────────────────────────────────────────

const BATCH_FILTERS = [
  { value: 'no_vod',         label: '① 配信情報なし作品のみ' },
  { value: 'no_tmdb',        label: '② tmdbIdなし作品のみ' },
  { value: 'has_unknown',    label: '③ vodService=unknown を含む作品' },
  { value: 'manual_csv',     label: '④ manual_csv作品のみ' },
  { value: 'ai_supplement',  label: '⑤ ai_supplement作品のみ' },
  { value: 'all',            label: '⑥ 選択中人物の全作品' },
  { value: 'selected_works', label: '⑦ 選択作品のみ' },
] as const;

type BatchFilter = typeof BATCH_FILTERS[number]['value'];

function applyBatchFilter(works: WorkRecord[], filter: BatchFilter): WorkRecord[] {
  switch (filter) {
    case 'no_vod':
      return works.filter((w) => {
        const real = (w.vodProviders ?? []).filter((p) => p.providerName !== '配信確認できず');
        return real.length === 0;
      });
    case 'no_tmdb':
      return works.filter((w) => !w.tmdbId);
    case 'has_unknown':
      return works.filter((w) =>
        (w.vodProviders ?? []).some((p) => p.type === 'unknown' || p.providerName === '配信確認できず'),
      );
    case 'manual_csv':
      return works.filter((w) => w.source === 'manual_csv');
    case 'ai_supplement':
      return works.filter((w) => w.source === 'ai_supplement');
    case 'selected_works':
      return [];
    case 'all':
    default:
      return works;
  }
}

function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function workToBatchRow(w: WorkRecord): string {
  const currentVod = (w.vodProviders ?? [])
    .filter((p) => p.providerName !== '配信確認できず')
    .map((p) => p.providerName)
    .join('/') || 'なし';
  return [
    csvEscape(w.id),
    csvEscape(w.personName),
    csvEscape(w.title),
    csvEscape(w.type),
    csvEscape(String(w.releaseYear ?? '')),
    csvEscape(w.roleName ?? ''),
    csvEscape(currentVod),
  ].join(',');
}

// ─────────────────────────────────────────
// ⑦ 選択作品モード用のヘルパー
// ─────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  tmdb:              'TMDb',
  manual_csv:        'manual_csv',
  ai_supplement:     'AI補完',
  openai_suggestion: 'AI提案',
  manual:            '手動',
};

const TYPE_LABEL: Record<string, string> = {
  movie:   '映画',
  tv:      'ドラマ',
  variety: 'バラエティ',
  anime:   'アニメ',
};

function getVodSummary(w: WorkRecord): { label: string; cls: string } {
  const providers = w.vodProviders ?? [];
  const real = providers.filter((p) => p.providerName !== '配信確認できず');
  if (real.length === 0) return { label: '配信なし', cls: 'text-gray-400' };
  if (real.some((p) => p.type === 'unknown' || p.providerName === '配信確認できず'))
    return { label: 'unknown含む', cls: 'text-yellow-600' };
  if (real.some((p) => p.type === 'flatrate')) return { label: '見放題あり', cls: 'text-green-600' };
  if (real.some((p) => p.type === 'free'))     return { label: '無料配信', cls: 'text-teal-600' };
  return { label: '配信あり（有料）', cls: 'text-teal-600' };
}

// ─────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────

export default function ChatGptPromptSection({ persons }: { persons: PersonWithCounts[] }) {
  const [selectedPerson, setSelectedPerson] = useState('');

  // ── 作品探しプロンプト（既存） ──
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [workCount, setWorkCount] = useState(0);
  const [error, setError] = useState('');

  // ── 配信再調査（一括）①〜⑥ ──
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('no_vod');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchPrompt, setBatchPrompt] = useState('');
  const [batchCopied, setBatchCopied] = useState(false);
  const [batchWorkCount, setBatchWorkCount] = useState(0);
  const [batchError, setBatchError] = useState('');

  // ── 選択作品のみ ⑦ ──
  const [selectionWorks, setSelectionWorks] = useState<WorkRecord[] | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectedWorkIds, setSelectedWorkIds] = useState<Set<string>>(new Set());
  const [selSearch, setSelSearch] = useState('');
  const [selYear, setSelYear] = useState('');
  const [selType, setSelType] = useState('');
  const [selectionPrompt, setSelectionPrompt] = useState('');
  const [selectionCopied, setSelectionCopied] = useState(false);
  const [selectionError, setSelectionError] = useState('');

  function resetAll() {
    setPrompt(''); setError(''); setWorkCount(0);
    setBatchPrompt(''); setBatchError(''); setBatchWorkCount(0);
    setSelectionWorks(null); setSelectedWorkIds(new Set());
    setSelSearch(''); setSelYear(''); setSelType('');
    setSelectionPrompt(''); setSelectionError('');
  }

  // ⑦ 選択作品モードに切り替わったとき（または人物変更時）に作品一覧を自動取得
  useEffect(() => {
    if (batchFilter !== 'selected_works' || !selectedPerson) return;
    setSelectionWorks(null);
    setSelectedWorkIds(new Set());
    setSelectionPrompt('');
    setSelectionError('');
    setSelSearch(''); setSelYear(''); setSelType('');
    setSelectionLoading(true);
    fetch(`/api/admin/works?person=${encodeURIComponent(selectedPerson)}`)
      .then((r) => r.json())
      .then((data: { works?: WorkRecord[] }) => {
        setSelectionWorks(
          (data.works ?? []).sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0)),
        );
      })
      .catch(() => setSelectionError('作品の取得に失敗しました'))
      .finally(() => setSelectionLoading(false));
  }, [batchFilter, selectedPerson]);

  // ── 作品探しプロンプト生成 ──
  async function handleGenerate() {
    if (!selectedPerson) { setError('人物を選択してください'); return; }
    setLoading(true);
    setPrompt(''); setError(''); setWorkCount(0);
    try {
      const res = await fetch(
        `/api/admin/csv-export?person=${encodeURIComponent(selectedPerson)}&mode=preview&filter=all`,
      );
      const data = await res.json() as { works?: WorkPreview[]; error?: string };
      if (!res.ok) { setError(data.error ?? '作品データの取得に失敗しました'); return; }
      const works = data.works ?? [];
      setWorkCount(works.length);
      const workLines = works.length > 0
        ? works
            .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))
            .map((w) => w.releaseYear ? `- ${w.title}（${w.releaseYear}）` : `- ${w.title}`)
            .join('\n')
        : '（なし）';
      setPrompt(buildWorkSearchPrompt(selectedPerson, workLines));
    } catch { setError('通信エラーが発生しました'); }
    setLoading(false);
  }

  // ── 配信再調査（一括）プロンプト生成 ──
  async function handleBatchGenerate() {
    if (!selectedPerson) { setBatchError('人物を選択してください'); return; }
    setBatchLoading(true);
    setBatchPrompt(''); setBatchError(''); setBatchWorkCount(0);
    try {
      const res = await fetch(`/api/admin/works?person=${encodeURIComponent(selectedPerson)}`);
      const data = await res.json() as { works?: WorkRecord[]; error?: string };
      if (!res.ok) { setBatchError(data.error ?? '作品データの取得に失敗しました'); return; }
      const allWorks = data.works ?? [];
      const filtered = applyBatchFilter(allWorks, batchFilter)
        .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
      setBatchWorkCount(filtered.length);
      if (filtered.length === 0) {
        setBatchError('対象作品が0件です。フィルタ条件を変更してください。');
        setBatchLoading(false);
        return;
      }
      const csvHeader = 'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices';
      const csvRows = filtered.map(workToBatchRow).join('\n');
      setBatchPrompt(buildBatchVodPrompt(csvHeader + '\n' + csvRows, selectedPerson));
    } catch { setBatchError('通信エラーが発生しました'); }
    setBatchLoading(false);
  }

  // ── 選択作品のみ プロンプト生成 ──
  function handleSelectionGenerate() {
    if (selectedWorkIds.size === 0) {
      setSelectionError('作品を1件以上選択してください');
      return;
    }
    const selected = (selectionWorks ?? []).filter((w) => selectedWorkIds.has(w.id));
    const csvHeader = 'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices';
    const csvRows = selected
      .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))
      .map(workToBatchRow).join('\n');
    setSelectionPrompt(buildBatchVodPrompt(csvHeader + '\n' + csvRows, selectedPerson));
    setSelectionError('');
  }

  async function handleCopy(text: string, setter: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  // ── 選択作品フィルタリング ──
  const filteredSelectionWorks = useMemo(() => {
    if (!selectionWorks) return [];
    return selectionWorks.filter((w) => {
      if (selSearch && !w.title.toLowerCase().includes(selSearch.toLowerCase())) return false;
      if (selYear && String(w.releaseYear ?? '') !== selYear) return false;
      if (selType && w.type !== selType) return false;
      return true;
    });
  }, [selectionWorks, selSearch, selYear, selType]);

  const availableYears = useMemo(() => {
    if (!selectionWorks) return [];
    return [...new Set(selectionWorks.map((w) => w.releaseYear).filter(Boolean) as number[])].sort((a, b) => b - a);
  }, [selectionWorks]);

  const availableTypes = useMemo(() => {
    if (!selectionWorks) return [];
    return [...new Set(selectionWorks.map((w) => w.type))].sort();
  }, [selectionWorks]);

  function toggleWork(id: string) {
    setSelectedWorkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSelectAllFiltered() {
    setSelectedWorkIds((prev) => {
      const next = new Set(prev);
      filteredSelectionWorks.forEach((w) => next.add(w.id));
      return next;
    });
  }

  function handleDeselectAllFiltered() {
    setSelectedWorkIds((prev) => {
      const next = new Set(prev);
      filteredSelectionWorks.forEach((w) => next.delete(w.id));
      return next;
    });
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-white space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-700">ChatGPT調査プロンプト生成</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          人物を選択してプロンプトを生成します。ChatGPTに貼り付けてCSVを返させてください。
        </p>
      </div>

      {/* 人物選択（共通） */}
      <SearchablePersonSelect
        persons={persons}
        value={selectedPerson}
        onChange={(name) => { setSelectedPerson(name); resetAll(); }}
      />

      {/* ══════════════════════════════
          作品探しプロンプト（既存機能）
      ══════════════════════════════ */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-slate-600">① 出演作品探し</p>
        <p className="text-[11px] text-gray-400">
          登録済み作品を除外リストに含め、TMDbで取得できていない作品をChatGPTに調査させます。
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPerson}
            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? '生成中...' : 'プロンプト生成'}
          </button>
          {prompt && (
            <>
              <button
                onClick={() => handleCopy(prompt, setCopied)}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
              >
                {copied ? '✓ コピー完了' : 'クリップボードへコピー'}
              </button>
              <span className="text-[11px] text-gray-400">登録済み {workCount}件 を除外済み</span>
            </>
          )}
        </div>
        {error && <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        {prompt && (
          <textarea
            readOnly value={prompt} rows={20}
            className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-y focus:outline-none"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        )}
      </div>

      <hr className="border-gray-100" />

      {/* ══════════════════════════════
          配信再調査（一括）
      ══════════════════════════════ */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-slate-600">② 配信再調査（一括）</p>
        <p className="text-[11px] text-gray-400">
          登録済み作品の配信情報をまとめてChatGPTで調査します。返却CSVはVOD CSVインポートで取り込めます。
        </p>

        {/* フィルタ選択 */}
        <div className="flex flex-wrap gap-2">
          {BATCH_FILTERS.map((f) => (
            <label key={f.value} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="batchFilter"
                value={f.value}
                checked={batchFilter === f.value}
                onChange={() => {
                  setBatchFilter(f.value);
                  setBatchPrompt(''); setBatchError('');
                  setSelectionPrompt(''); setSelectionError('');
                }}
                className="accent-amber-500"
              />
              <span className={`text-[11px] ${f.value === 'selected_works' ? 'text-indigo-600 font-medium' : 'text-slate-600'}`}>
                {f.label}
              </span>
            </label>
          ))}
        </div>

        {/* ══ ⑦ 選択作品のみ モード ══ */}
        {batchFilter === 'selected_works' && (
          <div className="space-y-3">
            {!selectedPerson && (
              <p className="text-xs text-gray-400">上の人物選択で人物を選んでください。</p>
            )}

            {selectedPerson && selectionLoading && (
              <p className="text-xs text-gray-400 py-2">作品一覧を読み込み中...</p>
            )}

            {selectedPerson && !selectionLoading && selectionWorks !== null && (
              <>
                {/* 検索・フィルタバー */}
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    value={selSearch}
                    onChange={(e) => setSelSearch(e.target.value)}
                    placeholder="作品名で検索..."
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  />
                  <select
                    value={selYear}
                    onChange={(e) => setSelYear(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  >
                    <option value="">年: すべて</option>
                    {availableYears.map((y) => (
                      <option key={y} value={String(y)}>{y}年</option>
                    ))}
                  </select>
                  <select
                    value={selType}
                    onChange={(e) => setSelType(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                  >
                    <option value="">種別: すべて</option>
                    {availableTypes.map((t) => (
                      <option key={t} value={t}>{TYPE_LABEL[t] ?? t} ({t})</option>
                    ))}
                  </select>
                  <div className="flex gap-1 ml-auto">
                    <button
                      onClick={handleSelectAllFiltered}
                      disabled={filteredSelectionWorks.length === 0}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors disabled:opacity-40 font-medium"
                    >
                      全選択
                    </button>
                    <button
                      onClick={handleDeselectAllFiltered}
                      disabled={selectedWorkIds.size === 0}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-40"
                    >
                      全解除
                    </button>
                  </div>
                </div>

                {/* 件数バッジ */}
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span>表示 {filteredSelectionWorks.length}件 / 全 {selectionWorks.length}件</span>
                  {selectedWorkIds.size > 0 && (
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">
                      {selectedWorkIds.size}件選択中
                    </span>
                  )}
                </div>

                {/* 作品一覧テーブル */}
                {filteredSelectionWorks.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">
                    {selectionWorks.length === 0 ? '登録作品がありません' : '検索条件に一致する作品がありません'}
                  </p>
                ) : (
                  <div className="border border-gray-100 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr className="text-gray-500">
                          <th className="p-2 border-b border-gray-100 w-6"></th>
                          <th className="text-left p-2 border-b border-gray-100">タイトル</th>
                          <th className="text-left p-2 border-b border-gray-100 w-16">種別</th>
                          <th className="text-left p-2 border-b border-gray-100 w-12">年</th>
                          <th className="text-left p-2 border-b border-gray-100 w-20">配信</th>
                          <th className="text-left p-2 border-b border-gray-100 w-16">source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSelectionWorks.map((w) => {
                          const checked = selectedWorkIds.has(w.id);
                          const vod = getVodSummary(w);
                          return (
                            <tr
                              key={w.id}
                              onClick={() => toggleWork(w.id)}
                              className={`cursor-pointer transition-colors ${checked ? 'bg-indigo-50 hover:bg-indigo-100' : 'hover:bg-gray-50'}`}
                            >
                              <td className="p-2 border-b border-gray-50 text-center">
                                <input
                                  type="checkbox"
                                  readOnly
                                  checked={checked}
                                  className="w-3.5 h-3.5 accent-indigo-600"
                                  style={{ pointerEvents: 'none' }}
                                />
                              </td>
                              <td className="p-2 border-b border-gray-50 font-medium text-slate-700 max-w-[200px]">
                                <span className="line-clamp-2">{w.title}</span>
                              </td>
                              <td className="p-2 border-b border-gray-50 text-gray-500">
                                {TYPE_LABEL[w.type] ?? w.type}
                              </td>
                              <td className="p-2 border-b border-gray-50 text-gray-500">
                                {w.releaseYear ?? '—'}
                              </td>
                              <td className={`p-2 border-b border-gray-50 ${vod.cls}`}>
                                {vod.label}
                              </td>
                              <td className="p-2 border-b border-gray-50 text-gray-400">
                                {SOURCE_LABEL[w.source] ?? w.source}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 生成ボタン */}
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={handleSelectionGenerate}
                    disabled={selectedWorkIds.size === 0}
                    className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 font-medium"
                  >
                    📋 選択{selectedWorkIds.size}件でプロンプト生成
                  </button>
                  {selectionPrompt && (
                    <button
                      onClick={() => handleCopy(selectionPrompt, setSelectionCopied)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
                    >
                      {selectionCopied ? '✓ コピー完了' : 'クリップボードへコピー'}
                    </button>
                  )}
                </div>

                {selectionError && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{selectionError}</div>
                )}
                {selectionPrompt && (
                  <textarea
                    readOnly value={selectionPrompt} rows={20}
                    className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-y focus:outline-none"
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* ══ ①〜⑥ 生成ボタン（selected_works 選択時は非表示） ══ */}
        {batchFilter !== 'selected_works' && (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                onClick={handleBatchGenerate}
                disabled={batchLoading || !selectedPerson}
                className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 font-medium"
              >
                {batchLoading ? '生成中...' : '📋 配信再調査プロンプト生成'}
              </button>
              {batchPrompt && (
                <>
                  <button
                    onClick={() => handleCopy(batchPrompt, setBatchCopied)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
                  >
                    {batchCopied ? '✓ コピー完了' : 'クリップボードへコピー'}
                  </button>
                  <span className="text-[11px] text-gray-400">対象 {batchWorkCount}件</span>
                </>
              )}
            </div>

            {batchError && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{batchError}</div>
            )}
            {batchPrompt && (
              <textarea
                readOnly value={batchPrompt} rows={20}
                className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-y focus:outline-none"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// プロンプトビルダー
// ─────────────────────────────────────────

function buildWorkSearchPrompt(personName: string, workList: string): string {
  return `対象人物：
${personName}

人物ID：
${personName}

現在登録済み作品：
${workList}

以下の人物について、TMDbで取得できていない可能性がある出演作品を調査してください。

調査対象

* ドラマ
* 映画
* バラエティ
* 配信限定番組
* アイドル番組
* 特番
* ドキュメンタリー
* 舞台映像作品
* Web配信コンテンツ

調査ルール

* 推測禁止
* 確認できた情報のみ
* 同姓同名の別人作品は除外
* 現在登録済み作品は除外
* TMDbに載っているかどうかは気にしない
* 日本国内で確認できる情報を優先
* 重複していても構わないので網羅性を優先

出力形式

personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note

workTypeは以下を使用：
movie / drama / variety / documentary / special / web / stage
${csvDownloadSection(`${personName}_出演作品.csv`)}`;
}

function buildBatchVodPrompt(worksCsv: string, personName: string): string {
  return `以下のCSVに含まれる作品について、日本国内で現在視聴可能な配信サービスを調査してください。

条件

・推測禁止
・日本国内で現在視聴可能な情報のみ
・過去配信のみは除外
・公式サイト、配信サービス公式、番組公式を優先
・workId は必ず保持
・確認できない場合は vodService=unknown を出力
・1作品1サービスで1行（複数サービスは複数行）

調査対象サービス

Hulu / U-NEXT / Lemino / Netflix / Prime Video / DMM TV / TELASA / FOD / ABEMA / TVer / Disney+ / YouTube / NHKオンデマンド

availabilityType は以下を使用

flatrate（見放題）/ rent（レンタル）/ buy（購入）/ free（無料）/ unknown（不明）

出力形式

workId,vodService,availabilityType,confidence,sourceUrl,note

---作品CSVここから---
${worksCsv}
---作品CSVここまで---
${csvDownloadSection(`${personName}_VOD配信情報.csv`)}`;
}
