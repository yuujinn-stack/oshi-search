import { describe, it, expect } from 'vitest';
import {
  assignRanks,
  bestCoveragePair,
  buildHeadline,
  cheapestOver80,
  classifyProvider,
  computeOshiVodDiagnosis,
  computeServiceStats,
  costPerWork,
  coveragePercentFloor,
  coverageRatio,
  groupWorksByKey,
  meetsCoverageThreshold,
  rankByCostPerWork,
  rankByMonthlyPrice,
  rankByWorkCount,
  unionPaidKeys,
  workDedupKey,
} from '../oshi-vod/core';
import { getStreamingProviders } from '../vod-availability';
import { VOD_PLAN_INFO, type VodPlanInfo } from '../vod-plan-info';
import type { ServiceStat } from '../oshi-vod/types';
import type { VodProvider, VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// ─── テスト用ヘルパー ────────────────────────────────────────────────────────────
function vp(providerName: string, type: VodProviderType = 'flatrate', extra: Partial<VodProvider> = {}): VodProvider {
  return { providerId: 0, providerName, type, countryCode: 'JP', source: 'manual_csv', ...extra };
}

function work(id: string, personName: string, providers: VodProvider[], extra: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    personName,
    title: `作品${id}`,
    normalizedTitle: `作品${id}`,
    type: 'tv',
    source: 'tmdb',
    confidenceScore: 1,
    status: 'auto_published',
    vodProviders: providers,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function plan(service: string, monthlyPrice: number | null, isComparable = monthlyPrice != null): VodPlanInfo {
  return {
    service,
    kind: 'subscription',
    planName: 'テストプラン',
    monthlyPrice,
    taxIncluded: monthlyPrice != null ? true : null,
    sourceUrl: monthlyPrice != null ? 'https://example.com/' : null,
    checkedAt: monthlyPrice != null ? '2026-10-08' : null,
    isComparable,
    officialUrl: 'https://example.com/',
  };
}

const NO_TERMINATED = new Set<string>();
const planMap = new Map(VOD_PLAN_INFO.map((p) => [p.service, p]));

function stat(service: string, paidKeys: string[], price: number | null, plans: VodPlanInfo[]): ServiceStat {
  const p = plans.find((x) => x.service === service) ?? null;
  return {
    service,
    displayName: service,
    plan: p,
    priceComparable: price != null,
    paidKeys,
    freeKeys: [],
    rentalKeys: [],
  };
}

// ─── 作品重複排除 ────────────────────────────────────────────────────────────────
describe('作品重複排除', () => {
  it('canonicalWorkId があればそれをキーにする', () => {
    expect(workDedupKey({ id: 'a', canonicalWorkId: 'b' })).toBe('b');
    expect(workDedupKey({ id: 'a' })).toBe('a');
  });

  it('同じ作品に複数の選択人物が出演していても1作品として数え、出演者は全員記録する', () => {
    const groups = groupWorksByKey([
      { name: 'A', works: [work('w1', 'A', []), work('w2', 'A', [])] },
      { name: 'B', works: [work('w1', 'B', []), work('w3', 'B', [])] },
    ]);
    expect(groups.map((g) => g.key)).toEqual(['w1', 'w2', 'w3']);
    expect(groups[0].personNames).toEqual(['A', 'B']);
  });

  it('統合済み作品（alias）は canonical 作品と1つにまとまる', () => {
    const groups = groupWorksByKey([
      { name: 'A', works: [work('old', 'A', [], { canonicalWorkId: 'new' })] },
      { name: 'B', works: [work('new', 'B', [])] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('同一作品の配信情報は全行を合算して判定する（片方の行にしかない配信も拾う）', () => {
    const r = computeOshiVodDiagnosis([
      { name: 'A', works: [work('w1', 'A', [vp('Hulu')])] },
      { name: 'B', works: [work('w1', 'B', [vp('U-NEXT')])] },
    ], { terminatedSlugs: NO_TERMINATED });
    expect(r.totals.registered).toBe(1);
    expect(r.totals.paid).toBe(1);
    expect(r.byWorkCount.map((x) => x.stat.service).sort()).toEqual(['hulu', 'unext']);
    expect(r.byWorkCount.every((x) => x.paidCount === 1)).toBe(true);
  });
});

// ─── 分類（既存判定の再利用） ─────────────────────────────────────────────────────
describe('配信情報の分類', () => {
  it('作品ごとの配信種別を優先: 同じABEMA/Leminoでも free/ads は無料、flatrate は有料見放題', () => {
    expect(classifyProvider(vp('ABEMA', 'free'), planMap)).toBe('free');
    expect(classifyProvider(vp('ABEMA', 'ads'), planMap)).toBe('free');
    expect(classifyProvider(vp('ABEMA', 'flatrate'), planMap)).toBe('paid');
    expect(classifyProvider(vp('Lemino', 'free'), planMap)).toBe('free');
    expect(classifyProvider(vp('Lemino', 'flatrate'), planMap)).toBe('paid');
  });

  it('TVer・YouTube は有料サブスクに入れない', () => {
    expect(classifyProvider(vp('TVer', 'free'), planMap)).toBe('free');
    expect(classifyProvider(vp('TVer', 'flatrate'), planMap)).toBe('free');
    expect(classifyProvider(vp('YouTube', 'flatrate'), planMap)).toBe('free');
  });

  it('Prime Video 追加チャンネルは Prime Video 本体の見放題に数えない', () => {
    expect(classifyProvider(vp('FOD Channel Amazon Channel'), planMap)).toBe('channel');
    expect(classifyProvider(vp('Amazon Prime Video（Leminoセレクト）'), planMap)).toBe('channel');
    expect(classifyProvider(vp('NHKオンデマンド for Prime Video'), planMap)).toBe('channel');
    expect(classifyProvider(vp('Amazon Prime Video'), planMap)).toBe('paid');
    expect(classifyProvider(vp('Amazon Prime Video with Ads'), planMap)).toBe('paid');
  });

  it('rent / buy はレンタル扱い（Amazon Video 等も Prime Video 見放題に混ぜない）', () => {
    expect(classifyProvider(vp('U-NEXT', 'rent'), planMap)).toBe('rental');
    expect(classifyProvider(vp('Amazon Video', 'buy'), planMap)).toBe('rental');
  });

  it('料金情報に無いサービスの見放題は推測せず「その他」', () => {
    expect(classifyProvider(vp('Apple TV', 'flatrate'), planMap)).toBe('other');
    expect(classifyProvider(vp('WOWOWオンデマンド', 'flatrate'), planMap)).toBe('other');
  });

  it('hidden・unknown・AI低確度・終了済みサービスは除外される', () => {
    const r = computeOshiVodDiagnosis([
      {
        name: 'A',
        works: [
          work('w1', 'A', [vp('Hulu', 'flatrate', { hidden: true })]),
          work('w2', 'A', [vp('Hulu', 'unknown')]),
          work('w3', 'A', [vp('Hulu', 'flatrate', { source: 'openai_web_search', confidence: 'low' })]),
          work('w4', 'A', [vp('Paravi')]),
          work('w5', 'A', [vp('U-NEXT')]),
        ],
      },
    ], { terminatedSlugs: new Set(['paravi']) });
    expect(r.totals.registered).toBe(5);
    expect(r.totals.paid).toBe(1);
    expect(r.totals.none).toBe(4);
    expect(r.byWorkCount.map((x) => x.stat.service)).toEqual(['unext']);
  });

  it('「今すぐ見られる」件数は既存 getStreamingProviders と一致する（1人診断＝人物ページの配信中件数）', () => {
    const works = [
      work('w1', 'A', [vp('Hulu')]),
      work('w2', 'A', [vp('TVer', 'free')]),
      work('w3', 'A', [vp('U-NEXT', 'rent')]),
      work('w4', 'A', [vp('FOD Channel Amazon Channel')]),
      work('w5', 'A', [vp('Apple TV')]),
      work('w6', 'A', [vp('Hulu', 'flatrate', { hidden: true })]),
      work('w7', 'A', [vp('ABEMA', 'ads'), vp('ABEMA', 'flatrate', { source: 'tmdb_watch_provider' })]),
    ];
    const terminated = new Set(['dtv']);
    const expected = works.filter((w) => getStreamingProviders(w, terminated).length > 0).length;
    const r = computeOshiVodDiagnosis([{ name: 'A', works }], { terminatedSlugs: terminated });
    expect(r.totals.streaming).toBe(expected);
  });
});

// ─── 数値計算 ──────────────────────────────────────────────────────────────────
describe('カバー率・料金計算', () => {
  it('カバー率', () => {
    expect(coverageRatio(14, 21)).toBeCloseTo(0.6667, 3);
    expect(coverageRatio(1, 0)).toBe(0);
    expect(coveragePercentFloor(14, 21)).toBe(66.6);
    expect(coveragePercentFloor(21, 21)).toBe(100);
    expect(coveragePercentFloor(0, 0)).toBe(0);
    // 79.96% は四捨五入だと80.0%になるが切り捨てで79.9%（80%条件と表示が食い違わない）
    expect(coveragePercentFloor(1999, 2500)).toBe(79.9);
  });

  it('1作品あたり料金', () => {
    expect(costPerWork(2189, 14)).toBe(156);
    expect(costPerWork(2189, 0)).toBeNull();
    expect(costPerWork(null, 5)).toBeNull();
  });

  it('80%条件（整数判定・境界値）', () => {
    expect(meetsCoverageThreshold(16, 20)).toBe(true);
    expect(meetsCoverageThreshold(15, 20)).toBe(false);
    expect(meetsCoverageThreshold(4, 5)).toBe(true);
    expect(meetsCoverageThreshold(1999, 2500)).toBe(false);
    expect(meetsCoverageThreshold(2000, 2500)).toBe(true);
    expect(meetsCoverageThreshold(0, 0)).toBe(false);
  });

  it('2サービスの和集合は同じ作品を2重に数えない', () => {
    const plans = [plan('a', 100), plan('b', 100)];
    const u = unionPaidKeys([stat('a', ['1', '2', '3'], 100, plans), stat('b', ['2', '3', '4'], 100, plans)]);
    expect(u.size).toBe(4);
  });
});

// ─── ランキング ────────────────────────────────────────────────────────────────
describe('3種類のランキング', () => {
  const plans = [plan('a', 2000), plan('b', 1000), plan('c', null), plan('d', 500), plan('e', 1000)];
  const stats = [
    stat('a', ['1', '2', '3', '4'], 2000, plans),
    stat('b', ['1', '2'], 1000, plans),
    stat('c', ['1', '2', '3', '4', '5'], null, plans), // 料金未登録
    stat('d', ['5'], 500, plans),
    stat('e', ['3', '4'], 1000, plans),
    stat('z', [], 300, plans), // 作品0
  ];

  it('作品数重視: 料金未登録も含み、作品数 desc。同数は価格の安い順→サービス順で同率表示', () => {
    const r = rankByWorkCount(stats, plans);
    expect(r.map((x) => x.stat.service)).toEqual(['c', 'a', 'b', 'e', 'd']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 3, 5]);
    expect(r.map((x) => x.tied)).toEqual([false, false, true, true, false]);
    expect(r[0].monthlyPrice).toBeNull();
  });

  it('月額重視: 料金未登録を除外し、月額 asc。同額は作品数 desc', () => {
    const r = rankByMonthlyPrice(stats, plans);
    expect(r.map((x) => x.stat.service)).toEqual(['d', 'b', 'e', 'a']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 2, 4]);
  });

  it('コスパ重視: 1作品あたり料金 asc（交差乗算）。同値は作品数 desc', () => {
    // a=500/作品, b=500/作品, d=500/作品, e=500/作品 → 全て同率。作品数 desc → 価格 asc → 順
    const r = rankByCostPerWork(stats, plans);
    expect(r.map((x) => x.stat.service)).toEqual(['a', 'b', 'e', 'd']);
    expect(r.every((x) => x.rank === 1 && x.tied)).toBe(true);
    expect(r[0].costPerWork).toBe(500);
  });

  it('同率処理（1,1,3 方式）', () => {
    const ranked = assignRanks([5, 5, 3, 3, 3, 1], (a, b) => a === b);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3, 3, 3, 6]);
    expect(ranked[5].tied).toBe(false);
  });

  it('提携情報は入力に存在せず、順位は作品数・料金だけで決まる（同入力→同結果）', () => {
    const r1 = rankByWorkCount(stats, plans).map((x) => x.stat.service);
    const r2 = rankByWorkCount([...stats].reverse(), plans).map((x) => x.stat.service);
    expect(r1).toEqual(r2);
  });
});

// ─── 2サービス最適化 ─────────────────────────────────────────────────────────────
describe('2サービス最適化', () => {
  it('一番多く見られる2サービス: 和集合最大。同数なら合計月額の安い組み合わせ', () => {
    const plans = [plan('a', 2000), plan('b', 1000), plan('c', 500)];
    const stats = [
      stat('a', ['1', '2', '3'], 2000, plans),
      stat('b', ['3', '4'], 1000, plans),
      stat('c', ['3', '4'], 500, plans),
    ];
    const pair = bestCoveragePair(stats, plans)!;
    expect(pair.services.map((s) => s.service)).toEqual(['a', 'c']);
    expect(pair.unionCount).toBe(4);
    expect(pair.totalPrice).toBe(2500);
  });

  it('候補が1サービスのみならそのサービス、0なら null', () => {
    const plans = [plan('a', 2000)];
    expect(bestCoveragePair([stat('a', ['1'], 2000, plans)], plans)!.services).toHaveLength(1);
    expect(bestCoveragePair([], plans)).toBeNull();
  });

  it('80%以上を最安で: 1サービスで達成できるなら、より安い2サービスがあっても1サービスを優先', () => {
    const plans = [plan('a', 2000), plan('b', 300), plan('c', 300)];
    const stats = [
      stat('a', ['1', '2', '3', '4', '5', '6', '7', '8', '9'], 2000, plans), // 90%
      stat('b', ['1', '2', '3', '4', '5'], 300, plans),
      stat('c', ['6', '7', '8', '9'], 300, plans), // b+c = 90% で 600円
    ];
    const r = cheapestOver80(stats, plans, 10);
    expect(r.achieved).toBe(true);
    expect(r.combo!.services.map((s) => s.service)).toEqual(['a']);
  });

  it('80%以上を最安で: 1サービスで届かない場合は2サービスの最安', () => {
    const plans = [plan('a', 1000), plan('b', 500), plan('c', 400), plan('d', null)];
    const stats = [
      stat('a', ['1', '2', '3', '4', '5'], 1000, plans),
      stat('b', ['6', '7', '8'], 500, plans),
      stat('c', ['5', '6', '7', '8'], 400, plans),
      stat('d', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], null, plans), // 料金未登録は対象外
    ];
    const r = cheapestOver80(stats, plans, 10);
    expect(r.achieved).toBe(true);
    // a+b=8件(1500円) / a+c=8件(1400円) → a+c
    expect(r.combo!.services.map((s) => s.service)).toEqual(['a', 'c']);
    expect(r.combo!.unionCount).toBe(8);
  });

  it('80%以上を満たす組み合わせが無い場合は achieved=false と最大カバー構成', () => {
    const plans = [plan('a', 1000), plan('b', 500)];
    const stats = [stat('a', ['1', '2'], 1000, plans), stat('b', ['3'], 500, plans)];
    const r = cheapestOver80(stats, plans, 10);
    expect(r.achieved).toBe(false);
    expect(r.combo).toBeNull();
    expect(r.bestPossible!.unionCount).toBe(3);
  });
});

// ─── 統合 ──────────────────────────────────────────────────────────────────────
describe('computeOshiVodDiagnosis', () => {
  const persons = [
    {
      name: 'A',
      group: 'G',
      works: [
        work('w1', 'A', [vp('U-NEXT'), vp('Hulu')], { vodUpdatedAt: 1000 }),
        work('w2', 'A', [vp('U-NEXT'), vp('TVer', 'free')], { vodUpdatedAt: 2000 }),
        work('w3', 'A', [vp('Hulu'), vp('U-NEXT', 'rent')]),
        work('w4', 'A', [vp('ABEMA', 'free')]),
        work('w5', 'A', [vp('U-NEXT', 'rent')]),
        work('w6', 'A', []),
      ],
    },
    {
      name: 'B',
      group: 'G',
      works: [
        work('w1', 'B', [vp('U-NEXT')]),
        work('w7', 'B', [vp('U-NEXT'), vp('FOD Channel Amazon Channel')]),
      ],
    },
  ];
  const r = computeOshiVodDiagnosis(persons, { terminatedSlugs: NO_TERMINATED });

  it('合計値（登録・有料見放題・無料・レンタルのみ・配信なし）', () => {
    expect(r.totals).toEqual({ registered: 7, paid: 4, streaming: 5, free: 2, freeOnly: 1, rentalOnly: 1, none: 1 });
  });

  it('作品数1位と結論文', () => {
    expect(r.byWorkCount[0].stat.service).toBe('unext');
    expect(r.byWorkCount[0].paidCount).toBe(3);
    expect(r.headline).toBe('あなたの推し2人なら、作品数1位はU-NEXT');
  });

  it('1位で見られない作品と代替手段（追加チャンネルは別扱い）', () => {
    const keys = r.unwatchable.map((e) => e.key);
    expect(keys).toEqual(['w3', 'w4', 'w5']);
    const w3 = r.unwatchable.find((e) => e.key === 'w3')!;
    expect(w3.alternatives.map((a) => `${a.service}:${a.bucket}`)).toEqual(['hulu:paid', 'unext:rental']);
  });

  it('人物別内訳: 同じ作品を各人物側に表示', () => {
    const b = r.personBreakdown.find((p) => p.name === 'B')!;
    expect(b.registeredCount).toBe(2);
    expect(b.paidCount).toBe(2);
    expect(b.topServices[0].stat.service).toBe('unext');
    expect(b.topServices[0].count).toBe(2);
  });

  it('確認日は既存データの値のみを使う', () => {
    expect(r.checkedRange).toEqual({ min: 1000, max: 2000 });
    expect(r.works.find((w) => w.key === 'w3')!.checkedAt).toBeUndefined();
  });

  it('無料で見られる作品（キー参照）', () => {
    expect(r.freeWorkKeys).toEqual(['w2', 'w4']);
  });

  it('1サービスで全作品カバーかどうか', () => {
    expect(r.singleCoversAll).toBe(false);
  });

  it('有料見放題が0件の場合の結論文', () => {
    expect(buildHeadline([{ name: 'A' }], [])).toBe('Aなら、現在いずれの有料サブスクでも見放題の作品は確認できませんでした');
  });

  it('同率1位の結論文', () => {
    const plans = [plan('hulu', 1000), plan('unext', 1000)];
    const stats = computeServiceStats([], plans);
    expect(stats).toEqual([]);
    const tied = computeOshiVodDiagnosis([{ name: 'A', works: [work('w1', 'A', [vp('Hulu'), vp('U-NEXT')])] }], { terminatedSlugs: NO_TERMINATED });
    expect(tied.headline).toBe('Aなら、作品数1位はHuluとU-NEXT（同率）');
  });
});

describe('Amazon Video（レンタル・購入）と Prime Video 本体の表示区別', () => {
  const both = () => computeOshiVodDiagnosis(
    [{ name: 'A', works: [
      work('w1', 'A', [vp('Amazon Prime Video'), vp('Amazon Video', 'rent')]),
      work('w2', 'A', [vp('Prime Video'), vp('Hulu')]),
    ] }],
    { terminatedSlugs: NO_TERMINATED },
  );

  it('同じ作品に Prime Video 見放題とレンタル・購入がある場合、サービス単位（詳しい比較）では別名で表示する', () => {
    const r = both();
    const w1 = r.works.find((w) => w.key === 'w1')!;
    // 作品ごとの表示（チップ）は種別ラベルで区別できるため従来どおりの名前・種別
    const names = w1.services.map((s) => `${s.service}:${s.displayName}:${s.type}:${s.bucket}`);
    expect(names).toContain('primevideo:Prime Video:flatrate:paid');
    expect(names).toContain('amazonvideo:Prime Video:rent:rental');
    const stats = Object.fromEntries(r.stats.map((s) => [s.service, s]));
    expect(stats.primevideo.displayName).toBe('Prime Video');
    expect(stats.amazonvideo.displayName).toBe('Prime Video レンタル・購入');
    // 詳しい比較のカード名が重複しない
    const displayNames = r.stats.map((s) => s.displayName);
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });

  it('レンタル・購入はランキング（作品数・月額・コスパ・2サービス・80%）に入らない', () => {
    const r = both();
    for (const list of [r.byWorkCount, r.byMonthlyPrice, r.byCostPerWork]) {
      expect(list.map((x) => x.stat.service)).not.toContain('amazonvideo');
    }
    expect(r.bestPair?.services.map((s) => s.service) ?? []).not.toContain('amazonvideo');
    expect(r.over80.combo?.services.map((s) => s.service) ?? []).not.toContain('amazonvideo');
    expect(r.stats.find((s) => s.service === 'primevideo')!.paidKeys).toEqual(['w1', 'w2']);
    expect(r.stats.find((s) => s.service === 'amazonvideo')!.paidKeys).toEqual([]);
  });
});
