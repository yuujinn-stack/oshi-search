// 価格の取得日時の埋まり具合（読み取りのみ。DB・Redis への書き込みなし）。
// 公開中（verdict=related）の商品のうち、価格の取得日時（priceFetchedAt）が30日以内の割合を出し、
// 表示モードを strict（取得日時不明の価格も出さない）に切り替えてよいかの目安にする。
// 実行: npx dotenv -e .env.local -- npx tsx scripts/price-refresh/coverage.ts
import { neonSql } from '@/db/client';
import { lookupCodeOf } from '@/lib/price-refresh';
import { PRICE_FRESH_DAYS } from '@/lib/price-freshness';
import type { RakutenItem } from '@/types/rakuten';

const STRICT_READY_RATIO = 0.9;

(async () => {
  const rows = (await neonSql`SELECT person_name, items FROM products`) as { person_name: string; items: RakutenItem[] }[];
  const related = new Set(((await neonSql`SELECT person_name || '|' || product_id AS k FROM verdicts WHERE verdict = 'related'`) as { k: string }[]).map((r) => r.k));
  const now = Date.now();
  const freshMs = PRICE_FRESH_DAYS * 24 * 60 * 60 * 1000;
  const c = { related: 0, fresh: 0, stale: 0, unknown: 0, unknownLookupable: 0, unknownSearchOnly: 0 };
  for (const r of rows) for (const p of r.items) {
    if (!related.has(`${r.person_name}|${p.id}`)) continue;
    c.related++;
    if (!p.priceFetchedAt) {
      c.unknown++;
      if (lookupCodeOf(p)) c.unknownLookupable++; else c.unknownSearchOnly++;
    } else if (now - p.priceFetchedAt <= freshMs) c.fresh++;
    else c.stale++;
  }
  const ratio = c.related ? c.fresh / c.related : 0;
  console.log(JSON.stringify({
    ...c,
    freshRatio: Math.round(ratio * 1000) / 10 + '%',
    strictReady: ratio >= STRICT_READY_RATIO,
    note: `公開中の商品の${STRICT_READY_RATIO * 100}%以上が${PRICE_FRESH_DAYS}日以内の価格になったら PRICE_DISPLAY_MODE=strict を検討`,
  }, null, 1));
})();
