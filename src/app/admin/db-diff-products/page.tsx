'use client';

import { useState } from 'react';

// ── 診断結果の型 ──────────────────────────────────────────────────────────────
interface InspectOverview { items_type: string; cnt: number; total_items: number; }
interface InspectSample {
  person_name: string; category: string;
  items_type: string; item_count: number;
  elem0_type: string | null; elem0_keys: string | null; elem0_raw: string | null;
  f_title: string | null; f_itemname: string | null; f_name: string | null;
  f_productname: string | null; f_item_itemname: string | null; f_item_title: string | null;
  f_id: string | null; f_itemurl: string | null;
}
interface InspectFieldCounts {
  has_title: number; has_itemname: number; has_name: number;
  has_item_itemname: number; has_items: number;
}
interface InspectResult {
  overview?: InspectOverview[];
  samples?: InspectSample[];
  fieldCounts?: InspectFieldCounts;
  error?: string;
}

type StructureClass = 'normal' | 'empty-array' | 'unknown-structure' | 'malformed';

interface DiffEntry {
  personName: string;
  category: string;
  dbItemCount: number | null;
  redisItemCount: number | null;
  fetchedAt: string | null;
  sampleItems: string[];
  sampleShopName: string | null;
  structureClass: StructureClass;
}

interface PersonBreakdown {
  personName: string;
  categoryCount: number;
  totalItemCount: number;
  normal: number;
  emptyArray: number;
  unknownStructure: number;
  malformed: number;
}

interface DbOnlyAnalysis {
  schemaNote: string;
  distinctPersons: string[];
  fetchedAtMin: string | null;
  fetchedAtMax: string | null;
  totalDbItemCount: number;
  originHint: string;
  verdict: 'real-data' | 'likely-real' | 'unknown' | 'test-data';
}

interface DiffSummary {
  dbTotal: number;
  redisTotal: number;
  dbOnlyCount: number;
  redisOnlyCount: number;
  bothDiffCount: number;
  malformedRedisCount: number;
  truncatedAt: number;
}

interface DiffResult {
  summary?: DiffSummary;
  dbOnlyAnalysis?: DbOnlyAnalysis;
  dbOnlyPersonBreakdown?: PersonBreakdown[];
  dbOnly?: DiffEntry[];
  redisOnly?: DiffEntry[];
  bothDiff?: DiffEntry[];
  error?: string;
}

const STRUCTURE_BADGE: Record<StructureClass, { cls: string; label: string }> = {
  'normal':            { cls: 'bg-green-100 text-green-700',  label: '正常' },
  'empty-array':       { cls: 'bg-gray-100 text-gray-500',    label: '空配列' },
  'unknown-structure': { cls: 'bg-amber-100 text-amber-700',  label: '構造不明' },
  'malformed':         { cls: 'bg-red-100 text-red-700',      label: '不正JSON' },
};

const VERDICT_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  'real-data':    { bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  label: '✓ 正常商品あり — 削除不要' },
  'likely-real':  { bg: 'bg-blue-50 border-blue-200',    text: 'text-blue-800',   label: '○ 正常商品データの可能性大 — 削除不要' },
  'unknown':      { bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-800',  label: '? 商品名取得不可 — 手動確認が必要' },
  'test-data':    { bg: 'bg-red-50 border-red-200',      text: 'text-red-800',    label: '✗ 商品データなし — テスト/残留データの可能性あり' },
};

function fmtDate(v: string | null): string {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('ja-JP'); } catch { return v; }
}

function DbOnlyTable({ entries }: { entries: DiffEntry[] }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;

  const structureCounts = entries.reduce<Record<StructureClass, number>>(
    (acc, e) => { acc[e.structureClass] = (acc[e.structureClass] ?? 0) + 1; return acc; },
    { normal: 0, 'empty-array': 0, 'unknown-structure': 0, malformed: 0 },
  );

  return (
    <div>
      {/* 分類サマリー */}
      <div className="flex gap-2 mb-2 flex-wrap">
        {(Object.keys(STRUCTURE_BADGE) as StructureClass[]).map((cls) => (
          structureCounts[cls] > 0 && (
            <span key={cls} className={`text-xs px-2 py-0.5 rounded-full font-medium ${STRUCTURE_BADGE[cls].cls}`}>
              {STRUCTURE_BADGE[cls].label}: {structureCounts[cls]}件
            </span>
          )
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-gray-500">
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">person_name</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">category</th>
              <th className="text-right py-1.5 px-2 font-medium whitespace-nowrap">DB件数</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">分類</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">fetched_at</th>
              <th className="text-left py-1.5 px-2 font-medium">商品名サンプル（先頭3件）</th>
              <th className="text-left py-1.5 px-2 font-medium whitespace-nowrap">ショップ</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const badge = STRUCTURE_BADGE[e.structureClass];
              return (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
                  <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
                  <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>
                  <td className="py-1 px-2 whitespace-nowrap">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="py-1 px-2 text-gray-400 whitespace-nowrap">{fmtDate(e.fetchedAt)}</td>
                  <td className="py-1 px-2 text-gray-700">
                    {e.sampleItems.length > 0
                      ? e.sampleItems.map((name, j) => (
                          <div key={j} className="truncate max-w-xs" title={name}>
                            {j + 1}. {name}
                          </div>
                        ))
                      : <span className="text-gray-300">-</span>
                    }
                  </td>
                  <td className="py-1 px-2 text-gray-500 whitespace-nowrap">
                    {e.sampleShopName ?? <span className="text-gray-300">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SimpleTable({ entries, type }: { entries: DiffEntry[]; type: 'redis-only' | 'both' }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;
  const showDb    = type === 'both';
  const showRedis = true;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500">
            <th className="text-left py-1.5 px-2 font-medium">person_name</th>
            <th className="text-left py-1.5 px-2 font-medium">category</th>
            {showDb    && <th className="text-right py-1.5 px-2 font-medium">DB件数</th>}
            {showRedis && <th className="text-right py-1.5 px-2 font-medium">Redis件数</th>}
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-mono whitespace-nowrap">{e.personName}</td>
              <td className="py-1 px-2 font-mono whitespace-nowrap text-gray-600">{e.category}</td>
              {showDb    && <td className="py-1 px-2 text-right">{e.dbItemCount ?? '-'}</td>}
              {showRedis && <td className="py-1 px-2 text-right">{e.redisItemCount ?? '-'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DbDiffProductsPage() {
  const [result, setResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);

  async function fetchDiff() {
    setLoading(true);
    setRawError(null);
    setResult(null);

    let res: Response;
    try {
      res = await fetch('/api/admin/db-diff-products');
    } catch (networkErr) {
      setRawError(`ネットワークエラー: ${String(networkErr)}`);
      setLoading(false);
      return;
    }

    let text = '';
    try { text = await res.text(); } catch (readErr) {
      setRawError(`レスポンス読み取りエラー: ${String(readErr)}`);
      setLoading(false);
      return;
    }

    if (!text || text.trim() === '') {
      setRawError(
        `APIが空レスポンスを返しました (HTTP ${res.status})。` +
        `タイムアウトの可能性があります。Vercel ログを確認してください。`,
      );
      setLoading(false);
      return;
    }

    let data: DiffResult;
    try {
      data = JSON.parse(text) as DiffResult;
    } catch (parseErr) {
      setRawError(
        `JSON パースエラー: ${String(parseErr)}\n` +
        `レスポンス先頭200文字: ${text.slice(0, 200)}`,
      );
      setLoading(false);
      return;
    }

    setResult(data);
    setLoading(false);
  }

  async function fetchInspect() {
    setInspecting(true);
    setInspectResult(null);
    try {
      const res = await fetch('/api/admin/db-inspect-products');
      const text = await res.text();
      if (!text || text.trim() === '') {
        setInspectResult({ error: `空レスポンス (HTTP ${res.status})` });
      } else {
        setInspectResult(JSON.parse(text) as InspectResult);
      }
    } catch (e) {
      setInspectResult({ error: String(e) });
    }
    setInspecting(false);
  }

  const s = result?.summary;
  const analysis = result?.dbOnlyAnalysis;
  const personBreakdown = result?.dbOnlyPersonBreakdown;
  const verdictStyle = analysis ? (VERDICT_STYLE[analysis.verdict] ?? VERDICT_STYLE['unknown']) : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">products 差分詳細（読み取り専用）</h1>
      <p className="text-sm text-gray-500 mb-6">
        Redis ↔ DB の (person_name, category) の差分を調査します。<br />
        DELETE / TRUNCATE / DROP は使いません。既存データは変更されません。
      </p>

      <div className="flex gap-3 mb-6 flex-wrap">
        <button
          onClick={fetchDiff}
          disabled={loading}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? '取得中（数秒かかります）...' : '差分を取得'}
        </button>
        <button
          onClick={fetchInspect}
          disabled={inspecting}
          className="px-4 py-2 text-sm rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {inspecting ? '診断中...' : '🔬 JSON構造診断'}
        </button>
      </div>

      {/* JSON構造診断結果 */}
      {inspectResult && (
        <div className="bg-purple-50 border border-purple-200 rounded p-4 mb-6">
          <p className="text-sm font-bold text-purple-800 mb-3">🔬 items JSONB 構造診断（読み取り専用）</p>

          {inspectResult.error && (
            <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{inspectResult.error}</pre>
          )}

          {inspectResult.fieldCounts && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-purple-700 mb-1">フィールド一致件数（items[0] が存在する行中）</p>
              <div className="flex gap-2 flex-wrap text-xs">
                {[
                  { label: 'items[0] あり',             val: inspectResult.fieldCounts.has_items },
                  { label: 'title',                      val: inspectResult.fieldCounts.has_title },
                  { label: 'itemName',                   val: inspectResult.fieldCounts.has_itemname },
                  { label: 'name',                       val: inspectResult.fieldCounts.has_name },
                  { label: 'Item.itemName（ネスト）',    val: inspectResult.fieldCounts.has_item_itemname },
                ].map(({ label, val }) => (
                  <span key={label} className={`px-2 py-1 rounded font-mono border ${val > 0 ? 'bg-green-100 border-green-300 text-green-800' : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
                    {label}: <strong>{val}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}

          {inspectResult.overview && inspectResult.overview.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-purple-700 mb-1">items 型の分布</p>
              <div className="flex gap-2 flex-wrap text-xs">
                {inspectResult.overview.map((o, i) => (
                  <span key={i} className="px-2 py-1 rounded bg-white border text-gray-700 font-mono">
                    {o.items_type}: {o.cnt}行 / 合計{o.total_items}件
                  </span>
                ))}
              </div>
            </div>
          )}

          {inspectResult.samples && inspectResult.samples.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-purple-700 mb-2">items[0] サンプル（件数の多い順5行）</p>
              {inspectResult.samples.map((s, i) => (
                <div key={i} className="mb-3 p-3 bg-white rounded border text-xs">
                  <div className="flex gap-3 mb-1 flex-wrap">
                    <span className="font-semibold">{s.person_name}</span>
                    <span className="text-gray-500">{s.category}</span>
                    <span className="text-gray-500">item_count: <strong>{s.item_count}</strong></span>
                    <span className="text-gray-500">elem0_type: <strong>{s.elem0_type ?? 'null'}</strong></span>
                  </div>
                  <div className="mb-1">
                    <span className="text-gray-500">elem0 keys: </span>
                    <span className="font-mono text-purple-700">{s.elem0_keys ?? '(なし)'}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap mb-1">
                    {[
                      { label: 'title',          val: s.f_title },
                      { label: 'itemName',       val: s.f_itemname },
                      { label: 'name',           val: s.f_name },
                      { label: 'productName',    val: s.f_productname },
                      { label: 'Item.itemName',  val: s.f_item_itemname },
                      { label: 'Item.title',     val: s.f_item_title },
                      { label: 'id',             val: s.f_id },
                      { label: 'itemUrl',        val: s.f_itemurl },
                    ].map(({ label, val }) => val !== null && (
                      <span key={label} className="px-1.5 py-0.5 rounded bg-green-100 text-green-800">
                        ✓ {label}: {String(val).slice(0, 60)}
                      </span>
                    ))}
                  </div>
                  {s.elem0_raw && (
                    <details>
                      <summary className="text-gray-400 cursor-pointer">items[0] raw（先頭800文字）</summary>
                      <pre className="mt-1 text-[10px] text-gray-600 whitespace-pre-wrap break-all bg-gray-50 p-2 rounded overflow-auto max-h-48">
                        {s.elem0_raw}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rawError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">取得エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{rawError}</pre>
        </div>
      )}

      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
          <p className="text-xs font-semibold text-red-700 mb-1">API エラー</p>
          <pre className="text-xs text-red-600 whitespace-pre-wrap break-all">{result.error}</pre>
        </div>
      )}

      {s && (
        <>
          {/* サマリー */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-6">
            {[
              { label: 'DB 合計',       val: s.dbTotal,             color: 'text-gray-700' },
              { label: 'Redis 合計',    val: s.redisTotal,          color: 'text-gray-700' },
              { label: 'DB のみ',       val: s.dbOnlyCount,         color: s.dbOnlyCount    > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: 'Redis のみ',    val: s.redisOnlyCount,      color: s.redisOnlyCount > 0 ? 'text-amber-600' : 'text-green-600' },
              { label: '件数不一致',    val: s.bothDiffCount,       color: s.bothDiffCount  > 0 ? 'text-orange-600' : 'text-green-600' },
              { label: 'Redis不正JSON', val: s.malformedRedisCount, color: s.malformedRedisCount > 0 ? 'text-red-500' : 'text-gray-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-white border rounded p-2 text-center">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>

          {/* DB のみ — 起源分析 */}
          {analysis && s.dbOnlyCount > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                DB にのみ存在（Redis に対応なし）— {s.dbOnlyCount} 件
                {s.dbOnlyCount > s.truncatedAt && (
                  <span className="text-xs text-gray-400">（表示は {s.truncatedAt} 件まで）</span>
                )}
              </h2>

              {/* 起源判定カード */}
              <div className={`border rounded p-4 mb-4 ${verdictStyle?.bg}`}>
                <p className={`text-sm font-bold mb-2 ${verdictStyle?.text}`}>
                  判定: {verdictStyle?.label}
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3 text-xs">
                  <div>
                    <p className="text-gray-500 mb-0.5">関係する人物数</p>
                    <p className="font-bold">{analysis.distinctPersons.length} 名</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">fetched_at 最古</p>
                    <p className="font-mono">{fmtDate(analysis.fetchedAtMin)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">fetched_at 最新</p>
                    <p className="font-mono">{fmtDate(analysis.fetchedAtMax)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 mb-0.5">合計商品件数</p>
                    <p className="font-bold">{analysis.totalDbItemCount.toLocaleString()} 件</p>
                  </div>
                </div>

                <div className="text-xs mb-2">
                  <p className="text-gray-500 font-medium mb-0.5">起源の推定:</p>
                  <p className={verdictStyle?.text}>{analysis.originHint}</p>
                </div>

                <div className="text-xs">
                  <p className="text-gray-500 font-medium mb-0.5">関係する人物:</p>
                  <p className="text-gray-600">{analysis.distinctPersons.join(', ')}</p>
                </div>

                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">スキーマ補足</summary>
                  <p className="text-xs text-gray-500 mt-1">{analysis.schemaNote}</p>
                </details>
              </div>

              {/* 人物別内訳 */}
              {personBreakdown && personBreakdown.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-600 mb-1">人物別内訳（商品件数の多い順）</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b text-gray-500">
                          <th className="text-left py-1 px-2 font-medium">person_name</th>
                          <th className="text-right py-1 px-2 font-medium whitespace-nowrap">カテゴリ数</th>
                          <th className="text-right py-1 px-2 font-medium whitespace-nowrap">合計商品数</th>
                          <th className="text-left py-1 px-2 font-medium whitespace-nowrap">分類内訳</th>
                        </tr>
                      </thead>
                      <tbody>
                        {personBreakdown.map((p, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            <td className="py-1 px-2 font-mono">{p.personName}</td>
                            <td className="py-1 px-2 text-right">{p.categoryCount}</td>
                            <td className="py-1 px-2 text-right font-medium">{p.totalItemCount.toLocaleString()}</td>
                            <td className="py-1 px-2">
                              <div className="flex gap-1 flex-wrap">
                                {p.normal > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">正常:{p.normal}</span>
                                )}
                                {p.emptyArray > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">空:{p.emptyArray}</span>
                                )}
                                {p.unknownStructure > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">構造不明:{p.unknownStructure}</span>
                                )}
                                {p.malformed > 0 && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">不正:{p.malformed}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <DbOnlyTable entries={result.dbOnly ?? []} />
            </section>
          )}

          {s.dbOnlyCount === 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                DB のみ — 0 件
              </h2>
            </section>
          )}

          {/* Redis のみ */}
          <section className="mb-6">
            <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
              Redis にのみ存在（DB に対応なし）— {s.redisOnlyCount} 件
            </h2>
            <p className="text-xs text-gray-400 mb-2">
              原因候補: dual-write 導入前の古い Redis データ / DB 書き込みが失敗した
            </p>
            <SimpleTable entries={result.redisOnly ?? []} type="redis-only" />
          </section>

          {/* 件数不一致 */}
          {s.bothDiffCount > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold mb-1 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                両方に存在するが items 件数が異なる — {s.bothDiffCount} 件
              </h2>
              <SimpleTable entries={result.bothDiff ?? []} type="both" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
