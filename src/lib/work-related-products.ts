// 作品ページの「関連商品」（主演人物の保存済み商品のうち、作品名を含む承認済み商品を最大6件）。
//
// 以前は人物の全カテゴリの商品（平均約150KB、多い人物で約1.4MB）と全判定を毎回DBから読み、
// アプリ側で絞り込んでいた。ここでは DB 側で「対象カテゴリ × 判定が related」の商品の ID・商品名・位置だけを読み、
// 作品名の一致は従来と同じ JavaScript の正規化（小文字化・空白除去）で判定してから、
// 表示する商品（最大6件）の全項目だけを読む。選ばれる商品・順序・件数は従来と同じ。
//
// 2回目の読み取りの間に商品が更新され、位置と商品IDが一致しなくなった場合は、従来の方法
// （全商品・全判定を読む）で選び直す（表示する関連商品を減らさないため）。
// 読み取りのみ（DB・Redis への書き込みなし）。
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { getAllStoredProducts, type StoredCategoryData } from '@/lib/product-store';
import { getAllVerdicts, type JudgmentRecord } from '@/lib/judgment-store';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

/** 作品ページの関連商品の対象カテゴリ（この順に並べる） */
export const WORK_RELATED_CATEGORIES: readonly ProductCategory[] = ['Blu-ray・DVD', 'CD', '本・雑誌'];
export const WORK_RELATED_LIMIT = 6;

/** 作品名・商品名の照合用の正規化（従来の作品ページと同じ：小文字化し、全角スペース・空白を除く） */
export function normalizeWorkMatchTitle(title: string): string {
  return title.toLowerCase().replace(/[　\s]/g, '');
}

export interface WorkRelatedCandidate {
  category: string;
  /** カテゴリ内の位置（1始まり。保存順） */
  ord: number;
  id: string;
  title: string | null;
}

/**
 * 候補（判定が related の商品の ID・商品名・位置）から、作品名を含む商品を
 * カテゴリ順（WORK_RELATED_CATEGORIES）→ 保存順に最大 limit 件選ぶ（純粋関数）。
 */
export function pickWorkRelatedCandidates<T extends WorkRelatedCandidate>(
  candidates: readonly T[],
  workTitle: string,
  limit: number = WORK_RELATED_LIMIT,
): T[] {
  const titleNorm = normalizeWorkMatchTitle(workTitle);
  const catIndex = new Map<string, number>(WORK_RELATED_CATEGORIES.map((c, i) => [c, i]));
  return candidates
    .filter((c) => catIndex.has(c.category) && typeof c.title === 'string' && normalizeWorkMatchTitle(c.title).includes(titleNorm))
    .sort((a, b) => (catIndex.get(a.category)! - catIndex.get(b.category)!) || (a.ord - b.ord))
    .slice(0, limit);
}

/**
 * 従来の作品ページの選び方（全商品・全判定から選ぶ）。読み取りの途中で商品が更新されたときの選び直しと、
 * 新しい方法と結果が同じであることの確認（テスト・検証スクリプト）に使う（純粋関数）。
 */
export function selectWorkRelatedFromStored(
  storedData: Partial<Record<ProductCategory, StoredCategoryData>>,
  verdicts: Record<string, Pick<JudgmentRecord, 'verdict'>>,
  workTitle: string,
  limit: number = WORK_RELATED_LIMIT,
): RakutenItem[] {
  const titleNorm = normalizeWorkMatchTitle(workTitle);
  return WORK_RELATED_CATEGORIES
    .flatMap((cat) => storedData[cat]?.products ?? [])
    .filter((p) => {
      if (verdicts[p.id]?.verdict !== 'related') return false;
      return normalizeWorkMatchTitle(p.title).includes(titleNorm);
    })
    .slice(0, limit);
}

function textArraySql(values: readonly string[]) {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

function intArraySql(values: readonly number[]) {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::int[]`;
}

async function getWorkRelatedProductsLegacy(personName: string, workTitle: string): Promise<RakutenItem[]> {
  const [storedData, verdicts] = await Promise.all([getAllStoredProducts(personName), getAllVerdicts(personName)]);
  return selectWorkRelatedFromStored(storedData, verdicts, workTitle);
}

/** 作品ページの関連商品（最大6件）。DB エラー時は従来どおり空配列。 */
export async function getWorkRelatedProducts(personName: string, workTitle: string): Promise<RakutenItem[]> {
  try {
    // 1) 対象カテゴリで判定が related の商品の ID・商品名・位置だけを読む
    const candRes = await db.execute(sql`
      SELECT p.category, e.ord::int AS ord, e.item->>'id' AS id, e.item->>'title' AS title
      FROM products p
      CROSS JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS e(item, ord)
      JOIN verdicts v
        ON v.person_name = p.person_name AND v.product_id = e.item->>'id' AND v.verdict = 'related'
      WHERE p.person_name = ${personName} AND p.category = ANY(${textArraySql(WORK_RELATED_CATEGORIES)})
    `);
    const picked = pickWorkRelatedCandidates(candRes.rows as unknown as WorkRelatedCandidate[], workTitle);
    if (picked.length === 0) return [];

    // 2) 表示する商品の全項目だけを読む（カテゴリと位置で指定）
    const itemRes = await db.execute(sql`
      SELECT k.category, k.ord, p.items -> (k.ord - 1) AS item
      FROM unnest(${textArraySql(picked.map((c) => c.category))}, ${intArraySql(picked.map((c) => c.ord))}) AS k(category, ord)
      JOIN products p ON p.person_name = ${personName} AND p.category = k.category
    `);
    const byPos = new Map(
      (itemRes.rows as unknown as { category: string; ord: number; item: RakutenItem | null }[])
        .map((r) => [`${r.category}|${Number(r.ord)}`, r.item]),
    );
    const items: RakutenItem[] = [];
    for (const c of picked) {
      const item = byPos.get(`${c.category}|${c.ord}`);
      // 1) と 2) の間に商品が更新された（位置の商品が変わった）場合は、従来の方法で選び直す
      if (!item || String(item.id) !== c.id) return getWorkRelatedProductsLegacy(personName, workTitle);
      items.push(item);
    }
    return items;
  } catch (err) {
    console.error('[db] getWorkRelatedProducts failed:', String(err));
    return [];
  }
}
