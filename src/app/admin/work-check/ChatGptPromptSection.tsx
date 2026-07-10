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
// 一括配信調査のフィルタ定義（変更不可）
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

// 変更不可
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

// 変更不可
function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 変更不可
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
// 作品リスト表示ヘルパー
// ─────────────────────────────────────────

const SOURCE_LABEL: Record<string, string> = {
  tmdb:              'TMDb',
  manual_csv:        'CSV',
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
  const real = (w.vodProviders ?? []).filter((p) => p.providerName !== '配信確認できず');
  if (real.length === 0) return { label: '配信なし', cls: 'text-gray-400' };
  if (real.some((p) => p.type === 'unknown')) return { label: 'unknown含む', cls: 'text-yellow-600' };
  if (real.some((p) => p.type === 'flatrate')) return { label: '見放題あり', cls: 'text-green-600' };
  if (real.some((p) => p.type === 'free'))     return { label: '無料配信',   cls: 'text-teal-600' };
  return { label: '配信あり', cls: 'text-teal-600' };
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

type ResearchFilter = 'all' | 'unresearched' | 'researched';

// ─────────────────────────────────────────
// コンポーネント
// ─────────────────────────────────────────

export default function ChatGptPromptSection({ persons }: { persons: PersonWithCounts[] }) {
  const [selectedPerson, setSelectedPerson] = useState('');

  // ── ① 出演作品探し（変更不可） ──
  const [loading, setLoading]     = useState(false);
  const [prompt, setPrompt]       = useState('');
  const [copied, setCopied]       = useState(false);
  const [workCount, setWorkCount] = useState(0);
  const [error, setError]         = useState('');

  // ── ② 配信再調査 共通状態 ──
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('no_vod');

  // 作品一覧（人物ごとに1回取得）
  const [allWorks, setAllWorks]       = useState<WorkRecord[] | null>(null);
  const [worksLoading, setWorksLoading] = useState(false);
  const [worksError, setWorksError]   = useState('');

  // 選択・サブフィルター
  const [selectedWorkIds, setSelectedWorkIds]   = useState<Set<string>>(new Set());
  const [selSearch, setSelSearch]               = useState('');
  const [selYear, setSelYear]                   = useState('');
  const [selType, setSelType]                   = useState('');
  const [selResearch, setSelResearch]           = useState<ResearchFilter>('all');

  // 再調査ログ（localStorage: vod-research-log-{personName}）
  const [researchLog, setResearchLog] = useState<Record<string, number>>({});

  // プロンプト生成結果
  const [genPrompt, setGenPrompt]     = useState('');
  const [genCopied, setGenCopied]     = useState(false);
  const [genError, setGenError]       = useState('');
  const [markMsg, setMarkMsg]         = useState('');

  // 人物変更: ① リセット
  function resetSection1() {
    setPrompt(''); setError(''); setWorkCount(0);
  }

  // ── 人物変更時: ② 状態をリセットして作品一覧・ログを取得 ──
  useEffect(() => {
    setAllWorks(null); setWorksError(''); setWorksLoading(false);
    setSelectedWorkIds(new Set());
    setSelSearch(''); setSelYear(''); setSelType(''); setSelResearch('all');
    setResearchLog({}); setGenPrompt(''); setGenError(''); setMarkMsg('');

    if (!selectedPerson) return;

    // localStorage から再調査ログ読み込み
    try {
      const raw = localStorage.getItem(`vod-research-log-${selectedPerson}`);
      setResearchLog(JSON.parse(raw ?? '{}'));
    } catch { /* ignore */ }

    // 作品一覧取得
    let cancelled = false;
    setWorksLoading(true);
    fetch(`/api/admin/works?person=${encodeURIComponent(selectedPerson)}`)
      .then((r) => r.json())
      .then((data: { works?: WorkRecord[] }) => {
        if (!cancelled) {
          setAllWorks(
            (data.works ?? []).sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0)),
          );
        }
      })
      .catch(() => { if (!cancelled) setWorksError('作品の取得に失敗しました'); })
      .finally(() => { if (!cancelled) setWorksLoading(false); });

    return () => { cancelled = true; };
  }, [selectedPerson]);

  // フィルター変更時: 選択・プロンプトをリセット（サブフィルターは保持）
  useEffect(() => {
    setSelectedWorkIds(new Set());
    setGenPrompt(''); setGenError(''); setMarkMsg('');
  }, [batchFilter]);

  // ── バッチフィルター済み作品 ──
  // ⑦ selected_works は全作品を対象（手動選択専用）
  const batchFiltered = useMemo(() => {
    if (!allWorks) return [];
    return batchFilter === 'selected_works' ? allWorks : applyBatchFilter(allWorks, batchFilter);
  }, [allWorks, batchFilter]);

  // ── サブフィルター適用（表示用） ──
  const displayWorks = useMemo(() => {
    return batchFiltered.filter((w) => {
      if (selSearch && !w.title.toLowerCase().includes(selSearch.toLowerCase())) return false;
      if (selYear && String(w.releaseYear ?? '') !== selYear) return false;
      if (selType && w.type !== selType) return false;
      if (selResearch === 'unresearched' &&  researchLog[w.id]) return false;
      if (selResearch === 'researched'   && !researchLog[w.id]) return false;
      return true;
    });
  }, [batchFiltered, selSearch, selYear, selType, selResearch, researchLog]);

  const availableYears = useMemo(
    () => [...new Set(batchFiltered.map((w) => w.releaseYear).filter(Boolean) as number[])].sort((a, b) => b - a),
    [batchFiltered],
  );
  const availableTypes = useMemo(
    () => [...new Set(batchFiltered.map((w) => w.type))].sort(),
    [batchFiltered],
  );

  // バッチフィルター内で選択されている作品
  const selectedInBatch = useMemo(
    () => batchFiltered.filter((w) => selectedWorkIds.has(w.id)),
    [batchFiltered, selectedWorkIds],
  );

  // ── 選択操作 ──
  function toggleWork(id: string) {
    setSelectedWorkIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    setSelectedWorkIds((prev) => { const n = new Set(prev); displayWorks.forEach((w) => n.add(w.id)); return n; });
  }
  function deselectAllVisible() {
    setSelectedWorkIds((prev) => { const n = new Set(prev); displayWorks.forEach((w) => n.delete(w.id)); return n; });
  }

  // ── 再調査ログ保存 ──
  function markResearched(workIds: string[]) {
    const now = Date.now();
    const key = `vod-research-log-${selectedPerson}`;
    try {
      const prev = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, number>;
      const next = { ...prev };
      workIds.forEach((id) => { next[id] = now; });
      localStorage.setItem(key, JSON.stringify(next));
      setResearchLog(next);
    } catch { /* ignore */ }
    setMarkMsg(`${workIds.length}件を再調査済みにしました`);
    setTimeout(() => setMarkMsg(''), 4000);
  }

  // ── プロンプト生成（指定作品） ──
  function generateForWorks(works: WorkRecord[]) {
    setGenError('');
    if (works.length === 0) {
      setGenError('対象作品が0件です。フィルタ条件を変更するか、作品を選択してください。');
      return;
    }
    const header = 'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices';
    const rows   = works
      .slice()
      .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))
      .map(workToBatchRow)
      .join('\n');
    setGenPrompt(buildBatchVodPrompt(`${header}\n${rows}`, selectedPerson));
    markResearched(works.map((w) => w.id));
  }

  // ── ① 出演作品探しプロンプト生成（変更不可） ──
  async function handleGenerate() {
    if (!selectedPerson) { setError('人物を選択してください'); return; }
    setLoading(true);
    setPrompt(''); setError(''); setWorkCount(0);
    try {
      const res  = await fetch(`/api/admin/csv-export?person=${encodeURIComponent(selectedPerson)}&mode=preview&filter=all`);
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

  async function handleCopy(text: string, setter: (v: boolean) => void) {
    await navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
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
        onChange={(name) => { setSelectedPerson(name); resetSection1(); }}
      />

      {/* ══════════════════════════════
          ① 出演作品探し（変更不可）
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
          ② 配信再調査
      ══════════════════════════════ */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-slate-600">② 配信再調査</p>
        <p className="text-[11px] text-gray-400">
          フィルターで対象作品を絞り込み、必要な作品だけ選択してプロンプトを生成します。
          返却CSVは VOD CSVインポートで取り込めます。
        </p>

        {/* フィルタ選択 */}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {BATCH_FILTERS.map((f) => (
            <label key={f.value} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="batchFilter"
                value={f.value}
                checked={batchFilter === f.value}
                onChange={() => setBatchFilter(f.value)}
                className="accent-amber-500"
              />
              <span className={`text-[11px] ${f.value === 'selected_works' ? 'text-indigo-600 font-medium' : 'text-slate-600'}`}>
                {f.label}
              </span>
            </label>
          ))}
        </div>

        {/* 人物未選択 */}
        {!selectedPerson && (
          <p className="text-xs text-gray-400">上の人物選択で人物を選んでください。</p>
        )}

        {/* 作品取得中 */}
        {selectedPerson && worksLoading && (
          <p className="text-xs text-gray-400 py-2">作品一覧を読み込み中...</p>
        )}

        {/* 取得エラー */}
        {selectedPerson && worksError && (
          <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{worksError}</div>
        )}

        {/* 作品一覧（全フィルター共通） */}
        {selectedPerson && !worksLoading && allWorks !== null && (
          <>
            {/* ── サブフィルターバー ── */}
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                value={selSearch}
                onChange={(e) => setSelSearch(e.target.value)}
                placeholder="作品名で検索..."
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 w-40 focus:outline-none focus:ring-1 focus:ring-amber-300"
              />
              <select
                value={selYear}
                onChange={(e) => setSelYear(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-300"
              >
                <option value="">年: すべて</option>
                {availableYears.map((y) => (
                  <option key={y} value={String(y)}>{y}年</option>
                ))}
              </select>
              <select
                value={selType}
                onChange={(e) => setSelType(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-300"
              >
                <option value="">種別: すべて</option>
                {availableTypes.map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>
                ))}
              </select>

              {/* 調査状態フィルター */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px]">
                {(['all', 'unresearched', 'researched'] as ResearchFilter[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setSelResearch(v)}
                    className={`px-2 py-1.5 transition-colors border-r border-gray-200 last:border-0 ${
                      selResearch === v
                        ? 'bg-amber-50 text-amber-700 font-medium'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {v === 'all' ? 'すべて' : v === 'unresearched' ? '未調査' : '調査済み'}
                  </button>
                ))}
              </div>

              {/* 全選択/全解除 */}
              <div className="flex gap-1 ml-auto">
                <button
                  onClick={selectAllVisible}
                  disabled={displayWorks.length === 0}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 transition-colors disabled:opacity-40 font-medium"
                >
                  全選択
                </button>
                <button
                  onClick={deselectAllVisible}
                  disabled={selectedWorkIds.size === 0}
                  className="text-[10px] px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-40"
                >
                  全解除
                </button>
              </div>
            </div>

            {/* 件数バー */}
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span>
                {batchFilter === 'selected_works'
                  ? `全 ${allWorks.length}件`
                  : `フィルター ${batchFiltered.length}件`}
                {(selSearch || selYear || selType || selResearch !== 'all') &&
                  ` → 表示 ${displayWorks.length}件`}
              </span>
              {selectedInBatch.length > 0 && (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                  {selectedInBatch.length}件選択中
                </span>
              )}
            </div>

            {/* 作品テーブル */}
            {displayWorks.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-4">
                {batchFiltered.length === 0
                  ? '該当する作品がありません'
                  : '検索・フィルター条件に一致する作品がありません'}
              </p>
            ) : (
              <div className="border border-gray-100 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-gray-500">
                      <th className="p-2 border-b border-gray-100 w-6"></th>
                      <th className="text-left p-2 border-b border-gray-100">タイトル</th>
                      <th className="text-left p-2 border-b border-gray-100 w-14">種別</th>
                      <th className="text-right p-2 border-b border-gray-100 w-10">年</th>
                      <th className="text-left p-2 border-b border-gray-100 w-20">配信</th>
                      <th className="text-left p-2 border-b border-gray-100 w-12">source</th>
                      <th className="text-left p-2 border-b border-gray-100 w-20">再調査</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayWorks.map((w) => {
                      const checked     = selectedWorkIds.has(w.id);
                      const vod         = getVodSummary(w);
                      const researchedAt = researchLog[w.id];
                      return (
                        <tr
                          key={w.id}
                          onClick={() => toggleWork(w.id)}
                          className={`cursor-pointer transition-colors ${
                            checked ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="p-2 border-b border-gray-50 text-center">
                            <input
                              type="checkbox"
                              readOnly
                              checked={checked}
                              className="w-3.5 h-3.5 accent-amber-500"
                              style={{ pointerEvents: 'none' }}
                            />
                          </td>
                          <td className="p-2 border-b border-gray-50 font-medium text-slate-700 max-w-[180px]">
                            <span className="line-clamp-2">{w.title}</span>
                          </td>
                          <td className="p-2 border-b border-gray-50 text-gray-500">
                            {TYPE_LABEL[w.type] ?? w.type}
                          </td>
                          <td className="p-2 border-b border-gray-50 text-gray-500 text-right">
                            {w.releaseYear ?? '—'}
                          </td>
                          <td className={`p-2 border-b border-gray-50 ${vod.cls}`}>{vod.label}</td>
                          <td className="p-2 border-b border-gray-50 text-gray-400">
                            {SOURCE_LABEL[w.source] ?? w.source}
                          </td>
                          <td className="p-2 border-b border-gray-50">
                            {researchedAt ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 text-teal-600 font-medium whitespace-nowrap">
                                前回 {fmtDate(researchedAt)}
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-300">未調査</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── 生成ボタン群 ── */}
            <div className="flex flex-wrap gap-2 items-center">
              {/* 全件生成（⑦ selected_works 以外） */}
              {batchFilter !== 'selected_works' && (
                <button
                  onClick={() => generateForWorks(batchFiltered)}
                  disabled={batchFiltered.length === 0}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50 font-medium"
                >
                  📋 全{batchFiltered.length}件でプロンプト生成
                </button>
              )}
              {/* 選択件数生成（1件以上選択時） */}
              {selectedInBatch.length > 0 && (
                <button
                  onClick={() => generateForWorks(selectedInBatch)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium"
                >
                  📋 選択{selectedInBatch.length}件でプロンプト生成
                </button>
              )}
              {/* コピー */}
              {genPrompt && (
                <button
                  onClick={() => handleCopy(genPrompt, setGenCopied)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
                >
                  {genCopied ? '✓ コピー完了' : 'クリップボードへコピー'}
                </button>
              )}
              {/* 再調査済みメッセージ */}
              {markMsg && (
                <span className="text-[11px] text-teal-600 font-medium">{markMsg}</span>
              )}
            </div>

            {genError && (
              <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{genError}</div>
            )}
            {genPrompt && (
              <textarea
                readOnly value={genPrompt} rows={20}
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
// プロンプトビルダー（変更不可）
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

workId,personName,workTitle,workType,releaseYear,roleName,workDisplayType,sourceUrl,note

workTypeは以下を使用：
movie / tv / drama / variety / documentary / special / web / stage / anime

workDisplayType（必須・空欄禁止。不明なら other）
以下のいずれかを使用：

movie        → 映画（劇場公開作品）
drama        → ドラマ（連続ドラマ・単発ドラマ）
variety      → バラエティ（一般バラエティ番組）
idol_show    → アイドル番組（乃木坂工事中・日向坂で会いましょう・欅って書けない等のアイドル冠番組）
live         → ライブ・コンサート（ライブ映像・コンサートツアー・卒業コンサート）
documentary  → ドキュメンタリー（ドキュメンタリー映画・密着番組）
stage        → 舞台・ミュージカル（舞台作品・朗読劇・ミュージカル）
music        → 音楽番組（MUSIC STATION・紅白歌合戦・CDTV等）
web          → 配信番組・Web（配信限定番組・YouTubeオリジナル等）
anime_voice  → アニメ・声優（アニメ出演・声優・吹替・ナレーション）
other        → その他（上記に当てはまらないもの）

workIdは空欄でよい（インポート時に自動採番）
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
