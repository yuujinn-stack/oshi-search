'use client';

import { useState } from 'react';
import { canExecuteProductRecovery } from '@/lib/recovery-guard';
import type {
  OrphanStat,
  OrphanVerdict,
  ProductRecoveryCandidate,
  IdDiagResult,
} from '@/app/api/admin/product-recovery/route';

interface Props {
  initialStats:       OrphanStat[];
  initialTotal:       number;
  recoveryEnabled:    boolean;
  recoveryBlockReason: string | null;
}

interface DryRunResult {
  dryRun:           true;
  recoverableCount: number;
  alreadyInDbCount: number;
  notInRedisCount:  number;
  preview: { productId: string; category: string; title: string }[];
}

interface ExecResult {
  ok:            boolean;
  recovered:     number;
  skipped:       number;
  idempotencyKey: string;
}

export default function ProductRecoveryClient({
  initialStats, initialTotal, recoveryEnabled, recoveryBlockReason,
}: Props) {
  const [stats]             = useState<OrphanStat[]>(initialStats);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrphanVerdict[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Redis スキャン
  const [redisResult, setRedisResult] = useState<{
    verdicts:   OrphanVerdict[];
    summary: { total: number; classA: number; classE: number; redisKeyExists: boolean; redisCategories: string[] };
  } | null>(null);
  const [redisLoading, setRedisLoading] = useState(false);
  const [redisError, setRedisError]     = useState('');

  // 選択（class A のみ）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 復旧フロー
  const [dryRunResult, setDryRunResult]   = useState<DryRunResult | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [execResult, setExecResult]       = useState<ExecResult | null>(null);
  const [execLoading, setExecLoading]     = useState(false);
  const [execError, setExecError]         = useState('');

  const [reason, setReason]               = useState('');
  const [confirmInput, setConfirmInput]   = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // ── ID 診断 ────────────────────────────────────────────────────────────────
  const [diagResult, setDiagResult]       = useState<IdDiagResult | null>(null);
  const [diagLoading, setDiagLoading]     = useState(false);
  const [diagError, setDiagError]         = useState('');

  // ── 人物の孤立 verdict 詳細を取得 ─────────────────────────────────────────
  async function loadDetail(personName: string) {
    setSelectedPerson(personName);
    setDetail(null);
    setRedisResult(null);
    setRedisError('');
    setSelectedIds(new Set());
    setDryRunResult(null);
    setExecResult(null);
    setExecError('');
    setDetailLoading(true);
    const res = await fetch(
      `/api/admin/product-recovery?type=orphan-detail&personName=${encodeURIComponent(personName)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { verdicts: OrphanVerdict[] };
      setDetail(data.verdicts);
    }
    setDetailLoading(false);
  }

  // ── Redis スキャン ─────────────────────────────────────────────────────────
  async function checkRedis() {
    if (!selectedPerson) return;
    setRedisLoading(true);
    setRedisError('');
    setSelectedIds(new Set());
    setDryRunResult(null);
    setExecResult(null);
    const res = await fetch(
      `/api/admin/product-recovery?type=redis-check&personName=${encodeURIComponent(selectedPerson)}`,
    );
    const data = (await res.json()) as {
      verdicts?: OrphanVerdict[];
      summary?:  { total: number; classA: number; classE: number; redisKeyExists: boolean; redisCategories: string[] };
      error?:    string;
    };
    if (res.ok && data.verdicts) {
      setRedisResult({ verdicts: data.verdicts, summary: data.summary! });
    } else {
      setRedisError(data.error ?? 'Redis 確認に失敗しました');
    }
    setRedisLoading(false);
  }

  // ── 候補の class A アイテム ────────────────────────────────────────────────
  const classAItems = redisResult?.verdicts.filter((v) => v.classification === 'A') ?? [];

  function toggleSelect(productId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setDryRunResult(null);
    setExecResult(null);
    setExecError('');
  }

  function selectAll()   { setSelectedIds(new Set(classAItems.map((v) => v.productId))); setDryRunResult(null); }
  function deselectAll() { setSelectedIds(new Set()); setDryRunResult(null); }

  // ── ID 診断: E判定の orphan productId と Redis item を照合（読み取り専用）──
  async function runIdDiagnosis() {
    if (!selectedPerson) return;
    setDiagLoading(true);
    setDiagError('');
    setDiagResult(null);
    const res = await fetch(
      `/api/admin/product-recovery?type=id-diagnosis&personName=${encodeURIComponent(selectedPerson)}`,
    );
    const data = (await res.json()) as IdDiagResult & { error?: string };
    if (res.ok) {
      setDiagResult(data);
    } else {
      setDiagError(data.error ?? 'ID診断に失敗しました');
    }
    setDiagLoading(false);
  }

  // ── 候補をまとめる ─────────────────────────────────────────────────────────
  function buildCandidates(): ProductRecoveryCandidate[] {
    return classAItems
      .filter((v) => selectedIds.has(v.productId) && v.redisCategory)
      .map((v) => ({ productId: v.productId, redisCategory: v.redisCategory! }));
  }

  // ── Dry-run ───────────────────────────────────────────────────────────────
  async function runDryRun() {
    if (!selectedPerson || selectedIds.size === 0) return;
    setDryRunLoading(true);
    setDryRunResult(null);
    setExecResult(null);
    setExecError('');
    const res = await fetch('/api/admin/product-recovery', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ personName: selectedPerson, candidates: buildCandidates(), dryRun: true }),
    });
    const data = (await res.json()) as DryRunResult & { error?: string };
    if (res.ok) {
      setDryRunResult(data);
      setIdempotencyKey(`product-recovery-${Date.now()}`);
    } else {
      setExecError(data.error ?? 'Dry-run に失敗しました');
    }
    setDryRunLoading(false);
  }

  // ── 実行 ──────────────────────────────────────────────────────────────────
  async function runExec() {
    if (!selectedPerson || !dryRunResult) return;
    if (!canExecuteProductRecovery({ confirmInput, reason, idempotencyKey, recoverableCount: dryRunResult.recoverableCount, recoveryEnabled })) return;
    setExecLoading(true);
    setExecError('');
    const res = await fetch('/api/admin/product-recovery', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        personName:     selectedPerson,
        candidates:     buildCandidates(),
        dryRun:         false,
        confirmToken:   'RECOVER_PRODUCTS',
        idempotencyKey: idempotencyKey.trim(),
        reason:         reason.trim(),
      }),
    });
    const data = (await res.json()) as ExecResult & { error?: string };
    if (res.ok && data.ok) {
      setExecResult(data);
      setSelectedIds(new Set());
      setDryRunResult(null);
      setConfirmInput('');
    } else {
      setExecError(data.error ?? '実行に失敗しました');
    }
    setExecLoading(false);
  }

  const canExec = !!dryRunResult && canExecuteProductRecovery({
    confirmInput,
    reason,
    idempotencyKey,
    recoverableCount: dryRunResult.recoverableCount,
    recoveryEnabled,
  });

  return (
    <div className="space-y-6">
      {/* ── サマリー ── */}
      <div className="flex items-center gap-4 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl text-sm">
        <span className="text-orange-700 font-semibold">孤立 verdict 合計:</span>
        <span className="text-2xl font-bold text-orange-600">{initialTotal.toLocaleString()} 件</span>
        <span className="text-xs text-orange-500">（商品データが DB に存在しない verdict — 孤立状態）</span>
      </div>

      {!recoveryEnabled && recoveryBlockReason && (
        <div className="px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-xl text-xs text-yellow-700">
          ⚠️ {recoveryBlockReason}
          {recoveryBlockReason.includes('Preview') && (
            <span className="ml-1">Dry-run のみ利用可能です。</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 人物一覧 ── */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            孤立 verdict がある人物 ({stats.length}人)
          </h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">人物名</th>
                  <th className="px-3 py-2 text-right text-gray-500">孤立件数</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-gray-400">孤立 verdict がありません</td>
                  </tr>
                ) : (
                  stats.map((s) => (
                    <tr
                      key={s.personName}
                      className={`border-t border-gray-100 ${selectedPerson === s.personName ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-3 py-2 font-medium">{s.personName}</td>
                      <td className="px-3 py-2 text-right font-mono text-orange-600 font-semibold">{s.orphanCount}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void loadDetail(s.personName)}
                          disabled={detailLoading}
                          className="px-2 py-1 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded transition-colors disabled:opacity-50"
                        >
                          詳細
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 人物の詳細 ── */}
        <div>
          {selectedPerson ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">{selectedPerson} の孤立 verdict</h3>
                <button
                  onClick={() => void checkRedis()}
                  disabled={redisLoading}
                  className="px-3 py-1.5 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {redisLoading ? 'Redis 確認中...' : 'Redis をスキャン'}
                </button>
              </div>

              {redisError && (
                <div className="text-xs text-red-600 px-3 py-2 bg-red-50 rounded-lg">{redisError}</div>
              )}

              {/* Redis スキャン結果サマリー */}
              {redisResult && (
                <div className="px-3 py-2 bg-purple-50 border border-purple-200 rounded-xl text-xs space-y-1">
                  <p className="font-semibold text-purple-700">Redis スキャン結果</p>
                  <div className="flex gap-4 flex-wrap">
                    <span>合計: <strong>{redisResult.summary.total}</strong></span>
                    <span className="text-green-700">A (Redis完全): <strong>{redisResult.summary.classA}</strong></span>
                    <span className="text-gray-600">E (データなし): <strong>{redisResult.summary.classE}</strong></span>
                  </div>
                  <p className="text-purple-500">
                    Redis キー存在: {redisResult.summary.redisKeyExists ? '✓' : '✗'}
                    {redisResult.summary.redisCategories.length > 0 && (
                      <> / カテゴリ: {redisResult.summary.redisCategories.join(', ')}</>
                    )}
                  </p>
                </div>
              )}

              {/* class A 候補の選択 */}
              {classAItems.length > 0 && (
                <div className="border border-green-200 rounded-xl overflow-hidden bg-green-50">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-green-200">
                    <span className="text-xs font-semibold text-green-700">
                      Redis 復旧候補 ({classAItems.length}件) — 選択して復旧
                    </span>
                    <button onClick={selectAll} className="ml-auto px-2 py-0.5 text-[10px] bg-green-100 hover:bg-green-200 text-green-700 rounded">全選択</button>
                    <button onClick={deselectAll} className="px-2 py-0.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 rounded">全解除</button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {classAItems.map((v) => (
                      <label
                        key={v.productId}
                        className="flex items-start gap-2 px-3 py-1.5 border-t border-green-100 hover:bg-green-100 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(v.productId)}
                          onChange={() => toggleSelect(v.productId)}
                          className="mt-0.5 accent-green-600"
                        />
                        <span className="text-xs flex-1 min-w-0">
                          <span className="font-mono text-gray-500 block truncate" title={v.productId}>{v.productId}</span>
                          {v.redisTitle && <span className="text-green-700 truncate block">{v.redisTitle.slice(0, 40)}</span>}
                          <span className="text-gray-400">{v.redisCategory}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Dry-run ボタン */}
              {selectedIds.size > 0 && !execResult && (
                <button
                  onClick={() => void runDryRun()}
                  disabled={dryRunLoading}
                  className="w-full py-2 text-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {dryRunLoading ? 'Dry-run 実行中...' : `Dry-run プレビュー (${selectedIds.size}件)`}
                </button>
              )}

              {/* Dry-run 結果 */}
              {dryRunResult && !execResult && (
                <div className="px-3 py-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs space-y-3">
                  <p className="font-semibold text-indigo-700">Dry-run 結果</p>
                  <div className="flex gap-4 flex-wrap">
                    <span className="text-green-700">復旧可能: <strong>{dryRunResult.recoverableCount}</strong></span>
                    <span className="text-gray-500">DB既存: <strong>{dryRunResult.alreadyInDbCount}</strong></span>
                    <span className="text-red-500">Redisなし: <strong>{dryRunResult.notInRedisCount}</strong></span>
                  </div>
                  {dryRunResult.preview.slice(0, 5).map((p) => (
                    <div key={p.productId} className="text-[10px] text-gray-600">
                      [{p.category}] {p.title.slice(0, 40)}
                    </div>
                  ))}
                  {dryRunResult.preview.length > 5 && (
                    <p className="text-[10px] text-gray-400">他 {dryRunResult.preview.length - 5} 件...</p>
                  )}

                  {dryRunResult.recoverableCount > 0 && recoveryEnabled && (
                    <div className="space-y-2 pt-2 border-t border-indigo-200">
                      <p className="text-indigo-600 font-semibold">実行するには以下を入力してください</p>
                      <input
                        type="text"
                        placeholder="実行理由（必須）"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                      />
                      <input
                        type="text"
                        placeholder="冪等性キー（自動生成済み・変更可）"
                        value={idempotencyKey}
                        onChange={(e) => setIdempotencyKey(e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                      />
                      <input
                        type="text"
                        placeholder='確認: "RECOVER_PRODUCTS" と入力'
                        value={confirmInput}
                        onChange={(e) => setConfirmInput(e.target.value)}
                        className={`w-full px-2 py-1 border rounded text-xs font-mono ${
                          confirmInput === 'RECOVER_PRODUCTS' ? 'border-green-400 bg-green-50' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={() => void runExec()}
                        disabled={!canExec || execLoading}
                        className="w-full py-2 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white rounded-lg disabled:cursor-not-allowed"
                      >
                        {execLoading ? '復旧実行中...' : `復旧実行 (${dryRunResult.recoverableCount}件)`}
                      </button>
                    </div>
                  )}
                  {dryRunResult.recoverableCount > 0 && !recoveryEnabled && (
                    <p className="text-yellow-600 text-[10px]">
                      ⚠️ {recoveryBlockReason ?? '実行不可（dry-run のみ）'}
                    </p>
                  )}
                </div>
              )}

              {/* ── ID 診断パネル（読み取り専用） ── */}
              {redisResult && redisResult.summary.classE > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-700">
                      🔬 ID診断（E判定 {redisResult.summary.classE} 件）— 読み取り専用
                    </span>
                    <button
                      onClick={() => void runIdDiagnosis()}
                      disabled={diagLoading}
                      className="ml-auto px-3 py-1 text-xs bg-gray-700 hover:bg-gray-800 text-white rounded disabled:opacity-50"
                    >
                      {diagLoading ? '診断中...' : 'ID照合診断を実行'}
                    </button>
                  </div>

                  {diagError && (
                    <div className="px-3 py-2 text-xs text-red-600 bg-red-50">{diagError}</div>
                  )}

                  {diagResult && (
                    <div className="p-3 space-y-4 text-xs">
                      {/* サマリー */}
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="px-2 py-1.5 bg-gray-50 rounded">
                          <div className="text-gray-500">Redis商品数</div>
                          <div className="font-bold text-gray-800">{diagResult.summary.redisItemTotal} 件</div>
                        </div>
                        <div className={`px-2 py-1.5 rounded ${diagResult.summary.redisItemsWithNoId > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                          <div className="text-gray-500">id フィールド欠損</div>
                          <div className={`font-bold ${diagResult.summary.redisItemsWithNoId > 0 ? 'text-red-700' : 'text-green-700'}`}>
                            {diagResult.summary.redisItemsWithNoId} 件
                            {diagResult.summary.redisItemsWithNoId > 0 && ' ⚠️'}
                          </div>
                        </div>
                        <div className={`px-2 py-1.5 rounded ${diagResult.summary.no_match === diagResult.summary.diagnosedCount ? 'bg-red-50' : 'bg-yellow-50'}`}>
                          <div className="text-gray-500">no_match（先頭10件）</div>
                          <div className={`font-bold ${diagResult.summary.no_match === diagResult.summary.diagnosedCount ? 'text-red-700' : 'text-yellow-700'}`}>
                            {diagResult.summary.no_match} / {diagResult.summary.diagnosedCount}
                          </div>
                        </div>
                        <div className={`px-2 py-1.5 rounded ${diagResult.summary.suffix_match > 0 || diagResult.summary.item_code_match > 0 ? 'bg-orange-50' : 'bg-gray-50'}`}>
                          <div className="text-gray-500">suffix / prefix不一致</div>
                          <div className="font-bold text-orange-700">
                            {diagResult.summary.suffix_match + diagResult.summary.item_code_match}
                          </div>
                        </div>
                      </div>

                      {/* 判定 */}
                      <IdDiagVerdict summary={diagResult.summary} />

                      {/* E判定orphanId vs Redis 比較表 */}
                      <div>
                        <p className="font-semibold text-gray-600 mb-1">
                          E判定 先頭{diagResult.summary.diagnosedCount}件の照合結果
                        </p>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[10px] border border-gray-200 rounded">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-2 py-1 text-left text-gray-500 whitespace-nowrap">orphan productId</th>
                                <th className="px-2 py-1 text-left text-gray-500 whitespace-nowrap">suffix</th>
                                <th className="px-2 py-1 text-left text-gray-500 whitespace-nowrap">照合結果</th>
                                <th className="px-2 py-1 text-left text-gray-500 whitespace-nowrap">マッチしたid</th>
                                <th className="px-2 py-1 text-left text-gray-500 whitespace-nowrap">商品タイトル</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diagResult.diagnoses.map((d) => (
                                <tr key={d.orphanId} className="border-t border-gray-100">
                                  <td className="px-2 py-1 font-mono text-gray-600 whitespace-nowrap">{d.orphanId}</td>
                                  <td className="px-2 py-1 font-mono text-gray-500 whitespace-nowrap">{d.suffix}</td>
                                  <td className="px-2 py-1 whitespace-nowrap">
                                    <MatchBadge type={d.matchType} />
                                  </td>
                                  <td className="px-2 py-1 font-mono text-gray-500 whitespace-nowrap max-w-[120px] truncate">
                                    {d.matchedId ?? '—'}
                                  </td>
                                  <td className="px-2 py-1 text-gray-700 max-w-[140px] truncate" title={d.matchedTitle ?? ''}>
                                    {d.matchedTitle ?? '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Redis サンプル（id フィールドと itemUrl を確認） */}
                      <div>
                        <p className="font-semibold text-gray-600 mb-1">
                          Redis 商品サンプル（カテゴリ別先頭3件）
                        </p>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-[10px] border border-gray-200 rounded">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-2 py-1 text-left text-gray-500">カテゴリ</th>
                                <th className="px-2 py-1 text-left text-gray-500">item.id</th>
                                <th className="px-2 py-1 text-left text-gray-500">URLの末尾セグメント</th>
                                <th className="px-2 py-1 text-left text-gray-500">商品タイトル</th>
                              </tr>
                            </thead>
                            <tbody>
                              {diagResult.redisSample.map((s, i) => (
                                <tr key={i} className="border-t border-gray-100">
                                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{s.category}</td>
                                  <td className={`px-2 py-1 font-mono whitespace-nowrap ${!s.id ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                                    {s.id ?? '(null)'}
                                  </td>
                                  <td className="px-2 py-1 font-mono text-gray-500 whitespace-nowrap">{s.lastSegment || '(空)'}</td>
                                  <td className="px-2 py-1 text-gray-700 max-w-[140px] truncate" title={s.title}>
                                    {s.title}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {diagResult.summary.redisItemsWithNoId > 0 && (
                          <p className="mt-1 text-[10px] text-red-600">
                            ⚠️ {diagResult.summary.redisItemsWithNoId} 件の Redis 商品に id フィールドがありません（stableId 導入前に保存されたデータの可能性）
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {execError && (
                <div className="text-xs text-red-600 px-3 py-2 bg-red-50 rounded-lg">{execError}</div>
              )}

              {/* 実行完了 */}
              {execResult && (
                <div className="px-3 py-3 bg-green-50 border border-green-300 rounded-xl text-xs">
                  <p className="font-semibold text-green-700">復旧完了</p>
                  <p>復旧: <strong>{execResult.recovered}</strong> 件 / スキップ: {execResult.skipped} 件</p>
                  <p className="font-mono text-gray-500 mt-1">key: {execResult.idempotencyKey}</p>
                </div>
              )}

              {/* 孤立 verdict 詳細リスト */}
              {detailLoading ? (
                <p className="text-sm text-gray-400">読み込み中...</p>
              ) : detail !== null ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[280px] overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500">productId</th>
                        <th className="px-3 py-2 text-left text-gray-500">verdict</th>
                        <th className="px-3 py-2 text-left text-gray-500">分類</th>
                        <th className="px-3 py-2 text-left text-gray-500">Redis情報</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((v) => {
                        const redis = redisResult?.verdicts.find((r) => r.productId === v.productId);
                        const cls   = redis?.classification ?? v.classification;
                        return (
                          <tr key={v.productId} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 font-mono text-gray-500 max-w-[140px] truncate" title={v.productId}>
                              {v.productId}
                            </td>
                            <td className={`px-3 py-1.5 font-mono whitespace-nowrap ${v.verdict === 'related' ? 'text-green-700' : 'text-gray-500'}`}>
                              {v.verdict}
                            </td>
                            <td className="px-3 py-1.5"><ClassBadge cls={cls} /></td>
                            <td className="px-3 py-1.5 text-gray-500 max-w-[140px] truncate" title={redis?.redisTitle ?? ''}>
                              {redis?.redisTitle ? <span className="text-green-700">{redis.redisTitle.slice(0, 28)}</span> : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
              左から人物を選択してください
            </div>
          )}
        </div>
      </div>

      {/* ── 分類凡例 ── */}
      <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs">
        <p className="font-semibold text-gray-600 mb-2">分類凡例</p>
        <div className="flex flex-wrap gap-4">
          <span><ClassBadge cls="A" /> Redis に完全な商品情報あり → 選択して復旧可能</span>
          <span><ClassBadge cls="E" /> データなし → 完全消失（楽天バッチ再取得のみ）</span>
          <span><ClassBadge cls="pending" /> 未確認（「Redis をスキャン」で分類）</span>
        </div>
      </div>
    </div>
  );
}

// ── ID診断用コンポーネント ─────────────────────────────────────────────────────

type MatchType = 'exact_id_match' | 'normalized_url_match' | 'item_code_match' | 'suffix_match' | 'no_match';

function MatchBadge({ type }: { type: MatchType }) {
  const map: Record<MatchType, string> = {
    exact_id_match:       'bg-green-100 text-green-700',
    normalized_url_match: 'bg-blue-100 text-blue-700',
    item_code_match:      'bg-orange-100 text-orange-700',
    suffix_match:         'bg-yellow-100 text-yellow-700',
    no_match:             'bg-red-100 text-red-700',
  };
  const labels: Record<MatchType, string> = {
    exact_id_match:       'exact_id ✓',
    normalized_url_match: 'url_match',
    item_code_match:      'prefix違い',
    suffix_match:         'suffix一致',
    no_match:             'no_match ✗',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${map[type]}`}>
      {labels[type]}
    </span>
  );
}

function IdDiagVerdict({ summary }: {
  summary: IdDiagResult['summary'];
}) {
  const allNoMatch    = summary.no_match === summary.diagnosedCount && summary.diagnosedCount > 0;
  const hasSuffixHit  = summary.suffix_match > 0 || summary.item_code_match > 0;
  const hasNoIdField  = summary.redisItemsWithNoId > 0;
  const hasRedisItems = summary.redisItemTotal > 0;

  let verdict = '';
  let color   = '';

  if (!hasRedisItems) {
    verdict = '⚠️ Redis に商品データなし — 真のデータ消失';
    color   = 'text-red-700 bg-red-50 border-red-200';
  } else if (hasNoIdField && summary.redisItemsWithNoId === summary.redisItemTotal) {
    verdict = '🔴 Redis 全商品に id フィールドなし — stableId 導入前のデータ保存が原因（IDフォーマット不一致）';
    color   = 'text-orange-700 bg-orange-50 border-orange-200';
  } else if (hasNoIdField) {
    verdict = '🟠 一部の Redis 商品に id フィールドなし — 古い保存データと新しいデータが混在（ID不一致の可能性）';
    color   = 'text-orange-700 bg-orange-50 border-orange-200';
  } else if (allNoMatch && !hasSuffixHit) {
    verdict = '🔴 完全な no_match — Redis に同一商品なし（真のデータ消失または楽天URLの大幅変更）';
    color   = 'text-red-700 bg-red-50 border-red-200';
  } else if (hasSuffixHit) {
    verdict = '🟠 suffix/prefix 不一致あり — 同一商品がカテゴリ違いまたはprefix変更で別IDになっている可能性';
    color   = 'text-orange-700 bg-orange-50 border-orange-200';
  } else if (summary.exact_id_match > 0) {
    verdict = '🟢 一部 exact_id_match あり — 診断対象外の verdict に問題がある可能性';
    color   = 'text-green-700 bg-green-50 border-green-200';
  } else {
    verdict = '⚠️ 判定不明 — 上のデータを確認してください';
    color   = 'text-yellow-700 bg-yellow-50 border-yellow-200';
  }

  return (
    <div className={`px-3 py-2 border rounded text-[11px] font-semibold ${color}`}>
      診断結果: {verdict}
    </div>
  );
}

function ClassBadge({ cls }: { cls: OrphanVerdict['classification'] }) {
  const map: Record<string, string> = {
    A:       'bg-green-100 text-green-700',
    B:       'bg-blue-100 text-blue-700',
    C:       'bg-yellow-100 text-yellow-700',
    D:       'bg-orange-100 text-orange-700',
    E:       'bg-red-100 text-red-600',
    pending: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = {
    A: 'A: Redis完全', B: 'B: バックアップ', C: 'C: 別カテゴリ',
    D: 'D: 別ID', E: 'E: なし', pending: '未確認',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${map[cls] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[cls] ?? cls}
    </span>
  );
}
