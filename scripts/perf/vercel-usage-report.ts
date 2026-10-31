/**
 * Vercel の関数使用量（Active CPU・呼び出し回数・実行時間・Provisioned Memory）をルート別に集計し、
 * 負荷対策の変更前後を同じ表で比べるためのスクリプト。データは Vercel Observability（vercel metrics）から読む（読み取りのみ）。
 *
 * 集計:
 *   npx tsx scripts/perf/vercel-usage-report.ts --since 2026-10-24 --until 2026-10-31 --out docs/perf/before.json
 * 比較（1日あたりの平均で比べる。期間の長さが違っても比べられる）:
 *   npx tsx scripts/perf/vercel-usage-report.ts --compare docs/perf/before.json docs/perf/after.json
 *
 * 前提: Vercel CLI にログイン済みで、このディレクトリが本番プロジェクトにリンクされていること（.vercel/project.json）。
 * 長い期間をまとめて問い合わせると Vercel 側でタイムアウトするため、1日ずつ問い合わせて合計する。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const METRICS = {
  cpuMs: { id: 'vercel.function_invocation.function_cpu_time_ms', agg: 'sum' },
  invocations: { id: 'vercel.function_invocation.count', agg: 'sum' },
  gbHours: { id: 'vercel.function_invocation.function_duration_gbhr', agg: 'sum' },
  durationMs: { id: 'vercel.function_invocation.function_duration_ms', agg: 'sum' },
} as const;
type MetricKey = keyof typeof METRICS;

/** 主に見るルート（調査で負荷の大きかったもの）。それ以外は「その他」にまとめる */
const FOCUS_ROUTES = [
  '/work/[workId]',
  '/person/[slug]',
  '/groups/[groupSlug]',
  '/api/worker/heartbeat',
  '/api/worker/video-jobs/claim',
  '/api/admin/video-jobs',
  '/api/admin/video-jobs/activity',
  '/api/worker/first3-source',
];

interface RouteTotals { cpuMs: number; invocations: number; gbHours: number; durationMs: number }
interface Report {
  since: string;
  until: string;
  days: number;
  generatedAt: string;
  total: RouteTotals;
  routes: Record<string, RouteTotals>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function vercelMetric(metric: MetricKey, since: string, until: string, groupByRoute: boolean): Array<Record<string, unknown>> {
  const { id, agg } = METRICS[metric];
  const args = ['metrics', id, '-a', agg, '-s', since, '-u', until, '-g', '1d', '--json'];
  if (groupByRoute) args.push('--group-by', 'route', '-l', '200', '--order-by', 'value');
  const out = execFileSync('vercel', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  const data = JSON.parse(out.slice(out.indexOf('{'))) as { summary?: Array<Record<string, unknown>>; error?: { message: string } };
  if (data.error) throw new Error(`${id} ${since}..${until}: ${data.error.message}`);
  return data.summary ?? [];
}

const valueKey = (metric: MetricKey) => `${METRICS[metric].id.replace(/\./g, '_')}_${METRICS[metric].agg}`;
const empty = (): RouteTotals => ({ cpuMs: 0, invocations: 0, gbHours: 0, durationMs: 0 });

function collect(since: string, until: string): Report {
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  const routes: Record<string, RouteTotals> = {};
  const total = empty();
  let days = 0;
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    const s = d.toISOString();
    const u = new Date(d.getTime() + 86_400_000).toISOString();
    days++;
    for (const metric of Object.keys(METRICS) as MetricKey[]) {
      const k = valueKey(metric);
      for (const row of vercelMetric(metric, s, u, true)) {
        const name = FOCUS_ROUTES.includes(String(row.route)) ? String(row.route) : '(その他)';
        routes[name] ??= empty();
        routes[name][metric] += Number(row[k] ?? 0);
      }
      total[metric] += Number(vercelMetric(metric, s, u, false)[0]?.[k] ?? 0);
    }
    process.stderr.write(`collected ${s.slice(0, 10)}\n`);
  }
  // ルート別の上位200件に入らなかった分も「その他」に含め、合計と一致させる
  for (const metric of Object.keys(METRICS) as MetricKey[]) {
    const listed = Object.values(routes).reduce((sum, r) => sum + r[metric], 0);
    routes['(その他)'] ??= empty();
    routes['(その他)'][metric] += Math.max(0, total[metric] - listed);
  }
  return { since, until, days, generatedAt: new Date().toISOString(), total, routes };
}

function perDay(r: RouteTotals, days: number) {
  return {
    cpuSec: r.cpuMs / 1000 / days,
    invocations: r.invocations / days,
    gbHours: r.gbHours / days,
    avgDurationMs: r.invocations > 0 ? r.durationMs / r.invocations : 0,
    avgCpuMs: r.invocations > 0 ? r.cpuMs / r.invocations : 0,
  };
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function change(before: number, after: number): string {
  if (before === 0) return after === 0 ? '-' : '新規';
  const pct = ((after - before) / before) * 100;
  return `${pct >= 0 ? '+' : ''}${fmt(pct, 0)}%`;
}

function compare(beforePath: string, afterPath: string): string {
  const a = JSON.parse(readFileSync(beforePath, 'utf-8')) as Report;
  const b = JSON.parse(readFileSync(afterPath, 'utf-8')) as Report;
  const lines = [
    `変更前: ${a.since}〜${a.until}（${a.days}日） / 変更後: ${b.since}〜${b.until}（${b.days}日）。値は1日あたりの平均（実行時間・CPUは1回あたり）`,
    '',
    '| ルート | CPU秒/日 | 呼び出し/日 | GB時/日 | 1回の実行時間ms | 1回のCPU ms |',
    '|---|---|---|---|---|---|',
  ];
  const names = ['(合計)', ...FOCUS_ROUTES, '(その他)'];
  for (const name of names) {
    const ra = name === '(合計)' ? a.total : a.routes[name] ?? empty();
    const rb = name === '(合計)' ? b.total : b.routes[name] ?? empty();
    if (ra.invocations === 0 && rb.invocations === 0) continue;
    const x = perDay(ra, a.days);
    const y = perDay(rb, b.days);
    lines.push(
      `| ${name} | ${fmt(x.cpuSec)} → ${fmt(y.cpuSec)}（${change(x.cpuSec, y.cpuSec)}） | ${fmt(x.invocations)} → ${fmt(y.invocations)}（${change(x.invocations, y.invocations)}） | ${fmt(x.gbHours, 2)} → ${fmt(y.gbHours, 2)}（${change(x.gbHours, y.gbHours)}） | ${fmt(x.avgDurationMs)} → ${fmt(y.avgDurationMs)} | ${fmt(x.avgCpuMs)} → ${fmt(y.avgCpuMs)} |`,
    );
  }
  return lines.join('\n');
}

function summary(r: Report): string {
  const lines = [
    `${r.since}〜${r.until}（${r.days}日）。値は1日あたりの平均（実行時間・CPUは1回あたり）`,
    '',
    '| ルート | CPU秒/日 | 呼び出し/日 | GB時/日 | 1回の実行時間ms | 1回のCPU ms |',
    '|---|---|---|---|---|---|',
  ];
  for (const name of ['(合計)', ...FOCUS_ROUTES, '(その他)']) {
    const t = name === '(合計)' ? r.total : r.routes[name];
    if (!t || t.invocations === 0) continue;
    const x = perDay(t, r.days);
    lines.push(`| ${name} | ${fmt(x.cpuSec)} | ${fmt(x.invocations)} | ${fmt(x.gbHours, 2)} | ${fmt(x.avgDurationMs)} | ${fmt(x.avgCpuMs)} |`);
  }
  return lines.join('\n');
}

function main(): void {
  const cmp = process.argv.indexOf('--compare');
  if (cmp >= 0) {
    console.log(compare(process.argv[cmp + 1], process.argv[cmp + 2]));
    return;
  }
  const since = arg('--since');
  const until = arg('--until');
  const out = arg('--out');
  if (!since || !until || !out) {
    console.error('使い方: --since YYYY-MM-DD --until YYYY-MM-DD --out path.json  または  --compare before.json after.json');
    process.exit(1);
  }
  const report = collect(since, until);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(summary(report));
  console.log(`\n保存しました: ${out}`);
}

main();
