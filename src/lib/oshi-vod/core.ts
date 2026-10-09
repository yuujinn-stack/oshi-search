// 推しに合うサブスク診断（/oshi-vod）の計算ロジック（純粋関数・DB非依存）。
//
// 重要な前提:
// - 「配信中として確認済みか」「今すぐ見られるか」の判定は src/lib/vod-availability.ts の共通関数
//   （人物ページ・StreamingNowSection・Instagram投稿と同一）だけを使う。診断専用の判定は作らない。
// - ランキングは作品数・料金・配信データだけで決める。アフィリエイト提携情報はこのファイルに
//   一切渡さない（順位に影響させないため）。
// - 同率時の並びは、価格（比較可能なもののみ）→ vod-plan-info.ts の定義順（=VOD_PAGE_PROVIDERS の順）
//   で決定的にする。
//
// 将来の /person/[slug]/vod・/groups/[slug]/vod 等の固定ページからも、この関数群をそのまま
// 呼び出せるよう、ページ固有の処理は含めない。

import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';
import { getConfirmedProviders, STREAMING_TYPES } from '@/lib/vod-availability';
import { normalizeProviderName, isPrimeVideoChannel, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { VOD_PROVIDER_DISPLAY_NAMES } from '@/lib/vod-provider-names';
import { VOD_PLAN_INFO, isPriceComparable, type VodPlanInfo } from '@/lib/vod-plan-info';
import type {
  AlternativeEntry,
  DiagnosisPersonInput,
  DiagnosisResult,
  DiagnosisTotals,
  DiagnosisWork,
  Over80Result,
  PersonBreakdown,
  ProviderBucket,
  RankedService,
  ServiceCombo,
  ServiceStat,
  WorkServiceRef,
} from './types';

export const OSHI_VOD_COVERAGE_THRESHOLD = { numerator: 4, denominator: 5 } as const; // 80%

export interface DiagnosisOptions {
  /** 終了済み・inactive サービスの正規化スラグ（getInactiveProviderSlugs） */
  terminatedSlugs: Set<string>;
  /** 料金情報（テスト用に差し替え可能。既定は VOD_PLAN_INFO） */
  plans?: VodPlanInfo[];
  /**
   * 同一作品の複数行から表示用の代表行を選ぶ関数。
   * 既定は先頭行。公開ページからは work-store の selectRepresentativeWorkRecord を渡す
   * （work-store は DB に依存するため、ここでは import しない）。
   */
  pickRepresentative?: (records: WorkRecord[]) => WorkRecord;
}

// ─── 作品の重複排除 ─────────────────────────────────────────────────────────────

/** 重複排除キー。統合済み作品は canonicalWorkId で1つにまとめる */
export function workDedupKey(work: Pick<WorkRecord, 'id' | 'canonicalWorkId'>): string {
  return work.canonicalWorkId ?? work.id;
}

interface WorkGroup {
  key: string;
  rows: WorkRecord[];
  personNames: string[];
}

/** 選択人物の作品を重複排除キーでまとめる（初出順を維持） */
export function groupWorksByKey(persons: DiagnosisPersonInput[]): WorkGroup[] {
  const map = new Map<string, WorkGroup>();
  for (const person of persons) {
    for (const w of person.works) {
      const key = workDedupKey(w);
      let g = map.get(key);
      if (!g) {
        g = { key, rows: [], personNames: [] };
        map.set(key, g);
      }
      g.rows.push(w);
      if (!g.personNames.includes(person.name)) g.personNames.push(person.name);
    }
  }
  return [...map.values()];
}

// ─── 配信情報の分類 ─────────────────────────────────────────────────────────────

/**
 * 1件の配信情報（getConfirmedProviders 通過済み）を分類する。
 * サービス単位で無料/有料を固定せず、作品ごとの配信種別を優先する。
 */
export function classifyProvider(p: VodProvider, planByService: Map<string, VodPlanInfo>): ProviderBucket {
  // Prime Video 追加チャンネル（別料金）は Prime Video 本体の見放題に数えない
  if (isPrimeVideoChannel(p.providerName)) return 'channel';
  if (p.type === 'rent' || p.type === 'buy') return 'rental';
  if (p.type === 'free' || p.type === 'ads') return 'free';
  // ここに来るのは flatrate のみ（unknown は getConfirmedProviders で除外済み）
  const plan = planByService.get(normalizeProviderName(p.providerName));
  if (!plan) return 'other';
  return plan.kind === 'free' ? 'free' : 'paid';
}

function serviceDisplayName(service: string, providerName: string): string {
  return VOD_PROVIDER_DISPLAY_NAMES[service] ?? getVodProviderDisplayInfo(providerName).displayName;
}

/**
 * 診断画面の「サービス単位の表示名」（詳しい比較のカード名等）の上書き。
 * 共通の表示名 getVodProviderDisplayInfo・作品ごとの表示（チップは「Prime Video ＋ 購入」のように
 * 種別ラベルが付くため区別できる）は変更しない。
 * amazonvideo は TMDb の「Amazon Video」＝レンタル・購入のストア（DB上は rent / buy のみ）。
 * 共通表示名は「Prime Video」のため、詳しい比較で Prime Video 本体（見放題）のカードと
 * 同名のカードが2つ並んでしまう。サービス単位では別物と分かる名前にする。
 * サービス識別子（service）・分類（bucket）・ランキング計算は変えない（表示名のみ）。
 */
export const DIAGNOSIS_SERVICE_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  amazonvideo: 'Prime Video レンタル・購入',
};

/**
 * レンタル・購入専用のストア（月額サブスクではない）。詳しい比較の「月額」欄に
 * 「料金未確認」ではなく「対象外（レンタル・購入）」と表示するためだけに使う（表示のみ）。
 * ランキング・2サービス最適化・80%判定には元々入らない（rent / buy は bucket='rental'）。
 */
export const DIAGNOSIS_RENTAL_STORE_SERVICES: ReadonlySet<string> = new Set(['amazonvideo']);

/** 同一作品の全行の配信情報をまとめ、既存の共通判定を通したうえで分類する */
export function buildDiagnosisWork(
  group: WorkGroup,
  terminatedSlugs: Set<string>,
  planByService: Map<string, VodPlanInfo>,
  pickRepresentative: (records: WorkRecord[]) => WorkRecord,
): DiagnosisWork {
  const confirmed = getConfirmedProviders(group.rows.flatMap((r) => r.vodProviders ?? []), terminatedSlugs);
  const services: WorkServiceRef[] = confirmed.map((p) => {
    const service = normalizeProviderName(p.providerName);
    const info = getVodProviderDisplayInfo(p.providerName);
    return {
      service,
      displayName: info.isPrimeVideoChannel ? info.displayName : serviceDisplayName(service, p.providerName),
      type: p.type,
      bucket: classifyProvider(p, planByService),
      logoPath: p.logoPath,
      badgeLabel: info.badgeLabel,
    };
  });
  const checkedValues = group.rows.map((r) => r.vodUpdatedAt).filter((v): v is number => typeof v === 'number' && v > 0);
  return {
    key: group.key,
    work: pickRepresentative(group.rows),
    personNames: group.personNames,
    checkedAt: checkedValues.length > 0 ? Math.max(...checkedValues) : undefined,
    isStreaming: confirmed.some((p) => STREAMING_TYPES.includes(p.type)),
    services,
  };
}

// ─── 数値計算 ──────────────────────────────────────────────────────────────────

/** カバー率（0〜1）。分母0は0 */
export function coverageRatio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/**
 * カバー率の表示用パーセント（小数1桁・切り捨て）。
 * 四捨五入すると 79.96% が「80.0%」と表示されつつ 80% 条件を満たさない、という食い違いが
 * 起きるため切り捨てにする。
 */
export function coveragePercentFloor(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.floor((count * 1000) / total) / 10;
}

/** 1作品あたり料金（円、四捨五入）。作品0件または料金なしは null */
export function costPerWork(monthlyPrice: number | null, count: number): number | null {
  if (monthlyPrice == null || count <= 0) return null;
  return Math.round(monthlyPrice / count);
}

/** 80%以上か（浮動小数を使わず整数で判定） */
export function meetsCoverageThreshold(count: number, total: number): boolean {
  if (total <= 0) return false;
  return count * OSHI_VOD_COVERAGE_THRESHOLD.denominator >= total * OSHI_VOD_COVERAGE_THRESHOLD.numerator;
}

/** 複数サービスの有料見放題作品の和集合（同じ作品を2重に数えない） */
export function unionPaidKeys(stats: ServiceStat[]): Set<string> {
  const set = new Set<string>();
  for (const s of stats) for (const k of s.paidKeys) set.add(k);
  return set;
}

// ─── サービス集計 ────────────────────────────────────────────────────────────────

export function computeServiceStats(works: DiagnosisWork[], plans: VodPlanInfo[]): ServiceStat[] {
  const order = new Map(plans.map((p, i) => [p.service, i]));
  const planByService = new Map(plans.map((p) => [p.service, p]));
  const statMap = new Map<string, ServiceStat>();
  const ensure = (ref: WorkServiceRef): ServiceStat => {
    let s = statMap.get(ref.service);
    if (!s) {
      const plan = planByService.get(ref.service) ?? null;
      s = {
        service: ref.service,
        displayName: DIAGNOSIS_SERVICE_NAME_OVERRIDES[ref.service] ?? ref.displayName,
        logoPath: ref.logoPath,
        plan,
        priceComparable: isPriceComparable(plan),
        paidKeys: [],
        freeKeys: [],
        rentalKeys: [],
      };
      statMap.set(ref.service, s);
    }
    if (!s.logoPath && ref.logoPath) s.logoPath = ref.logoPath;
    return s;
  };
  for (const w of works) {
    for (const ref of w.services) {
      // 追加チャンネル・その他サービスは集計対象外（詳細比較で作品単位に表示する）
      if (ref.bucket === 'channel' || ref.bucket === 'other') continue;
      const s = ensure(ref);
      const list = ref.bucket === 'paid' ? s.paidKeys : ref.bucket === 'free' ? s.freeKeys : s.rentalKeys;
      if (!list.includes(w.key)) list.push(w.key);
    }
  }
  return [...statMap.values()].sort(
    (a, b) => (order.get(a.service) ?? 999) - (order.get(b.service) ?? 999) || a.service.localeCompare(b.service),
  );
}

// ─── ランキング ────────────────────────────────────────────────────────────────

function serviceOrderIndex(plans: VodPlanInfo[]): (service: string) => number {
  const order = new Map(plans.map((p, i) => [p.service, i]));
  return (service) => order.get(service) ?? 999;
}

function price(s: ServiceStat): number | null {
  return s.priceComparable ? s.plan!.monthlyPrice : null;
}

/** 価格比較: 比較可能な価格を安い順、価格なしは後ろ */
function comparePriceAsc(a: number | null, b: number | null): number {
  if (a != null && b != null) return a - b;
  if (a != null) return -1;
  if (b != null) return 1;
  return 0;
}

/**
 * ソート済み配列に順位（同率は同じ番号、次は飛ばす: 1,1,3）を付ける。
 * isSameRank は「主指標が等しいか」の判定。
 */
export function assignRanks<T>(sorted: T[], isSameRank: (a: T, b: T) => boolean): Array<{ item: T; rank: number; tied: boolean }> {
  const ranks: number[] = [];
  sorted.forEach((item, i) => {
    ranks.push(i > 0 && isSameRank(sorted[i - 1], item) ? ranks[i - 1] : i + 1);
  });
  return sorted.map((item, i) => ({
    item,
    rank: ranks[i],
    tied: ranks.filter((r) => r === ranks[i]).length > 1,
  }));
}

function toRanked(entries: Array<{ item: ServiceStat; rank: number; tied: boolean }>): RankedService[] {
  return entries.map(({ item, rank, tied }) => ({
    stat: item,
    rank,
    tied,
    paidCount: item.paidKeys.length,
    monthlyPrice: price(item),
    costPerWork: costPerWork(price(item), item.paidKeys.length),
  }));
}

/** 作品数重視: 有料見放題作品数の多い順（料金未登録サービスも含める） */
export function rankByWorkCount(stats: ServiceStat[], plans: VodPlanInfo[]): RankedService[] {
  const idx = serviceOrderIndex(plans);
  const sorted = stats
    .filter((s) => s.paidKeys.length > 0)
    .sort((a, b) =>
      b.paidKeys.length - a.paidKeys.length
      || comparePriceAsc(price(a), price(b))
      || idx(a.service) - idx(b.service));
  return toRanked(assignRanks(sorted, (a, b) => a.paidKeys.length === b.paidKeys.length));
}

/** 月額重視: 価格比較可能かつ作品1件以上のサービスを月額の安い順 */
export function rankByMonthlyPrice(stats: ServiceStat[], plans: VodPlanInfo[]): RankedService[] {
  const idx = serviceOrderIndex(plans);
  const sorted = stats
    .filter((s) => s.priceComparable && s.paidKeys.length > 0)
    .sort((a, b) =>
      price(a)! - price(b)!
      || b.paidKeys.length - a.paidKeys.length
      || idx(a.service) - idx(b.service));
  return toRanked(assignRanks(sorted, (a, b) => price(a) === price(b)));
}

/** コスパ重視: 1作品あたり料金の安い順（浮動小数を避け交差乗算で比較） */
export function rankByCostPerWork(stats: ServiceStat[], plans: VodPlanInfo[]): RankedService[] {
  const idx = serviceOrderIndex(plans);
  const cmpCost = (a: ServiceStat, b: ServiceStat) => price(a)! * b.paidKeys.length - price(b)! * a.paidKeys.length;
  const sorted = stats
    .filter((s) => s.priceComparable && s.paidKeys.length > 0)
    .sort((a, b) =>
      cmpCost(a, b)
      || b.paidKeys.length - a.paidKeys.length
      || price(a)! - price(b)!
      || idx(a.service) - idx(b.service));
  return toRanked(assignRanks(sorted, (a, b) => cmpCost(a, b) === 0));
}

// ─── 2サービス最適化 ────────────────────────────────────────────────────────────

function makeCombo(services: ServiceStat[]): ServiceCombo {
  const prices = services.map(price);
  return {
    services,
    unionCount: unionPaidKeys(services).size,
    totalPrice: prices.every((p) => p != null) ? prices.reduce<number>((a, p) => a + p!, 0) : null,
  };
}

function enumerateCombos(candidates: ServiceStat[], includeSingles: boolean): ServiceCombo[] {
  const combos: ServiceCombo[] = [];
  if (includeSingles) for (const s of candidates) combos.push(makeCombo([s]));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) combos.push(makeCombo([candidates[i], candidates[j]]));
  }
  return combos;
}

function comboOrderKey(combo: ServiceCombo, idx: (s: string) => number): number[] {
  return combo.services.map((s) => idx(s.service));
}

function compareOrderKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 一番多く見られる2サービス（料金未登録サービスも対象）。
 * 和集合の作品数 desc → 合計月額 asc（未登録は後ろ）→ サービス順。
 * 候補が1サービスしかない場合はその1サービスを返す。
 */
export function bestCoveragePair(stats: ServiceStat[], plans: VodPlanInfo[]): ServiceCombo | null {
  const idx = serviceOrderIndex(plans);
  const candidates = stats.filter((s) => s.paidKeys.length > 0).sort((a, b) => idx(a.service) - idx(b.service));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return makeCombo(candidates);
  const combos = enumerateCombos(candidates, false);
  combos.sort((a, b) =>
    b.unionCount - a.unionCount
    || comparePriceAsc(a.totalPrice, b.totalPrice)
    || compareOrderKeys(comboOrderKey(a, idx), comboOrderKey(b, idx)));
  return combos[0];
}

/**
 * 80%以上を最安で見る方法（価格比較可能なサービスのみ）。
 * 1サービスだけで条件を満たすものがあれば1サービスを優先し、その中の最安を選ぶ。
 * 無ければ2サービスの組み合わせの最安を選ぶ。
 * 同額の場合は作品数 desc → サービス順。
 */
export function cheapestOver80(stats: ServiceStat[], plans: VodPlanInfo[], paidTotal: number): Over80Result {
  const idx = serviceOrderIndex(plans);
  const candidates = stats
    .filter((s) => s.priceComparable && s.paidKeys.length > 0)
    .sort((a, b) => idx(a.service) - idx(b.service));
  const byPrice = (a: ServiceCombo, b: ServiceCombo) =>
    a.totalPrice! - b.totalPrice!
    || b.unionCount - a.unionCount
    || compareOrderKeys(comboOrderKey(a, idx), comboOrderKey(b, idx));

  const singles = candidates.map((s) => makeCombo([s]));
  const pairs = enumerateCombos(candidates, false);
  const okSingles = singles.filter((c) => meetsCoverageThreshold(c.unionCount, paidTotal)).sort(byPrice);
  if (okSingles.length > 0) return { achieved: true, combo: okSingles[0], bestPossible: null };
  const okPairs = pairs.filter((c) => meetsCoverageThreshold(c.unionCount, paidTotal)).sort(byPrice);
  if (okPairs.length > 0) return { achieved: true, combo: okPairs[0], bestPossible: null };

  const all = [...singles, ...pairs].sort((a, b) =>
    b.unionCount - a.unionCount || byPrice(a, b));
  return { achieved: false, combo: null, bestPossible: all[0] ?? null };
}

// ─── 代替手段・内訳・結論 ─────────────────────────────────────────────────────────

const ALT_BUCKET_ORDER: Record<ProviderBucket, number> = { paid: 0, free: 1, rental: 2, channel: 3, other: 4 };

export function findUnwatchable(works: DiagnosisWork[], topService: string | null): AlternativeEntry[] {
  return works
    .filter((w) => !w.services.some((s) => s.bucket === 'paid' && s.service === topService))
    .map((w) => ({
      key: w.key,
      alternatives: w.services
        .filter((s) => !(s.service === topService && s.bucket === 'paid'))
        .sort((a, b) => ALT_BUCKET_ORDER[a.bucket] - ALT_BUCKET_ORDER[b.bucket]),
    }))
    .filter((e) => e.alternatives.length > 0);
}

export function buildPersonBreakdown(
  persons: DiagnosisPersonInput[],
  works: DiagnosisWork[],
  stats: ServiceStat[],
): PersonBreakdown[] {
  const byKey = new Map(works.map((w) => [w.key, w]));
  return persons.map((person) => {
    const keys = [...new Set(person.works.map(workDedupKey))];
    const keySet = new Set(keys);
    const own = keys.map((k) => byKey.get(k)).filter((w): w is DiagnosisWork => !!w);
    const topServices = stats
      .map((stat) => ({ stat, count: stat.paidKeys.filter((k) => keySet.has(k)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count) // stats は既にサービス順のため安定ソートで同数はサービス順
      .slice(0, 3);
    return {
      name: person.name,
      group: person.group,
      registeredCount: keys.length,
      paidCount: own.filter((w) => w.services.some((s) => s.bucket === 'paid')).length,
      freeCount: own.filter((w) => w.services.some((s) => s.bucket === 'free')).length,
      topServices,
    };
  });
}

function joinNames(names: string[]): string {
  if (names.length <= 3) return names.join('と');
  return `${names.slice(0, 3).join('・')}ほか`;
}

/**
 * 結果画面最上部の結論文。
 * 月額・コスパ重視では別サービスが1位になりうるため、総合的な推薦（「一番合っている」等）ではなく
 * 「作品数ランキングの1位」であることが分かる表現にする。
 */
export function buildHeadline(persons: Array<{ name: string }>, byWorkCount: RankedService[]): string {
  const prefix = persons.length === 1 ? `${persons[0].name}なら` : `あなたの推し${persons.length}人なら`;
  if (byWorkCount.length === 0) {
    return `${prefix}、現在いずれの有料サブスクでも見放題の作品は確認できませんでした`;
  }
  const top = byWorkCount.filter((r) => r.rank === 1);
  if (top.length > 1) {
    return `${prefix}、作品数1位は${joinNames(top.map((r) => r.stat.displayName))}（同率）`;
  }
  return `${prefix}、作品数1位は${top[0].stat.displayName}`;
}

// ─── エントリポイント ────────────────────────────────────────────────────────────

export function computeOshiVodDiagnosis(persons: DiagnosisPersonInput[], options: DiagnosisOptions): DiagnosisResult {
  const plans = options.plans ?? VOD_PLAN_INFO;
  const planByService = new Map(plans.map((p) => [p.service, p]));
  const pick = options.pickRepresentative ?? ((records: WorkRecord[]) => records[0]);

  const works = groupWorksByKey(persons).map((g) => buildDiagnosisWork(g, options.terminatedSlugs, planByService, pick));
  const stats = computeServiceStats(works, plans);

  const hasBucket = (w: DiagnosisWork, b: ProviderBucket) => w.services.some((s) => s.bucket === b);
  const paidWorks = works.filter((w) => hasBucket(w, 'paid'));
  const freeWorks = works.filter((w) => hasBucket(w, 'free'));
  const totals: DiagnosisTotals = {
    registered: works.length,
    paid: paidWorks.length,
    streaming: works.filter((w) => w.isStreaming).length,
    free: freeWorks.length,
    freeOnly: freeWorks.filter((w) => !hasBucket(w, 'paid')).length,
    rentalOnly: works.filter((w) => w.services.length > 0 && w.services.every((s) => s.bucket === 'rental')).length,
    none: works.filter((w) => w.services.length === 0).length,
  };

  const byWorkCount = rankByWorkCount(stats, plans);
  const bestPair = bestCoveragePair(stats, plans);
  const topService = byWorkCount[0]?.stat.service ?? null;

  const checkedValues = works
    .filter((w) => w.services.length > 0)
    .map((w) => w.checkedAt)
    .filter((v): v is number => v != null);

  return {
    persons: persons.map((p) => ({ name: p.name, group: p.group })),
    works,
    totals,
    stats,
    byWorkCount,
    byMonthlyPrice: rankByMonthlyPrice(stats, plans),
    byCostPerWork: rankByCostPerWork(stats, plans),
    bestPair,
    singleCoversAll: totals.paid > 0 && (byWorkCount[0]?.paidCount ?? 0) === totals.paid,
    over80: cheapestOver80(stats, plans, totals.paid),
    freeWorkKeys: freeWorks.map((w) => w.key),
    unwatchable: findUnwatchable(works, topService),
    personBreakdown: buildPersonBreakdown(persons, works, stats),
    headline: buildHeadline(persons, byWorkCount),
    checkedRange: checkedValues.length > 0
      ? { min: Math.min(...checkedValues), max: Math.max(...checkedValues) }
      : null,
  };
}
