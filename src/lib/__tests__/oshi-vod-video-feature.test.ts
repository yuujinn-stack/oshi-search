import { describe, expect, it } from 'vitest';
import {
  checkVodCompareSharedCapcut,
  oshiVodVideoFeature,
  parseSharedCapcutRequirement,
  VOD_COMPARE_CAPCUT_MISMATCH_MESSAGE,
} from '@/lib/oshi-vod/video-feature';

// 動画「推しでサブスク比較」: 診断結果の台本の種類と、テンプレート共通CapCut音声の利用可否（oshi-video-maker の判定と同じ条件）

const svc = (service: string) => ({ service });
const combo = (services: string[]) => ({ services: services.map(svc) }) as never;

function d(over: { bestPair?: string[] | null; singleCoversAll?: boolean; over80?: { achieved: boolean; combo: string[] | null } }) {
  return {
    bestPair: over.bestPair ? combo(over.bestPair) : null,
    singleCoversAll: over.singleCoversAll ?? false,
    over80: { achieved: over.over80?.achieved ?? false, combo: over.over80?.combo ? combo(over.over80.combo) : null, bestPossible: null },
  };
}

const PAIR_TEMPLATE = {
  narrationModes: ['capcut', 'none'],
  sharedCapcut: { ready: true, message: '共通音声', requires: { kind: 'oshi-vod-compare-feature' as const, feature: 'pair' as const } },
};

describe('oshiVodVideoFeature', () => {
  it('2サービスの組み合わせ（80%以上の表示なし）→ pair', () => {
    expect(oshiVodVideoFeature(d({ bestPair: ['unext', 'hulu'] }))).toBe('pair');
    // 80%以上を達成した組み合わせが別のサービスの組なら、画面に80%の表示は出ない（pair のまま）
    expect(oshiVodVideoFeature(d({ bestPair: ['unext', 'hulu'], over80: { achieved: true, combo: ['unext', 'fod'] } }))).toBe('pair');
  });
  it('その組み合わせで80%以上 → pair-over80（サービスの並び順は問わない）', () => {
    expect(oshiVodVideoFeature(d({ bestPair: ['unext', 'hulu'], over80: { achieved: true, combo: ['hulu', 'unext'] } }))).toBe('pair-over80');
  });
  it('組み合わせなし・1サービスだけの組み合わせ → single、1サービスで全作品 → single-covers-all', () => {
    expect(oshiVodVideoFeature(d({ bestPair: null }))).toBe('single');
    expect(oshiVodVideoFeature(d({ bestPair: ['unext'] }))).toBe('single');
    expect(oshiVodVideoFeature(d({ bestPair: ['unext'], singleCoversAll: true }))).toBe('single-covers-all');
    expect(oshiVodVideoFeature(d({ bestPair: ['unext', 'hulu'], singleCoversAll: true }))).toBe('single-covers-all');
  });
});

describe('parseSharedCapcutRequirement', () => {
  it('知っている種別・種類だけ受け付ける（それ以外は条件不明＝null）', () => {
    expect(parseSharedCapcutRequirement({ kind: 'oshi-vod-compare-feature', feature: 'pair' })).toEqual({ kind: 'oshi-vod-compare-feature', feature: 'pair' });
    expect(parseSharedCapcutRequirement({ kind: 'other', feature: 'pair' })).toBeNull();
    expect(parseSharedCapcutRequirement({ kind: 'oshi-vod-compare-feature', feature: 'any' })).toBeNull();
    expect(parseSharedCapcutRequirement(undefined)).toBeNull();
    expect(parseSharedCapcutRequirement('pair')).toBeNull();
  });
});

describe('checkVodCompareSharedCapcut', () => {
  it('pair（80%以上の表示なし）の3人だけ共通音声を使える', () => {
    expect(checkVodCompareSharedCapcut(PAIR_TEMPLATE, d({ bestPair: ['unext', 'hulu'] }))).toEqual({ ok: true });
  });
  it('80%以上・組み合わせなし・1サービスで全作品の3人は、日本語の理由で拒否する', () => {
    for (const diag of [
      d({ bestPair: ['unext', 'hulu'], over80: { achieved: true, combo: ['unext', 'hulu'] } }),
      d({ bestPair: null }),
      d({ bestPair: ['unext'], singleCoversAll: true }),
    ]) {
      expect(checkVodCompareSharedCapcut(PAIR_TEMPLATE, diag)).toEqual({ ok: false, reason: VOD_COMPARE_CAPCUT_MISMATCH_MESSAGE });
    }
  });
  it('Workerが共通音声・利用条件を報告していない／準備できていない場合も拒否する（安全側）', () => {
    const pair = d({ bestPair: ['unext', 'hulu'] });
    expect(checkVodCompareSharedCapcut({ narrationModes: ['none'] }, pair).ok).toBe(false);
    expect(checkVodCompareSharedCapcut({ narrationModes: ['capcut', 'none'] }, pair).ok).toBe(false);
    expect(checkVodCompareSharedCapcut({ ...PAIR_TEMPLATE, sharedCapcut: { ready: true, message: '' } }, pair).ok).toBe(false);
    const notReady = checkVodCompareSharedCapcut({ ...PAIR_TEMPLATE, sharedCapcut: { ...PAIR_TEMPLATE.sharedCapcut, ready: false, message: '台本が一致しません' } }, pair);
    expect(notReady).toEqual({ ok: false, reason: '共通CapCut音声が使えないため生成できません: 台本が一致しません' });
  });
});
