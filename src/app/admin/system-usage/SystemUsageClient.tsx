'use client';

import { useState, useCallback } from 'react';
import type {
  SystemUsageReport,
  ServiceUsage,
  ServiceMetric,
  SnapshotTrend,
  UsageStatus,
} from '@/lib/system-usage/types';

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number | null): string {
  if (bytes === null) return '─';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtNum(n: number | null, unit = ''): string {
  if (n === null) return '─';
  if (unit === 'bytes') return fmtBytes(n);
  if (unit === 'USD') return `$${n.toFixed(4)}`;
  if (unit === 'seconds') {
    if (n >= 3600) return `${(n / 3600).toFixed(1)}h`;
    if (n >= 60) return `${(n / 60).toFixed(1)}m`;
    return `${n.toFixed(0)}s`;
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ${unit}`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K ${unit}`;
  return `${n.toLocaleString()} ${unit}`.trim();
}

function fmtPercent(p: number | null): string {
  if (p === null) return '─';
  return `${p}%`;
}

function fmtDelta(v: number | null, unit: string): string {
  if (v === null) return '─';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${fmtNum(v, unit)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '─';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

// ── Status colors ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<UsageStatus, { bar: string; badge: string; text: string }> = {
  ok:          { bar: 'bg-green-500',  badge: 'bg-green-100 text-green-700',  text: '正常' },
  warning:     { bar: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700', text: '注意' },
  alert:       { bar: 'bg-orange-400', badge: 'bg-orange-100 text-orange-700', text: '警告' },
  critical:    { bar: 'bg-red-500',    badge: 'bg-red-100 text-red-700',       text: '重大' },
  exceeded:    { bar: 'bg-red-700',    badge: 'bg-red-200 text-red-800',       text: '上限超過' },
  fetch_error: { bar: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-500',     text: '取得失敗' },
  unknown:     { bar: 'bg-gray-300',   badge: 'bg-gray-100 text-gray-500',     text: '情報なし' },
};

// ── Progress Bar ──────────────────────────────────────────────────────────────

function UsageBar({ pct, status }: { pct: number | null; status: UsageStatus }) {
  if (pct === null) {
    return <div className="h-2 bg-gray-100 rounded-full w-full" />;
  }
  const clamped = Math.min(pct, 100);
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.ok;
  return (
    <div className="h-2 bg-gray-100 rounded-full w-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${style.bar}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

// ── Metric Row ─────────────────────────────────────────────────────────────────

function MetricRow({ m, status }: { m: ServiceMetric; status: UsageStatus }) {
  return (
    <div className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-600 flex items-center gap-1">
          {m.label}
          {m.isEstimated && (
            <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1 rounded">推定</span>
          )}
          {m.source === 'api' && (
            <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-200 px-1 rounded">API</span>
          )}
        </span>
        <span className="font-medium text-gray-800">{fmtNum(m.value, m.unit)}</span>
      </div>
      {m.limit != null && (
        <div className="flex items-center gap-2">
          <UsageBar pct={m.usagePercent} status={status} />
          <span className="text-[10px] text-gray-400 whitespace-nowrap">
            {fmtPercent(m.usagePercent)} / {fmtNum(m.limit, m.unit)}
          </span>
        </div>
      )}
      {m.note && <p className="text-[10px] text-gray-400 mt-1">{m.note}</p>}
    </div>
  );
}

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({
  svc,
  onClick,
  active,
}: {
  svc: ServiceUsage;
  onClick: () => void;
  active: boolean;
}) {
  const style = STATUS_STYLES[svc.status] ?? STATUS_STYLES.unknown;
  const worstPct = svc.metrics
    .map((m) => m.usagePercent)
    .filter((p): p is number => p !== null)
    .reduce<number | null>((max, p) => (max === null || p > max ? p : max), null);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left bg-white rounded-lg border p-4 transition-all ${
        active ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-semibold text-sm text-gray-800">{svc.displayName}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{svc.purpose}</p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0 ${style.badge}`}>
          {style.text}
        </span>
      </div>

      {svc.metrics.length > 0 && worstPct !== null && (
        <div className="mb-2">
          <UsageBar pct={worstPct} status={svc.status} />
          <p className="text-[10px] text-gray-400 mt-1">最大使用率 {fmtPercent(worstPct)}</p>
        </div>
      )}

      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          {svc.currentMonthlyCostUsd != null ? `$${svc.currentMonthlyCostUsd.toFixed(4)}/月` : '料金不明'}
          {svc.projectedMonthlyCostUsd != null && svc.projectedMonthlyCostUsd !== svc.currentMonthlyCostUsd && (
            <span className="text-gray-400 ml-1">（予測 ${svc.projectedMonthlyCostUsd.toFixed(4)}）</span>
          )}
        </span>
        {svc.plan && <span className="bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded">{svc.plan}</span>}
      </div>

      {svc.fetchError && (
        <p className="text-[10px] text-red-500 mt-2 line-clamp-2">{svc.fetchError}</p>
      )}
    </button>
  );
}

// ── Detail Panel: Overview ────────────────────────────────────────────────────

function OverviewPanel({ svc }: { svc: ServiceUsage }) {
  const style = STATUS_STYLES[svc.status] ?? STATUS_STYLES.unknown;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="bg-white border border-gray-200 rounded-lg p-3 min-w-[140px]">
          <p className="text-[10px] text-gray-500">状態</p>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${style.badge}`}>{style.text}</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 min-w-[140px]">
          <p className="text-[10px] text-gray-500">プラン</p>
          <p className="text-sm font-medium text-gray-800">{svc.plan ?? '不明'}</p>
          {svc.planSource === 'api' && <span className="text-[10px] text-blue-600">API取得</span>}
          {svc.planSource === 'unavailable' && <span className="text-[10px] text-gray-400">取得不可</span>}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 min-w-[140px]">
          <p className="text-[10px] text-gray-500">今月の費用</p>
          <p className="text-sm font-medium text-gray-800">
            {svc.currentMonthlyCostUsd != null ? `$${svc.currentMonthlyCostUsd.toFixed(4)}` : '─'}
          </p>
          {svc.projectedMonthlyCostUsd != null && (
            <p className="text-[10px] text-gray-400">月末予測: ${svc.projectedMonthlyCostUsd.toFixed(4)}</p>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 min-w-[180px]">
          <p className="text-[10px] text-gray-500">最終取得</p>
          <p className="text-xs text-gray-700">{fmtDate(svc.fetchedAt)}</p>
        </div>
      </div>

      {svc.metrics.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">使用量メトリクス</p>
          {svc.metrics.map((m) => (
            <MetricRow key={m.label} m={m} status={svc.status} />
          ))}
        </div>
      )}

      {svc.fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-red-700 mb-1">取得エラー</p>
          <p className="text-xs text-red-600 break-all">{svc.fetchError}</p>
        </div>
      )}

      {svc.dashboardUrl && (
        <a
          href={svc.dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          公式ダッシュボードを開く →
        </a>
      )}
    </div>
  );
}

// ── Detail Panel: Neon ────────────────────────────────────────────────────────

interface TableStat {
  tableName: string;
  category: string;
  totalBytes: number;
  dataBytes: number;
  indexesBytes: number;
  rowCount: number;
}

function NeonDetailPanel({ svc }: { svc: ServiceUsage }) {
  const tables = (svc.details.tables as TableStat[] | undefined) ?? [];
  const categories = [...new Set(tables.map((t) => t.category))];

  return (
    <div className="space-y-4">
      <OverviewPanel svc={svc} />

      {tables.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-gray-600 px-4 py-2 border-b border-gray-100">テーブル別容量</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">テーブル名</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">カテゴリ</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">合計サイズ</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">データ</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">インデックス</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">行数（概算）</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t.tableName} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-700">{t.tableName}</td>
                    <td className="px-3 py-2 text-gray-500">{t.category}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{fmtBytes(t.totalBytes)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtBytes(t.dataBytes)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{fmtBytes(t.indexesBytes)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{t.rowCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {categories.length > 1 && (
            <div className="p-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-600 mb-2">カテゴリ別集計</p>
              <div className="space-y-1">
                {categories.map((cat) => {
                  const catTables = tables.filter((t) => t.category === cat);
                  const catBytes = catTables.reduce((s, t) => s + t.totalBytes, 0);
                  const catRows = catTables.reduce((s, t) => s + t.rowCount, 0);
                  return (
                    <div key={cat} className="flex items-center justify-between text-xs text-gray-600">
                      <span>{cat}</span>
                      <span>{fmtBytes(catBytes)} / {catRows.toLocaleString()}行</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail Panel: Redis ───────────────────────────────────────────────────────

function RedisDetailPanel({ svc }: { svc: ServiceUsage }) {
  const breakdown = (svc.details.prefixBreakdown as Record<string, number> | undefined) ?? {};
  const isSampled = svc.details.isSampled as boolean | undefined;
  const sampledKeys = svc.details.sampledKeys as number | undefined;
  const keyCount = svc.details.keyCount as number | undefined;

  return (
    <div className="space-y-4">
      <OverviewPanel svc={svc} />

      {Object.keys(breakdown).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-1">
            キープレフィックス別分布
            {isSampled && (
              <span className="ml-2 text-amber-600 font-normal">
                ※推定値（{sampledKeys}/{keyCount}件をサンプリング）
              </span>
            )}
          </p>
          <div className="space-y-2 mt-2">
            {Object.entries(breakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([prefix, count]) => {
                const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={prefix}>
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-0.5">
                      <span className="font-mono">{prefix}</span>
                      <span>{count.toLocaleString()}件 ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Panel: OpenAI ──────────────────────────────────────────────────────

function OpenAIDetailPanel({ svc }: { svc: ServiceUsage }) {
  const byFeature = (svc.details.byFeature as Array<{ feature: string; label: string; costUsd: number; requests: number }> | undefined) ?? [];
  const byModel = (svc.details.byModel as Array<{ model: string; costUsd: number; requests: number }> | undefined) ?? [];
  const budgetUsd = svc.details.budgetUsd as number | null | undefined;
  const exchangeRate = svc.details.exchangeRate as number | undefined;
  const successRate = svc.details.successRate as number | null | undefined;

  return (
    <div className="space-y-4">
      <OverviewPanel svc={svc} />

      {(successRate != null || exchangeRate != null || budgetUsd != null) && (
        <div className="flex flex-wrap gap-3">
          {successRate != null && (
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">成功率</p>
              <p className="text-sm font-medium text-gray-800">{successRate}%</p>
            </div>
          )}
          {budgetUsd != null && (
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">月次予算</p>
              <p className="text-sm font-medium text-gray-800">${budgetUsd.toFixed(2)}</p>
              {exchangeRate != null && (
                <p className="text-[10px] text-gray-400">
                  ≒ ¥{Math.round(budgetUsd * exchangeRate).toLocaleString()}（レート: {exchangeRate}）
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {byFeature.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-gray-600 px-4 py-2 border-b border-gray-100">機能別コスト</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">機能</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">リクエスト数</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">コスト(USD)</th>
                </tr>
              </thead>
              <tbody>
                {byFeature.map((f) => (
                  <tr key={f.feature} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{f.label}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{f.requests.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-700">${f.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {byModel.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <p className="text-xs font-semibold text-gray-600 px-4 py-2 border-b border-gray-100">モデル別コスト</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">モデル</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">リクエスト数</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">コスト(USD)</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map((m) => (
                  <tr key={m.model} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-gray-700">{m.model}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{m.requests.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-700">${m.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail Panel: External APIs ───────────────────────────────────────────────

function ExternalApiPanel({ svc }: { svc: ServiceUsage }) {
  const endpoints = svc.details.endpoints as string[] | undefined;
  const licenseNote = svc.details.licenseNote as string | null | undefined;
  const rateLimitNote = svc.details.rateLimitNote as string | undefined;
  const usageNote = svc.details.usageNote as string | undefined;
  const billingNote = svc.details.billingNote as string | undefined;

  return (
    <div className="space-y-4">
      <OverviewPanel svc={svc} />

      {endpoints && endpoints.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">使用エンドポイント</p>
          <ul className="space-y-1">
            {endpoints.map((ep) => (
              <li key={ep} className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded">{ep}</li>
            ))}
          </ul>
        </div>
      )}

      {(licenseNote || rateLimitNote || usageNote || billingNote) && (
        <div className="space-y-2">
          {licenseNote && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700">{licenseNote}</p>
            </div>
          )}
          {rateLimitNote && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">{rateLimitNote}</p>
            </div>
          )}
          {usageNote && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600">{usageNote}</p>
            </div>
          )}
          {billingNote && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-600">{billingNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail Panel: Vercel ──────────────────────────────────────────────────────

function VercelDetailPanel({ svc }: { svc: ServiceUsage }) {
  const cronPaths = svc.details.cronPaths as string[] | undefined;
  const usageNote = svc.details.usageNote as string | undefined;
  const billingUrl = svc.details.billingUrl as string | undefined;
  const projectName = svc.details.projectName as string | undefined;
  const framework = svc.details.framework as string | undefined;
  const nodeVersion = svc.details.nodeVersion as string | undefined;

  return (
    <div className="space-y-4">
      <OverviewPanel svc={svc} />

      {(projectName || framework || nodeVersion) && (
        <div className="flex flex-wrap gap-3">
          {projectName && (
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">プロジェクト名</p>
              <p className="text-sm font-medium text-gray-800">{projectName}</p>
            </div>
          )}
          {framework && (
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">フレームワーク</p>
              <p className="text-sm font-medium text-gray-800">{framework}</p>
            </div>
          )}
          {nodeVersion && (
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-[10px] text-gray-500">Node.js</p>
              <p className="text-sm font-medium text-gray-800">{nodeVersion}</p>
            </div>
          )}
        </div>
      )}

      {cronPaths && cronPaths.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-600 mb-2">Cronジョブ ({cronPaths.length}件)</p>
          <ul className="space-y-1">
            {cronPaths.map((path) => (
              <li key={path} className="text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded">{path}</li>
            ))}
          </ul>
        </div>
      )}

      {(usageNote || billingUrl) && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          {usageNote && <p className="text-xs text-gray-600">{usageNote}</p>}
          {billingUrl && (
            <a href={billingUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline">
              Vercel 使用量ダッシュボード →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trends Panel ──────────────────────────────────────────────────────────────

function TrendsPanel({ trends }: { trends: SnapshotTrend[] }) {
  if (trends.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-500">スナップショットデータがありません。</p>
        <p className="text-xs text-gray-400 mt-1">「最新情報を取得」ボタンを押すと保存が開始されます。7日以上のデータが蓄積されると推移が表示されます。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {trends.filter((t) => !t.dataInsufficient).map((t) => (
        <div key={`${t.service}-${t.metric}`} className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">{t.service} / {t.metric}</p>
            <span className="text-[10px] text-gray-400">{t.unit}</span>
          </div>

          {/* Mini sparkline using CSS bars */}
          {t.history.length > 1 && (
            <div className="flex items-end gap-0.5 h-12 mb-2">
              {(() => {
                const vals = t.history.map((p) => p.value);
                const max = Math.max(...vals);
                const min = Math.min(...vals);
                const range = max - min || 1;
                return t.history.map((p) => (
                  <div
                    key={p.recordedAt}
                    title={`${p.recordedAt}: ${fmtNum(p.value, t.unit)}`}
                    className="flex-1 bg-blue-400 rounded-t-sm min-w-0"
                    style={{ height: `${Math.max(4, ((p.value - min) / range) * 100)}%` }}
                  />
                ));
              })()}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            {t.change7d != null && (
              <div>
                <span className="text-gray-400">7日間変化: </span>
                <span className={t.change7d >= 0 ? 'text-red-500' : 'text-green-600'}>
                  {fmtDelta(t.change7d, t.unit)}
                </span>
              </div>
            )}
            {t.change30d != null && (
              <div>
                <span className="text-gray-400">30日間変化: </span>
                <span className={t.change30d >= 0 ? 'text-red-500' : 'text-green-600'}>
                  {fmtDelta(t.change30d, t.unit)}
                </span>
              </div>
            )}
            {t.dailyAvgIncrease != null && (
              <div>
                <span className="text-gray-400">日平均増加: </span>
                <span className="text-gray-700">{fmtNum(t.dailyAvgIncrease, t.unit)}</span>
              </div>
            )}
            {t.projectedLimitDate && (
              <div>
                <span className="text-gray-400">上限到達予測: </span>
                <span className="text-orange-600 font-medium">{t.projectedLimitDate}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      {trends.filter((t) => t.dataInsufficient).length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-xs text-gray-500">
            データ不足（7日未満）のメトリクスは予測非表示:&nbsp;
            {trends
              .filter((t) => t.dataInsufficient)
              .map((t) => `${t.service}/${t.metric}`)
              .join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

const ENV_VARS_INFO: Array<{ name: string; required: boolean; purpose: string }> = [
  { name: 'DATABASE_URL',              required: true,  purpose: 'Neon PostgreSQL接続' },
  { name: 'UPSTASH_REDIS_REST_URL',    required: true,  purpose: 'Upstash Redis接続' },
  { name: 'UPSTASH_REDIS_REST_TOKEN',  required: true,  purpose: 'Upstash Redis認証' },
  { name: 'OPENAI_API_KEY',            required: true,  purpose: 'OpenAI API認証' },
  { name: 'TMDB_API_KEY',              required: true,  purpose: 'TMDb API認証' },
  { name: 'RAKUTEN_APP_ID',            required: true,  purpose: '楽天API認証' },
  { name: 'NEON_API_KEY',              required: false, purpose: 'Neon管理API（ストレージ/コンピュート上限取得）' },
  { name: 'NEON_PROJECT_ID',           required: false, purpose: 'NeonプロジェクトID（管理API用）' },
  { name: 'UPSTASH_API_KEY',           required: false, purpose: 'Upstash管理API（帯域・データサイズ上限取得）' },
  { name: 'UPSTASH_EMAIL',             required: false, purpose: 'Upstash管理API認証' },
  { name: 'UPSTASH_DATABASE_ID',       required: false, purpose: 'UpstashデータベースID' },
  { name: 'OPENAI_ADMIN_API_KEY',      required: false, purpose: 'OpenAI Admin API（公式使用量取得・将来対応）' },
  { name: 'OPENAI_MONTHLY_BUDGET_JPY', required: false, purpose: 'OpenAI月次予算（円）' },
  { name: 'USD_JPY_MANUAL_RATE',       required: false, purpose: '手動為替レート（デフォルト: 150）' },
  { name: 'VERCEL_ACCESS_TOKEN',       required: false, purpose: 'Vercel API（プロジェクト情報取得）' },
  { name: 'VERCEL_PROJECT_ID',         required: false, purpose: 'VercelプロジェクトID' },
  { name: 'VERCEL_TEAM_ID',            required: false, purpose: 'VercelチームID（チームプラン時）' },
  { name: 'TMDB_LICENSE_TYPE',         required: false, purpose: 'TMDbライセンス状態（non_commercial/commercial_pending/commercial）' },
  { name: 'TMDB_CONTRACT_RENEWAL_DATE', required: false, purpose: 'TMDb契約更新日（YYYY-MM-DD）' },
];

function SettingsPanel({ report }: { report: SystemUsageReport }) {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <p className="text-xs font-semibold text-gray-600 px-4 py-2 border-b border-gray-100">
          環境変数一覧（値は非表示）
        </p>
        <div className="divide-y divide-gray-50">
          {ENV_VARS_INFO.map(({ name, required, purpose }) => (
            <div key={name} className="flex items-start gap-3 px-4 py-2">
              <span className={`text-[10px] px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0 ${
                required
                  ? 'bg-red-50 text-red-600 border border-red-200'
                  : 'bg-gray-50 text-gray-500 border border-gray-200'
              }`}>
                {required ? '必須' : '任意'}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-mono text-gray-700">{name}</p>
                <p className="text-[11px] text-gray-400">{purpose}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-gray-600 mb-2">取得状態サマリー</p>
        <div className="space-y-2">
          {report.services.map((svc) => (
            <div key={svc.serviceId} className="flex items-center justify-between text-xs">
              <span className="text-gray-700">{svc.displayName}</span>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES[svc.status].badge}`}>
                  {STATUS_STYLES[svc.status].text}
                </span>
                {svc.planSource === 'api' && (
                  <span className="text-[10px] text-blue-600">API取得済み</span>
                )}
                {svc.planSource === 'unavailable' && !svc.fetchError && (
                  <span className="text-[10px] text-gray-400">API取得不可</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type TabId = 'overview' | 'neon' | 'redis' | 'openai' | 'vercel' | 'external' | 'trends' | 'settings';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: '概要' },
  { id: 'neon',     label: 'Neon DB' },
  { id: 'redis',    label: 'Redis' },
  { id: 'openai',   label: 'OpenAI' },
  { id: 'vercel',   label: 'Vercel' },
  { id: 'external', label: '外部API' },
  { id: 'trends',   label: '使用量推移' },
  { id: 'settings', label: '設定・状態' },
];

export default function SystemUsageClient() {
  const [report, setReport] = useState<SystemUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      if (force) {
        const res = await fetch('/api/admin/system-usage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refresh' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setReport(data as SystemUsageReport);
      } else {
        const res = await fetch('/api/admin/system-usage');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setReport(data as SystemUsageReport);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-load on mount
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    setLoaded(true);
    load(false);
  }

  const selectedService = report?.services.find((s) => s.serviceId === selectedServiceId) ?? null;

  function renderDetail(svc: ServiceUsage): React.ReactNode {
    switch (svc.serviceId) {
      case 'neon':    return <NeonDetailPanel svc={svc} />;
      case 'redis':   return <RedisDetailPanel svc={svc} />;
      case 'openai':  return <OpenAIDetailPanel svc={svc} />;
      case 'vercel':  return <VercelDetailPanel svc={svc} />;
      case 'tmdb':
      case 'rakuten': return <ExternalApiPanel svc={svc} />;
      default:        return <OverviewPanel svc={svc} />;
    }
  }

  function renderTabContent(): React.ReactNode {
    if (!report) return null;

    switch (activeTab) {
      case 'overview':
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {report.services.map((svc) => (
              <ServiceCard
                key={svc.serviceId}
                svc={svc}
                active={selectedServiceId === svc.serviceId}
                onClick={() => {
                  setSelectedServiceId(svc.serviceId);
                  const tabMap: Record<string, TabId> = {
                    neon:    'neon',
                    redis:   'redis',
                    openai:  'openai',
                    vercel:  'vercel',
                    tmdb:    'external',
                    rakuten: 'external',
                  };
                  setActiveTab(tabMap[svc.serviceId] ?? 'overview');
                }}
              />
            ))}
          </div>
        );
      case 'neon': {
        const svc = report.services.find((s) => s.serviceId === 'neon');
        return svc ? <NeonDetailPanel svc={svc} /> : null;
      }
      case 'redis': {
        const svc = report.services.find((s) => s.serviceId === 'redis');
        return svc ? <RedisDetailPanel svc={svc} /> : null;
      }
      case 'openai': {
        const svc = report.services.find((s) => s.serviceId === 'openai');
        return svc ? <OpenAIDetailPanel svc={svc} /> : null;
      }
      case 'vercel': {
        const svc = report.services.find((s) => s.serviceId === 'vercel');
        return svc ? <VercelDetailPanel svc={svc} /> : null;
      }
      case 'external':
        return (
          <div className="space-y-6">
            {(['tmdb', 'rakuten'] as const).map((id) => {
              const svc = report.services.find((s) => s.serviceId === id);
              return svc ? (
                <div key={id}>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">{svc.displayName}</h3>
                  <ExternalApiPanel svc={svc} />
                </div>
              ) : null;
            })}
          </div>
        );
      case 'trends':
        return <TrendsPanel trends={report.trends} />;
      case 'settings':
        return <SettingsPanel report={report} />;
      default:
        return null;
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">システム使用量</h1>
        <p className="text-sm text-gray-500 mt-1">インフラ・DB・外部APIの容量・使用量・料金を一元管理</p>
      </div>

      {/* Summary bar */}
      {report && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">今月の推定総額</p>
            <p className="text-lg font-bold text-gray-800">
              {report.totalEstimatedCostUsd != null
                ? `$${report.totalEstimatedCostUsd.toFixed(4)}`
                : '─'}
            </p>
            <p className="text-[10px] text-gray-400">※計測可能分のみ</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">警告中</p>
            <p className={`text-lg font-bold ${report.warningCount > 0 ? 'text-orange-500' : 'text-gray-800'}`}>
              {report.warningCount}件
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">取得失敗</p>
            <p className={`text-lg font-bold ${report.fetchErrorCount > 0 ? 'text-red-500' : 'text-gray-800'}`}>
              {report.fetchErrorCount}件
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <p className="text-[10px] text-gray-500">最終更新</p>
            <p className="text-xs font-medium text-gray-700">{fmtDate(report.generatedAt)}</p>
            {report.cacheHit && report.cacheExpiresAt && (
              <p className="text-[10px] text-blue-500">
                キャッシュ（期限: {fmtDate(report.cacheExpiresAt)}）
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {refreshing ? '取得中...' : '最新情報を取得'}
        </button>
        {report && !report.cacheHit && (
          <span className="text-[11px] text-gray-400">リアルタイムデータ</span>
        )}
        {report?.cacheHit && (
          <span className="text-[11px] text-blue-500">キャッシュ表示中（30分更新）</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {(loading || refreshing) && !report && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Main content */}
      {report && (
        <div>
          {/* Tab bar */}
          <div className="flex overflow-x-auto border-b border-gray-200 mb-4 scrollbar-hide">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {label}
                {id === 'overview' && report.warningCount > 0 && (
                  <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                    {report.warningCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div>{renderTabContent()}</div>
        </div>
      )}
    </div>
  );
}
