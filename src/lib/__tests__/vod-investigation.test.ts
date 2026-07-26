import { describe, it, expect } from 'vitest';
import {
  buildInvestigationCandidates,
  canApproveCandidates,
  estimateInvestigationCost,
  buildImportCsvFromApprovedItems,
  isValidDecision,
  computeInvestigationProgress,
  canBulkApply,
  MAX_INVESTIGATION_ITEMS,
} from '../vod-investigation';
import { parseAndValidateImportCsv } from '../vod-recheck-csv';
import type { VodProvider } from '@/types/vod';

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Netflix',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'openai_web_search',
    ...overrides,
  };
}

const TERMINATED = new Set(['dtv', 'gyao', 'paravi']);

describe('buildInvestigationCandidates', () => {
  it('13. 有効サービスがない場合はunknown候補を作る', () => {
    const candidates = buildInvestigationCandidates([], TERMINATED);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerName).toBe('unknown');
    expect(candidates[0].type).toBe('unknown');
  });

  it('12. 有効サービスがある場合はunknownを追加しない', () => {
    const candidates = buildInvestigationCandidates(
      [provider({ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' })],
      TERMINATED,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates.some((p) => p.providerName === 'unknown')).toBe(false);
  });

  it('14. dTVを候補にしない', () => {
    const candidates = buildInvestigationCandidates(
      [provider({ providerName: 'dTV', type: 'flatrate' })],
      TERMINATED,
    );
    // dTVは除外され、結果として有効サービスなし→unknownのみになる
    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerName).toBe('unknown');
  });

  it('dTVと有効サービスが混在する場合、dTVだけ除外されNetflixは残る', () => {
    const candidates = buildInvestigationCandidates(
      [
        provider({ providerId: 1, providerName: 'dTV', type: 'flatrate' }),
        provider({ providerId: 2, providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' }),
      ],
      TERMINATED,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].providerName).toBe('Netflix');
  });

  it('15. dTVをLeminoへ変換しない（除外されるだけで名前が書き換わらない）', () => {
    const input = provider({ providerName: 'dTV', type: 'flatrate' });
    buildInvestigationCandidates([input], TERMINATED);
    expect(input.providerName).toBe('dTV'); // 入力は変更されない（副作用なし）
  });

  it('16. Prime Video名称を正規化する必要はここではない（表示層の責務）が、providerNameは保持される', () => {
    const candidates = buildInvestigationCandidates(
      [provider({ providerName: 'Amazon Prime Video', type: 'flatrate', sourceUrl: 'https://example.com' })],
      TERMINATED,
    );
    expect(candidates[0].providerName).toBe('Amazon Prime Video'); // DBの元名称は変更しない
  });

  it('17. Amazon追加チャンネルを本体へ統合しない（候補生成では個別のまま保持）', () => {
    const candidates = buildInvestigationCandidates(
      [
        provider({ providerId: 1, providerName: 'Amazon Prime Video', type: 'flatrate', sourceUrl: 'https://example.com' }),
        provider({ providerId: 2, providerName: 'Amazon Prime Video（Leminoせれくと）', type: 'flatrate', sourceUrl: 'https://example.com' }),
      ],
      TERMINATED,
    );
    expect(candidates).toHaveLength(2);
  });
});

describe('canApproveCandidates', () => {
  it('11. 公式URLなしの候補（実在サービス主張）は承認不可', () => {
    const candidates = [provider({ providerName: 'Netflix', type: 'flatrate' })]; // sourceUrl/officialUrlなし
    expect(canApproveCandidates(candidates)).toBe(false);
  });

  it('sourceUrlがあれば承認可能', () => {
    const candidates = [provider({ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' })];
    expect(canApproveCandidates(candidates)).toBe(true);
  });

  it('officialUrlがあれば承認可能', () => {
    const candidates = [provider({ providerName: 'Netflix', type: 'flatrate', officialUrl: 'https://example.com' })];
    expect(canApproveCandidates(candidates)).toBe(true);
  });

  it('unknown候補（配信なし確認済み）はURLなしでも承認可能', () => {
    const candidates = [provider({ providerName: 'unknown', type: 'unknown' })];
    expect(canApproveCandidates(candidates)).toBe(true);
  });

  it('候補が0件の場合は承認不可', () => {
    expect(canApproveCandidates([])).toBe(false);
  });
});

describe('estimateInvestigationCost', () => {
  it('5. 自動調査開始前に件数を表示する（対象作品数・呼び出し回数・費用概算）', () => {
    const estimate = estimateInvestigationCost(10, 0.00547, 150);
    expect(estimate.targetCount).toBe(10);
    expect(estimate.estimatedOpenAiCalls).toBe(10);
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.0547, 4);
    expect(estimate.estimatedCostJpy).toBeCloseTo(8.205, 2);
    expect(estimate.maxItems).toBe(MAX_INVESTIGATION_ITEMS);
  });

  it('6. 最大件数の定数は50', () => {
    expect(MAX_INVESTIGATION_ITEMS).toBe(50);
  });
});

describe('isValidDecision', () => {
  it('有効な決定値を受理する', () => {
    for (const v of ['pending', 'approved', 'rejected', 'needs_review', 'manual']) {
      expect(isValidDecision(v)).toBe(true);
    }
  });
  it('不正な決定値を拒否する', () => {
    expect(isValidDecision('bogus')).toBe(false);
    expect(isValidDecision(123)).toBe(false);
  });
});

describe('buildImportCsvFromApprovedItems — 既存CSV反映ロジックとの橋渡し', () => {
  it('承認済み候補から既存csv-importが受理できるCSVを組み立てる', () => {
    const csv = buildImportCsvFromApprovedItems([
      {
        workId: 'work-1',
        providers: [provider({ providerName: 'Netflix', type: 'flatrate', confidence: 'high', sourceUrl: 'https://example.com', note: 'テスト' })],
      },
    ]);
    const result = parseAndValidateImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0]).toEqual({
        workId: 'work-1',
        vodService: 'Netflix',
        availabilityType: 'flatrate',
        confidence: 'high',
        sourceUrl: 'https://example.com',
        note: 'テスト',
      });
    }
  });

  it('日本語workId・カンマを含むnoteでもCSVが崩れない', () => {
    const csv = buildImportCsvFromApprovedItems([
      {
        workId: 'ai-movie-映画『僕たちの嘘と真実』',
        providers: [provider({ providerName: 'U-NEXT', type: 'rent', note: '見放題, 期間限定' })],
      },
    ]);
    const result = parseAndValidateImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].workId).toBe('ai-movie-映画『僕たちの嘘と真実』');
    }
  });

  it('複数作品・複数サービスをまとめて変換できる', () => {
    const csv = buildImportCsvFromApprovedItems([
      { workId: 'work-1', providers: [provider({ providerName: 'Netflix' }), provider({ providerName: 'Hulu' })] },
      { workId: 'work-2', providers: [provider({ providerName: 'U-NEXT' })] },
    ]);
    const result = parseAndValidateImportCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(3);
  });
});

describe('computeInvestigationProgress', () => {
  it('各ステータスの件数を正しく集計する', () => {
    const progress = computeInvestigationProgress([
      { status: 'pending' }, { status: 'pending' },
      { status: 'investigating' },
      { status: 'needs_review' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'failed' },
    ]);
    expect(progress).toEqual({
      total: 7, pending: 2, investigating: 1, needsReview: 1, approved: 1, rejected: 1, failed: 1,
    });
  });
});

describe('22. 二重反映を防ぐ（canBulkApply）', () => {
  it('1件でも未確認（pending/needs_review）があれば一括反映しない', () => {
    expect(canBulkApply([{ decision: 'approved', status: 'approved' }, { decision: 'needs_review', status: 'needs_review' }])).toBe(false);
  });

  it('全件approved/manual/rejectedなら一括反映できる', () => {
    expect(canBulkApply([{ decision: 'approved', status: 'approved' }, { decision: 'manual', status: 'approved' }, { decision: 'rejected', status: 'rejected' }])).toBe(true);
  });

  it('アイテムが0件なら反映しない', () => {
    expect(canBulkApply([])).toBe(false);
  });
});
