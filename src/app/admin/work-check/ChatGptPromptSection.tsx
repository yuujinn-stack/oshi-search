'use client';

import { useState } from 'react';
import type { WorkRecord } from '@/types/work';
import type { PersonWithCounts } from './work-check-types';
import SearchablePersonSelect from './SearchablePersonSelect';

interface WorkPreview {
  title: string;
  releaseYear: number | null;
}

// ─────────────────────────────────────────
// 一括配信調査のフィルタ定義
// ─────────────────────────────────────────

const BATCH_FILTERS = [
  { value: 'no_vod',       label: '① 配信情報なし作品のみ' },
  { value: 'no_tmdb',      label: '② tmdbIdなし作品のみ' },
  { value: 'has_unknown',  label: '③ vodService=unknown を含む作品' },
  { value: 'manual_csv',   label: '④ manual_csv作品のみ' },
  { value: 'ai_supplement',label: '⑤ ai_supplement作品のみ' },
  { value: 'all',          label: '⑥ 選択中人物の全作品' },
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

  // ── 配信再調査（一括）──
  const [batchFilter, setBatchFilter] = useState<BatchFilter>('no_vod');
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchPrompt, setBatchPrompt] = useState('');
  const [batchCopied, setBatchCopied] = useState(false);
  const [batchWorkCount, setBatchWorkCount] = useState(0);
  const [batchError, setBatchError] = useState('');

  function resetAll() {
    setPrompt(''); setError(''); setWorkCount(0);
    setBatchPrompt(''); setBatchError(''); setBatchWorkCount(0);
  }

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
      setBatchPrompt(buildBatchVodPrompt(csvHeader + '\n' + csvRows));
    } catch { setBatchError('通信エラーが発生しました'); }
    setBatchLoading(false);
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
                onChange={() => { setBatchFilter(f.value); setBatchPrompt(''); setBatchError(''); }}
                className="accent-amber-500"
              />
              <span className="text-[11px] text-slate-600">{f.label}</span>
            </label>
          ))}
        </div>

        {/* 生成ボタン */}
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

CSVのみ

personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note

workTypeは以下を使用：
movie / drama / variety / documentary / special / web / stage`;
}

function buildBatchVodPrompt(worksCsv: string): string {
  return `以下のCSVに含まれる作品について、日本国内で現在視聴可能な配信サービスを調査してください。

条件

・推測禁止
・日本国内で現在視聴可能な情報のみ
・過去配信のみは除外
・公式サイト、配信サービス公式、番組公式を優先
・workId は必ず保持
・確認できない場合は vodService=unknown を出力
・1作品1サービスで1行（複数サービスは複数行）
・CSV以外の文章は出力しない

調査対象サービス

Hulu / U-NEXT / Lemino / Netflix / Prime Video / DMM TV / TELASA / FOD / ABEMA / TVer / Disney+ / YouTube / NHKオンデマンド

availabilityType は以下を使用

flatrate（見放題）/ rent（レンタル）/ buy（購入）/ free（無料）/ unknown（不明）

出力形式

workId,vodService,availabilityType,confidence,sourceUrl,note

---作品CSVここから---
${worksCsv}
---作品CSVここまで---`;
}
