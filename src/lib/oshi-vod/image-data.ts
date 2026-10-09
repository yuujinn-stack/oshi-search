// 診断結果画像（/api/oshi-vod/image）に載せる内容を、診断結果から組み立てる（純粋関数）。
// 画像には最低限「診断名・選択人物・作品数重視1位・対象作品数・2サービス最適解・推しサーチ名・
// oshi-search.jp への誘導」を含める。数値は結果ページと同じ core.ts の計算結果をそのまま使う。
import type { DiagnosisResult } from './types';
import { formatCoverage, formatMonthlyPrice } from './format';

export interface OshiVodImageService {
  service: string;
  displayName: string;
}

export interface OshiVodImageData {
  personNames: string[];
  top: {
    services: OshiVodImageService[];
    tied: boolean;
    paidCount: number;
    coverage: string;
    /** 1サービスのときのみ（価格比較不可なら null） */
    price: string | null;
  } | null;
  paidTotal: number;
  registered: number;
  free: number;
  pair: {
    services: OshiVodImageService[];
    unionCount: number;
    coverage: string;
  } | null;
}

export function buildOshiVodImageData(result: DiagnosisResult): OshiVodImageData {
  const paidTotal = result.totals.paid;
  const topRanked = result.byWorkCount.filter((r) => r.rank === 1);
  const first = topRanked[0];
  const pair = result.bestPair;
  return {
    personNames: result.persons.map((p) => p.name),
    top: first
      ? {
          services: topRanked.map((r) => ({ service: r.stat.service, displayName: r.stat.displayName })),
          tied: topRanked.length > 1,
          paidCount: first.paidCount,
          coverage: formatCoverage(first.paidCount, paidTotal),
          price: topRanked.length === 1 ? formatMonthlyPrice(first.stat.plan, first.stat.priceComparable) : null,
        }
      : null,
    paidTotal,
    registered: result.totals.registered,
    free: result.totals.free,
    pair: pair && pair.services.length === 2
      ? {
          services: pair.services.map((s) => ({ service: s.service, displayName: s.displayName })),
          unionCount: pair.unionCount,
          coverage: formatCoverage(pair.unionCount, paidTotal),
        }
      : null,
  };
}
