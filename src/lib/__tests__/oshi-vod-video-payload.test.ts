import { describe, expect, it } from 'vitest';
import { computeOshiVodDiagnosis } from '../oshi-vod/core';
import { formatCoverage, formatMonthlyPrice, formatWorkFraction, formatYen, priceExclusionLabel } from '../oshi-vod/format';
import { toVideoDiagnosisPayload } from '../oshi-vod/video-payload';
import type { DiagnosisPersonInput } from '../oshi-vod/types';
import type { VodProvider, VodProviderType } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// 動画用の診断結果は computeOshiVodDiagnosis（診断ページと同じ計算）の値をそのまま取り出し、
// 表記はページと同じ format.ts の関数で作る（新しい計算をしない）ことを確認する。

function vp(providerName: string, type: VodProviderType = 'flatrate'): VodProvider {
  return { providerId: 0, providerName, type, countryCode: 'JP', source: 'manual_csv' };
}

function work(id: string, personName: string, providers: VodProvider[]): WorkRecord {
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
  } as WorkRecord;
}

function diagnose(persons: DiagnosisPersonInput[]) {
  const result = computeOshiVodDiagnosis(persons, { terminatedSlugs: new Set() });
  const payload = toVideoDiagnosisPayload(result, persons.map((p, i) => ({ slug: `p-00000000000${i}`, name: p.name })));
  return { result, payload };
}

/** 動画へ渡すJSONに undefined / NaN / Infinity が入らない */
function expectCleanJson(value: unknown): void {
  const text = JSON.stringify(value, (_k, v) => {
    if (v === undefined) throw new Error('undefined が含まれています');
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`数値でない値が含まれています: ${v}`);
    return v;
  });
  expect(text).not.toMatch(/undefined|NaN/);
}

// U-NEXT 3作品・Hulu 2作品（1作品は両方）・Netflix 4作品 → 2サービスの組み合わせはあるが80%未満
const COMBO_UNDER_80: DiagnosisPersonInput[] = [
  { name: '人物A', group: 'G', works: [work('1', '人物A', [vp('U-NEXT')]), work('2', '人物A', [vp('U-NEXT'), vp('Hulu')]), work('3', '人物A', [vp('Netflix')])] },
  { name: '人物B', group: 'G', works: [work('4', '人物B', [vp('Hulu')]), work('5', '人物B', [vp('Netflix')]), work('6', '人物B', [vp('U-NEXT')])] },
  { name: '人物C', group: 'H', works: [work('7', '人物C', [vp('Netflix')]), work('8', '人物C', [vp('Netflix')]), work('9', '人物C', [vp('Hulu', 'rent')])] },
];

describe('toVideoDiagnosisPayload', () => {
  it('診断結果の値をそのまま・ページと同じ表記で返す（組み合わせあり・80%未満）', () => {
    const { result, payload } = diagnose(COMBO_UNDER_80);
    const paid = result.totals.paid;
    expect(payload.persons.map((p) => p.name)).toEqual(['人物A', '人物B', '人物C']);
    expect(payload.persons[2].group).toBe('H');
    expect(payload.headline).toBe(result.headline);
    expect(payload.totals).toEqual(result.totals);
    expect(payload.byWorkCount.map((r) => r.service)).toEqual(result.byWorkCount.map((r) => r.stat.service));
    for (const [i, r] of result.byWorkCount.entries()) {
      const p = payload.byWorkCount[i];
      expect(p.paidCount).toBe(r.paidCount);
      expect(p.rank).toBe(r.rank);
      expect(p.rankLabel).toBe(r.tied ? `同率${r.rank}位` : `${r.rank}位`);
      expect(p.fractionText).toBe(formatWorkFraction(r.paidCount, paid));
      expect(p.coverageText).toBe(formatCoverage(r.paidCount, paid));
      expect(p.priceText).toBe(formatMonthlyPrice(r.stat.plan, r.stat.priceComparable));
      expect(p.costPerWork).toBe(r.costPerWork);
    }
    // Netflix は税込料金を公式で確認できないため料金比較対象外（推測の料金を出さない）
    const netflix = payload.byWorkCount.find((r) => r.service === 'netflix')!;
    expect(netflix.priceComparable).toBe(false);
    expect(netflix.monthlyPrice).toBeNull();
    expect(netflix.priceText).toBeNull();
    expect(netflix.costPerWork).toBeNull();
    expect(netflix.priceNote).toBe(priceExclusionLabel(result.stats.find((s) => s.service === 'netflix')!.plan, 'long'));
    expect(payload.byCostPerWork.every((r) => r.priceComparable && r.costPerWork != null)).toBe(true);
    // 組み合わせ: 和集合の作品数・カバー率・合計月額（料金未確認のサービスを含めば合計月額なし）
    expect(payload.bestPair).not.toBeNull();
    expect(payload.bestPair!.services.map((s) => s.service)).toEqual(result.bestPair!.services.map((s) => s.service));
    expect(payload.bestPair!.unionCount).toBe(result.bestPair!.unionCount);
    expect(payload.bestPair!.coverageText).toBe(formatCoverage(result.bestPair!.unionCount, paid));
    expect(payload.bestPair!.totalPrice).toBe(result.bestPair!.totalPrice);
    expect(payload.bestPair!.totalPriceText).toBe(result.bestPair!.totalPrice != null ? `合計 月額${formatYen(result.bestPair!.totalPrice)}` : null);
    expect(payload.over80.achieved).toBe(result.over80.achieved);
    expect(payload.over80.achieved).toBe(false);
    expectCleanJson(payload);
  });

  it('80%以上を1サービスで達成する場合', () => {
    const { result, payload } = diagnose([
      { name: '人物A', works: [work('1', '人物A', [vp('U-NEXT')]), work('2', '人物A', [vp('U-NEXT')]), work('3', '人物A', [vp('U-NEXT')])] },
      { name: '人物B', works: [work('4', '人物B', [vp('U-NEXT')]), work('5', '人物B', [vp('Hulu')])] },
      { name: '人物C', works: [] },
    ]);
    expect(result.over80.achieved).toBe(true);
    expect(payload.over80.achieved).toBe(true);
    expect(payload.over80.combo!.services.map((s) => s.service)).toEqual(['unext']);
    expect(payload.over80.combo!.coverageText).toBe('80%');
    expect(payload.over80.bestPossible).toBeNull();
    expectCleanJson(payload);
  });

  it('見放題のサービスが1つだけなら組み合わせは1サービス（2サービスを作らない）', () => {
    const { payload } = diagnose([
      { name: '人物A', works: [work('1', '人物A', [vp('U-NEXT')])] },
      { name: '人物B', works: [work('2', '人物B', [vp('U-NEXT')])] },
      { name: '人物C', works: [work('3', '人物C', [vp('Hulu', 'buy')])] },
    ]);
    expect(payload.byWorkCount.map((r) => r.service)).toEqual(['unext']);
    expect(payload.bestPair!.services).toHaveLength(1);
    expect(payload.singleCoversAll).toBe(true);
    expectCleanJson(payload);
  });

  it('料金を比較できないサービスだけの場合は料金・合計月額を出さない', () => {
    const { payload } = diagnose([
      { name: '人物A', works: [work('1', '人物A', [vp('Netflix')])] },
      { name: '人物B', works: [work('2', '人物B', [vp('Netflix')])] },
      { name: '人物C', works: [] },
    ]);
    expect(payload.byWorkCount[0].priceText).toBeNull();
    expect(payload.byWorkCount[0].priceNoteShort).toBe('税込料金未確認');
    expect(payload.byMonthlyPrice).toEqual([]);
    expect(payload.byCostPerWork).toEqual([]);
    expect(payload.bestPair!.totalPrice).toBeNull();
    expect(payload.bestPair!.totalPriceText).toBeNull();
    expect(payload.over80.achieved).toBe(false);
    expectCleanJson(payload);
  });

  it('見放題の作品が0件なら空の結果（生成の可否はサーバー側で判定する）', () => {
    const { payload } = diagnose([
      { name: '人物A', works: [work('1', '人物A', [vp('Hulu', 'rent')])] },
      { name: '人物B', works: [] },
      { name: '人物C', works: [] },
    ]);
    expect(payload.totals.paid).toBe(0);
    expect(payload.byWorkCount).toEqual([]);
    expect(payload.bestPair).toBeNull();
    expectCleanJson(payload);
  });
});
