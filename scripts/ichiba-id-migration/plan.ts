// 楽天市場の商品ID移行（旧 ic-<店舗単位の値> → 新 ich-<店舗コード>:<商品コード>）の移行計画（純粋関数・DB非依存）。
// Phase 4（docs/development-log.md Task 95）。実行スクリプトは ./simulate.ts（読み取り専用のシミュレーション）。
//
// 方針:
// - 商品は削除しない。移行対象は products の楽天市場商品（id が ic-）の id だけ（他のフィールドは変更しない）。
// - 新IDは保存済みの itemCode（あれば）または遷移先URLから作る（src/lib/rakuten-item-id.ts の ichibaItemIdFromStoredItem）。
//   作れない商品は移行しない（unconvertible）。
// - 判定（verdicts、(人物, 商品ID) 単位）は、同じ人物で旧IDに対応する商品が1つだけ（＝判定の帰属が一意）の場合だけ新IDへ引き継ぐ。
//   同じ旧IDを複数の商品が共有していて判定が付いている場合は、どの商品に対する判定か分からないため、判定をコピーせず
//   その商品自体も移行しない（deferred_shared：旧IDのまま残し、表示は現状維持。再確認リストで1組ずつ解消する）。
//   判定が付いていない共有グループは、引き継ぐものが無いため移行してよい。旧IDの判定行は削除しない。
import { ichibaItemIdFromStoredItem, isLegacyIchibaId, isNewIchibaId } from '@/lib/rakuten-item-id';

export interface StoredItem {
  id: string;
  title?: string;
  itemUrl?: string;
  affiliateUrl?: string;
  itemCode?: string;
  [key: string]: unknown;
}
export interface ProductRow { personName: string; category: string; items: StoredItem[] }
export interface VerdictRow { personName: string; productId: string; verdict: string; source: string; score?: string | number; reason?: string | null }

export type ItemStatus = 'convertible' | 'unconvertible' | 'collision_in_row' | 'collision_existing_id' | 'deferred_shared';
export type VerdictPlan = 'carry' | 'review_shared' | 'none' | 'conflict_existing_new_verdict';

export interface ItemPlan {
  personName: string;
  category: string;
  index: number;
  legacyId: string;
  newId: string | null;
  title: string;
  status: ItemStatus;
  verdict: string | null;         // 現在の旧IDの判定
  verdictSource: string | null;
  verdictPlan: VerdictPlan;
  /** 現在公開中（related）で、移行後に未判定（非公開）になる */
  hiddenAfterMigration: boolean;
}

export interface MigrationSummary {
  rows: number;
  items: number;
  convertible: number;
  unconvertible: number;
  collisionInRow: number;
  collisionWithExistingId: number;
  newIdsSharedAcrossCategories: number; // 同じ人物の別カテゴリにある同じ商品（同じ新ID）。判定は (人物, ID) 単位で1つ
  verdictCarry: number;                 // 判定を引き継ぐ商品（＝新IDの判定行を追加する数は verdictRowsToInsert）
  verdictRowsToInsert: number;
  verdictReviewShared: number;          // 判定の帰属が不明で再確認が必要な商品（移行せず旧IDのまま残す）
  migrateItems: number;                 // 実際にIDを書き換える商品
  deferredShared: number;               // 判定の帰属が不明なため今回は移行しない商品
  reviewSharedGroups: number;
  noVerdict: number;
  conflictExistingNewVerdict: number;
  hiddenAfterMigration: number;         // 現在公開中で、移行後に一時的に非公開になる商品
  orphanLegacyVerdicts: number;         // 商品が存在しない旧ID判定（移行しない・削除しない）
}

const key = (...p: string[]) => p.join('\u0000');

export function planMigration(
  rows: ProductRow[],
  legacyVerdicts: VerdictRow[],
  existingNewIdVerdicts: VerdictRow[] = [],
): { items: ItemPlan[]; summary: MigrationSummary; verdictInserts: (VerdictRow & { fromProductId: string })[] } {
  const verdictOf = new Map(legacyVerdicts.map((v) => [key(v.personName, v.productId), v]));
  const existingNewVerdict = new Set(existingNewIdVerdicts.map((v) => key(v.personName, v.productId)));
  // 既存の新ID（移行期間中に取得された ich- 商品）。衝突検出に使う
  const existingNewIds = new Set<string>();
  for (const r of rows) for (const it of r.items) if (isNewIchibaId(it.id)) existingNewIds.add(key(r.personName, it.id));

  // 同じ人物・同じ旧IDに対応する新IDの集合（判定の帰属が一意かを決める）
  const newIdsPerLegacy = new Map<string, Set<string>>();
  const drafts: Omit<ItemPlan, 'verdictPlan' | 'hiddenAfterMigration'>[] = [];
  for (const r of rows) {
    const seenNewInRow = new Map<string, number>();
    r.items.forEach((it, index) => {
      if (!isLegacyIchibaId(it.id)) return;
      const newId = ichibaItemIdFromStoredItem(it);
      const v = verdictOf.get(key(r.personName, it.id));
      let status: ItemStatus = newId ? 'convertible' : 'unconvertible';
      if (newId) {
        seenNewInRow.set(newId, (seenNewInRow.get(newId) ?? 0) + 1);
        if (existingNewIds.has(key(r.personName, newId))) status = 'collision_existing_id';
        const k = key(r.personName, it.id);
        const set = newIdsPerLegacy.get(k) ?? new Set<string>();
        set.add(newId);
        newIdsPerLegacy.set(k, set);
      }
      drafts.push({ personName: r.personName, category: r.category, index, legacyId: it.id, newId, title: String(it.title ?? ''), status, verdict: v?.verdict ?? null, verdictSource: v?.source ?? null });
    });
    for (const d of drafts) {
      if (d.personName === r.personName && d.category === r.category && d.newId && (seenNewInRow.get(d.newId) ?? 0) > 1) d.status = 'collision_in_row';
    }
  }

  const items: ItemPlan[] = drafts.map((d) => {
    const group = newIdsPerLegacy.get(key(d.personName, d.legacyId));
    let verdictPlan: VerdictPlan = 'none';
    if (d.verdict) {
      if (!d.newId || d.status !== 'convertible') verdictPlan = 'none';
      else if (existingNewVerdict.has(key(d.personName, d.newId))) verdictPlan = 'conflict_existing_new_verdict';
      else if (group && group.size === 1) verdictPlan = 'carry';
      else verdictPlan = 'review_shared';
    }
    // 判定の帰属が不明な商品は移行しない（旧IDのまま＝判定も表示も現状維持）
    const status: ItemStatus = verdictPlan === 'review_shared' ? 'deferred_shared' : d.status;
    const hiddenAfterMigration = d.verdict === 'related' && status === 'convertible' && verdictPlan !== 'carry';
    return { ...d, status, verdictPlan, hiddenAfterMigration };
  });

  // 判定行の追加（(人物, 新ID) 単位で1行。同じ商品が別カテゴリにあっても1行）
  const inserts = new Map<string, VerdictRow & { fromProductId: string }>();
  for (const it of items) {
    if (it.verdictPlan !== 'carry' || !it.newId) continue;
    const v = verdictOf.get(key(it.personName, it.legacyId))!;
    inserts.set(key(it.personName, it.newId), { ...v, productId: it.newId, fromProductId: it.legacyId });
  }

  const presentLegacy = new Set(rows.flatMap((r) => r.items.filter((i) => isLegacyIchibaId(i.id)).map((i) => key(r.personName, i.id))));
  const newIdCount = new Map<string, number>();
  for (const it of items) if (it.newId) newIdCount.set(key(it.personName, it.newId), (newIdCount.get(key(it.personName, it.newId)) ?? 0) + 1);
  const reviewGroups = new Set(items.filter((i) => i.verdictPlan === 'review_shared').map((i) => key(i.personName, i.legacyId)));

  const count = (f: (i: ItemPlan) => boolean) => items.filter(f).length;
  return {
    items,
    verdictInserts: [...inserts.values()],
    summary: {
      rows: rows.filter((r) => r.items.some((i) => isLegacyIchibaId(i.id))).length,
      items: items.length,
      convertible: count((i) => i.newId !== null),
      unconvertible: count((i) => i.status === 'unconvertible'),
      collisionInRow: count((i) => i.status === 'collision_in_row'),
      collisionWithExistingId: count((i) => i.status === 'collision_existing_id'),
      newIdsSharedAcrossCategories: [...newIdCount.values()].filter((n) => n > 1).length,
      verdictCarry: count((i) => i.verdictPlan === 'carry'),
      verdictRowsToInsert: inserts.size,
      verdictReviewShared: count((i) => i.verdictPlan === 'review_shared'),
      migrateItems: count((i) => i.status === 'convertible'),
      deferredShared: count((i) => i.status === 'deferred_shared'),
      reviewSharedGroups: reviewGroups.size,
      noVerdict: count((i) => !i.verdict),
      conflictExistingNewVerdict: count((i) => i.verdictPlan === 'conflict_existing_new_verdict'),
      hiddenAfterMigration: count((i) => i.hiddenAfterMigration),
      orphanLegacyVerdicts: legacyVerdicts.filter((v) => isLegacyIchibaId(v.productId) && !presentLegacy.has(key(v.personName, v.productId))).length,
    },
  };
}

// ── 適用・復元（メモリ上。DBの更新は移行スクリプトが行い、同じ変換を使う） ─────────────────────

/** 移行後の products 行：convertible の要素の id だけを新IDに置き換える（他のフィールド・順序・要素数は不変） */
export function applyPlanToRows(rows: ProductRow[], items: ItemPlan[]): ProductRow[] {
  const change = new Map(items.filter((i) => i.status === 'convertible' && i.newId).map((i) => [key(i.personName, i.category, String(i.index)), i]));
  return rows.map((r) => ({
    ...r,
    items: r.items.map((it, index) => {
      const c = change.get(key(r.personName, r.category, String(index)));
      if (!c) return it;
      if (it.id !== c.legacyId) throw new Error(`計画時と状態が異なります: ${r.personName} / ${r.category} / ${index}`);
      return { ...it, id: c.newId! };
    }),
  }));
}

/** バックアップ（移行前の rows）で復元し、追加した判定行を取り除く */
export function rollbackPlan(
  backupRows: ProductRow[],
  verdictsAfter: VerdictRow[],
  inserted: { personName: string; productId: string }[],
): { rows: ProductRow[]; verdicts: VerdictRow[] } {
  const ins = new Set(inserted.map((v) => key(v.personName, v.productId)));
  return {
    rows: backupRows.map((r) => ({ ...r, items: r.items.map((it) => ({ ...it })) })),
    verdicts: verdictsAfter.filter((v) => !ins.has(key(v.personName, v.productId))),
  };
}
