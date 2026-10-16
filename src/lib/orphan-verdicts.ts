// 孤立判定（verdicts にあるが products.items に同じIDの商品がない判定）の取得（読み取り専用）。
// 復旧API（/api/admin/product-recovery）とデータ損失監査（/admin/data-loss-audit）で共通に使う。
// 楽天市場の商品ID移行（旧 ic- → 新 ich-）後に残る旧IDの判定は、新ID商品へ引き継ぎ済みなら「移行済み」として孤立から除く
// （判定ロジックは src/lib/legacy-ichiba-verdict.ts）。
import { neonSql } from '@/db/client';
import { classifyOrphanVerdicts, type ItemLike, type LegacyOrphanKind, type VerdictLike } from '@/lib/legacy-ichiba-verdict';

export interface OrphanVerdictRow extends VerdictLike {
  personName: string;
  judgedAt: string;
  kind: LegacyOrphanKind;
}

/** 孤立判定を取得して分類する。personName を省略すると全人物 */
export async function getOrphanVerdicts(personName?: string): Promise<OrphanVerdictRow[]> {
  const person = personName ?? null;
  const orphanRows = (await neonSql`
    WITH product_ids AS (
      SELECT DISTINCT p.person_name, elem->>'id' AS product_id
      FROM products p,
      LATERAL jsonb_array_elements(p.items) AS elem
      WHERE jsonb_typeof(p.items) = 'array'
        AND (${person}::text IS NULL OR p.person_name = ${person})
    )
    SELECT v.person_name, v.product_id, v.verdict, v.score::float AS score, v.source, v.reason, v.judged_at
    FROM verdicts v
    LEFT JOIN product_ids pi ON v.person_name = pi.person_name AND v.product_id = pi.product_id
    WHERE pi.product_id IS NULL
      AND (${person}::text IS NULL OR v.person_name = ${person})
    ORDER BY v.judged_at DESC
  `) as Record<string, unknown>[];
  if (orphanRows.length === 0) return [];

  // 旧ID（ic-）の孤立判定がある人物だけ、新ID（ich-）の商品と判定を読む
  const legacyPersons = [...new Set(orphanRows.filter((r) => String(r.product_id).startsWith('ic-')).map((r) => String(r.person_name)))];
  const itemsByPerson = new Map<string, ItemLike[]>();
  const newVerdictsByPerson = new Map<string, Map<string, VerdictLike>>();
  if (legacyPersons.length > 0) {
    const itemRows = (await neonSql`
      SELECT p.person_name, elem->>'id' AS id, elem->>'itemUrl' AS item_url
      FROM products p,
      LATERAL jsonb_array_elements(p.items) AS elem
      WHERE jsonb_typeof(p.items) = 'array'
        AND p.person_name = ANY(${legacyPersons})
        AND elem->>'id' LIKE 'ich-%'
    `) as Record<string, unknown>[];
    for (const r of itemRows) {
      const list = itemsByPerson.get(String(r.person_name)) ?? [];
      list.push({ id: String(r.id), itemUrl: r.item_url as string | null });
      itemsByPerson.set(String(r.person_name), list);
    }
    const verdictRows = (await neonSql`
      SELECT person_name, product_id, verdict, score::float AS score, source, reason
      FROM verdicts
      WHERE person_name = ANY(${legacyPersons}) AND product_id LIKE 'ich-%'
    `) as Record<string, unknown>[];
    for (const r of verdictRows) {
      const map = newVerdictsByPerson.get(String(r.person_name)) ?? new Map<string, VerdictLike>();
      map.set(String(r.product_id), toVerdict(r));
      newVerdictsByPerson.set(String(r.person_name), map);
    }
  }

  const byPerson = new Map<string, Record<string, unknown>[]>();
  for (const r of orphanRows) {
    const list = byPerson.get(String(r.person_name)) ?? [];
    list.push(r);
    byPerson.set(String(r.person_name), list);
  }
  const result: OrphanVerdictRow[] = [];
  for (const [name, rows] of byPerson) {
    const verdicts = rows.map(toVerdict);
    const kinds = classifyOrphanVerdicts(verdicts, itemsByPerson.get(name) ?? [], newVerdictsByPerson.get(name) ?? new Map());
    rows.forEach((r, i) => result.push({
      ...verdicts[i],
      personName: name,
      judgedAt: String(r.judged_at).slice(0, 19).replace('T', ' '),
      kind: kinds.get(verdicts[i].productId) ?? 'orphan',
    }));
  }
  return result;
}

function toVerdict(r: Record<string, unknown>): VerdictLike {
  return {
    productId: String(r.product_id),
    verdict: String(r.verdict),
    source: String(r.source),
    score: r.score as number | null,
    reason: (r.reason as string | null) ?? null,
  };
}

/** 人物別の孤立判定件数（新ID商品へ引き継ぎ済みの旧ID判定は migratedCount に分け、orphanCount に含めない） */
export function summarizeOrphanVerdicts(orphans: readonly OrphanVerdictRow[]): {
  stats: { personName: string; orphanCount: number; migratedCount: number }[];
  total: number;
  migratedTotal: number;
} {
  const byPerson = new Map<string, { personName: string; orphanCount: number; migratedCount: number }>();
  for (const o of orphans) {
    const stat = byPerson.get(o.personName) ?? { personName: o.personName, orphanCount: 0, migratedCount: 0 };
    if (o.kind === 'migrated') stat.migratedCount++;
    else stat.orphanCount++;
    byPerson.set(o.personName, stat);
  }
  const stats = [...byPerson.values()].filter((r) => r.orphanCount > 0).sort((a, b) => b.orphanCount - a.orphanCount);
  return {
    stats,
    total: stats.reduce((s, r) => s + r.orphanCount, 0),
    migratedTotal: orphans.filter((o) => o.kind === 'migrated').length,
  };
}
