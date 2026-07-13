import { db, neonSql } from '@/db/client';
import { systemUsageSnapshots } from '@/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { ServiceUsage, SnapshotTrend, SnapshotPoint } from './types';

const SNAPSHOT_RETENTION_DAYS = 90;

// Save key metrics from each service. Hourly dedup via unique index.
export async function saveSnapshots(services: ServiceUsage[]): Promise<void> {
  const rows: Array<{
    service: string;
    metric: string;
    value: number;
    unit: string;
    source: string;
    isEstimated: boolean;
  }> = [];

  for (const svc of services) {
    for (const m of svc.metrics) {
      if (m.value == null) continue;
      rows.push({
        service: svc.serviceId,
        metric: m.label,
        value: m.value,
        unit: m.unit,
        source: m.source,
        isEstimated: m.isEstimated,
      });
    }
  }

  if (rows.length === 0) return;

  // Batch insert; ON CONFLICT DO NOTHING via unique functional index on (service, metric, hour)
  await Promise.all(
    rows.map((r) =>
      neonSql`
        INSERT INTO system_usage_snapshots
          (service, metric, value, unit, source, is_estimated, recorded_at)
        VALUES
          (${r.service}, ${r.metric}, ${r.value}, ${r.unit}, ${r.source}, ${r.isEstimated}, NOW())
        ON CONFLICT (service, metric, date_trunc('hour', recorded_at AT TIME ZONE 'UTC'))
        DO NOTHING
      `.catch(() => null), // swallow individual insert errors
    ),
  );
}

export async function cleanOldSnapshots(): Promise<void> {
  const cutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(systemUsageSnapshots)
    .where(sql`${systemUsageSnapshots.recordedAt} < ${cutoff}`);
}

async function getHistory(service: string, metric: string, days: number): Promise<SnapshotPoint[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${systemUsageSnapshots.recordedAt} AT TIME ZONE 'UTC')::date::text`,
      value: sql<number>`AVG(${systemUsageSnapshots.value})`,
    })
    .from(systemUsageSnapshots)
    .where(
      and(
        eq(systemUsageSnapshots.service, service),
        eq(systemUsageSnapshots.metric, metric),
        gte(systemUsageSnapshots.recordedAt, cutoff),
      ),
    )
    .groupBy(sql`date_trunc('day', ${systemUsageSnapshots.recordedAt} AT TIME ZONE 'UTC')::date`)
    .orderBy(sql`date_trunc('day', ${systemUsageSnapshots.recordedAt} AT TIME ZONE 'UTC')::date`);

  return rows.map((r) => ({ recordedAt: r.day, value: Number(r.value) }));
}

function calcTrend(
  history: SnapshotPoint[],
  unit: string,
  limit: number | null,
): Omit<SnapshotTrend, 'service' | 'metric' | 'history'> {
  if (history.length < 2) {
    return {
      unit,
      change7d: null,
      change30d: null,
      dailyAvgIncrease: null,
      projectedLimitDate: null,
      projectedMonthEnd: null,
      dataInsufficient: true,
    };
  }

  const now = new Date();
  const day7ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const day30ago = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const latest = history[history.length - 1].value;
  const at7d = history.find((p) => new Date(p.recordedAt) >= day7ago);
  const at30d = history.find((p) => new Date(p.recordedAt) >= day30ago);

  const change7d = at7d != null ? latest - at7d.value : null;
  const change30d = at30d != null ? latest - at30d.value : null;

  const daySpan = Math.max(
    1,
    (new Date(history[history.length - 1].recordedAt).getTime() -
      new Date(history[0].recordedAt).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  const totalChange = latest - history[0].value;
  const dailyAvgIncrease = daySpan >= 7 ? totalChange / daySpan : null;

  let projectedLimitDate: string | null = null;
  if (limit != null && dailyAvgIncrease != null && dailyAvgIncrease > 0) {
    const daysToLimit = (limit - latest) / dailyAvgIncrease;
    const limitDate = new Date(Date.now() + daysToLimit * 24 * 60 * 60 * 1000);
    projectedLimitDate = limitDate.toISOString().slice(0, 10);
  }

  let projectedMonthEnd: number | null = null;
  if (dailyAvgIncrease != null) {
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
    projectedMonthEnd = latest + dailyAvgIncrease * daysLeft;
  }

  return {
    unit,
    change7d,
    change30d,
    dailyAvgIncrease,
    projectedLimitDate,
    projectedMonthEnd,
    dataInsufficient: history.length < 7,
  };
}

export async function getSnaphotTrends(services: ServiceUsage[]): Promise<SnapshotTrend[]> {
  const targets: Array<{ service: string; metric: string; unit: string; limit: number | null }> = [];

  for (const svc of services) {
    for (const m of svc.metrics) {
      if (m.value != null) {
        targets.push({ service: svc.serviceId, metric: m.label, unit: m.unit, limit: m.limit });
      }
    }
  }

  const results = await Promise.allSettled(
    targets.map(async (t) => {
      const history = await getHistory(t.service, t.metric, 30);
      return {
        service: t.service,
        metric: t.metric,
        history,
        ...calcTrend(history, t.unit, t.limit),
      } satisfies SnapshotTrend;
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<SnapshotTrend> => r.status === 'fulfilled')
    .map((r) => r.value);
}
