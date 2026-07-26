import { describe, it, expect } from 'vitest';
import {
  detectRecheckReasons,
  computeRecheckPriority,
  isValidRecheckAction,
  isValidRecheckPriority,
  resolveRecheckProcessStatus,
  shouldUpdateLastCheckedAt,
  RECHECK_STALE_DAYS,
  type RecheckReasonInput,
} from '../vod-recheck';
import { normalizeProviderName } from '../vod-dedup';
import type { VodProvider } from '@/types/vod';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-26T00:00:00.000Z');

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Hulu',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'tmdb_watch_provider',
    ...overrides,
  };
}

function baseInput(overrides: Partial<RecheckReasonInput>): RecheckReasonInput {
  return {
    vodProviders: [],
    lastVodCheckAt: undefined,
    vodAiCheckedAt: undefined,
    terminatedSlugs: new Set(['dtv', 'gyao', 'paravi']),
    isHighTraffic: false,
    isPostMergeUnchecked: false,
    now: NOW,
    ...overrides,
  };
}

describe('detectRecheckReasons — 180日ルール', () => {
  it('1. 180日以上未確認の判定: ちょうど180日前 → stale_180_days', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({})],
      lastVodCheckAt: NOW - RECHECK_STALE_DAYS * DAY_MS,
    }));
    expect(result.codes).toContain('stale_180_days');
  });

  it('2. 179日は対象外: stale_180_days を含まない', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({})],
      lastVodCheckAt: NOW - 179 * DAY_MS,
    }));
    expect(result.codes).not.toContain('stale_180_days');
    expect(result.codes).not.toContain('never_checked');
  });

  it('3. 180日は対象: 180日ちょうどで stale_180_days が付与される', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({})],
      lastVodCheckAt: NOW - 180 * DAY_MS,
    }));
    expect(result.codes).toContain('stale_180_days');
    expect(result.daysSinceLastCheck).toBe(180);
  });

  it('181日経過でも stale_180_days（境界より先も対象のまま）', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({})],
      lastVodCheckAt: NOW - 181 * DAY_MS,
    }));
    expect(result.codes).toContain('stale_180_days');
  });
});

describe('detectRecheckReasons — 確認日なし', () => {
  it('4. 確認日なしの判定: lastVodCheckAt/vodAiCheckedAt が両方未設定 → never_checked（stale_180_daysは付与しない）', () => {
    const result = detectRecheckReasons(baseInput({ vodProviders: [provider({})] }));
    expect(result.codes).toContain('never_checked');
    expect(result.codes).not.toContain('stale_180_days');
    expect(result.lastCheckedAt).toBeUndefined();
    expect(result.daysSinceLastCheck).toBeUndefined();
  });
});

describe('detectRecheckReasons — unknown / 有効VOD', () => {
  it('5. unknownのみの判定: 登録済みVODが全てunknown → unknown_only + no_active_provider', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({ providerName: 'unknown', type: 'unknown' })],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).toContain('unknown_only');
    expect(result.codes).toContain('no_active_provider');
    expect(result.activeCount).toBe(0);
  });

  it('6. unknownと有効サービス混在時の判定: unknown_only は付与されない（一部は有効なため）', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [
        provider({ providerId: 1, providerName: 'Hulu', type: 'flatrate' }),
        provider({ providerId: 2, providerName: 'unknown', type: 'unknown' }),
      ],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).not.toContain('unknown_only');
    expect(result.codes).not.toContain('no_active_provider');
    expect(result.activeCount).toBe(1);
  });

  it('7. 有効VODなしの判定: vodProviders が空配列 → no_active_provider（unknown_onlyは付与しない=何も登録されていないため）', () => {
    const result = detectRecheckReasons(baseInput({ vodProviders: [], lastVodCheckAt: NOW }));
    expect(result.codes).toContain('no_active_provider');
    expect(result.codes).not.toContain('unknown_only');
  });
});

describe('detectRecheckReasons — 終了済みサービス', () => {
  it('8. dTVを終了済みサービス候補として判定: deprecated_provider が付与される', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({ providerName: 'dTV', type: 'flatrate' })],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).toContain('deprecated_provider');
  });

  it('9. dTVをLeminoへ変換しない: providerNameは変更されず、正規化スラグもLeminoとは異なる', () => {
    const input = provider({ providerName: 'dTV', type: 'flatrate' });
    detectRecheckReasons(baseInput({ vodProviders: [input], lastVodCheckAt: NOW }));
    // detectRecheckReasons は入力を変更しない（副作用なしの純粋関数）
    expect(input.providerName).toBe('dTV');
    expect(normalizeProviderName('dTV')).not.toBe(normalizeProviderName('Lemino'));
    expect(normalizeProviderName('dTV')).toBe('dtv');
  });
});

describe('detectRecheckReasons — Prime Video名称・追加チャンネル', () => {
  it('10. Prime Video名称揺れを重複加算しない: "Amazon Prime Video" と "Prime Video" は1件として集計', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [
        provider({ providerId: 1, providerName: 'Amazon Prime Video', type: 'flatrate', source: 'tmdb_watch_provider' }),
        provider({ providerId: 2, providerName: 'Prime Video', type: 'flatrate', source: 'manual_csv' }),
      ],
      lastVodCheckAt: NOW,
    }));
    expect(result.activeCount).toBe(1);
    expect(result.codes).not.toContain('no_active_provider');
  });

  it('11. Amazon追加チャンネルをPrime Video本体へ統合しない: 本体＋追加チャンネルは2件として集計', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [
        provider({ providerId: 1, providerName: 'Amazon Prime Video', type: 'flatrate' }),
        provider({ providerId: 2, providerName: 'Amazon Prime Video（Leminoせれくと）', type: 'flatrate' }),
      ],
      lastVodCheckAt: NOW,
    }));
    expect(result.activeCount).toBe(2);
  });
});

describe('computeRecheckPriority — 優先度判定', () => {
  it('12. アクセス上位かつ180日以上未確認 → critical（最優先）', () => {
    expect(computeRecheckPriority(['high_traffic', 'stale_180_days'])).toBe('critical');
  });

  it('12. アクセス上位かつunknownのみ → critical', () => {
    expect(computeRecheckPriority(['high_traffic', 'unknown_only', 'no_active_provider'])).toBe('critical');
  });

  it('12. アクセス上位かつ有効VODなし → critical', () => {
    expect(computeRecheckPriority(['high_traffic', 'no_active_provider'])).toBe('critical');
  });

  it('アクセス上位のみ（他の問題なし）→ critical にはならない（lowのまま）', () => {
    expect(computeRecheckPriority(['high_traffic'])).toBe('low');
  });

  it('確認日なし単体 → high', () => {
    expect(computeRecheckPriority(['never_checked'])).toBe('high');
  });

  it('終了済みサービス候補単体 → high', () => {
    expect(computeRecheckPriority(['deprecated_provider'])).toBe('high');
  });

  it('統合後未確認単体 → high', () => {
    expect(computeRecheckPriority(['post_merge_unchecked'])).toBe('high');
  });

  it('sourceUrlなし単体 → medium', () => {
    expect(computeRecheckPriority(['missing_source'])).toBe('medium');
  });

  it('confidenceが低い単体 → medium', () => {
    expect(computeRecheckPriority(['low_confidence'])).toBe('medium');
  });

  it('確認日時不一致単体 → medium', () => {
    expect(computeRecheckPriority(['inconsistent_checked_at'])).toBe('medium');
  });

  it('unknown_onlyのみ（アクセス上位なし）→ low', () => {
    expect(computeRecheckPriority(['unknown_only', 'no_active_provider'])).toBe('low');
  });
});

describe('detectRecheckReasons — 統合後未確認', () => {
  it('post_merge_unchecked が入力どおりに反映される', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({})],
      lastVodCheckAt: NOW,
      isPostMergeUnchecked: true,
    }));
    expect(result.codes).toContain('post_merge_unchecked');
    expect(result.priority).toBe('high');
  });
});

describe('detectRecheckReasons — sourceUrl・confidence・確認日時不一致', () => {
  it('有効VODにsourceUrl/officialUrl/linkが無い → missing_source', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({ providerName: 'Netflix', type: 'flatrate' })],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).toContain('missing_source');
  });

  it('sourceUrlがあれば missing_source は付与されない', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({ providerName: 'Netflix', type: 'flatrate', sourceUrl: 'https://example.com' })],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).not.toContain('missing_source');
  });

  it('confidence="low" のVODがあれば low_confidence', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({
        providerName: 'Netflix', type: 'flatrate', source: 'openai_supplement', confidence: 'low', sourceUrl: 'https://example.com',
      })],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).toContain('low_confidence');
  });

  it('checkedDateがVODごとに異なる → inconsistent_checked_at', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [
        provider({ providerId: 1, providerName: 'Netflix', checkedDate: '2025-01-01', sourceUrl: 'https://example.com' }),
        provider({ providerId: 2, providerName: 'Hulu', checkedDate: '2026-06-01', sourceUrl: 'https://example.com' }),
      ],
      lastVodCheckAt: NOW,
    }));
    expect(result.codes).toContain('inconsistent_checked_at');
  });
});

describe('入力検証: action / priority', () => {
  it('19. 不正なstatusを拒否: isValidRecheckAction は不正値でfalse', () => {
    expect(isValidRecheckAction('delete_everything')).toBe(false);
    expect(isValidRecheckAction(123)).toBe(false);
    expect(isValidRecheckAction(undefined)).toBe(false);
  });

  it('有効なactionはtrue', () => {
    expect(isValidRecheckAction('start')).toBe(true);
    expect(isValidRecheckAction('complete')).toBe(true);
    expect(isValidRecheckAction('needs_review')).toBe(true);
    expect(isValidRecheckAction('skip')).toBe(true);
    expect(isValidRecheckAction('note')).toBe(true);
  });

  it('20. 不正なpriorityを拒否: isValidRecheckPriority は不正値でfalse', () => {
    expect(isValidRecheckPriority('urgent!!!')).toBe(false);
    expect(isValidRecheckPriority(1)).toBe(false);
  });

  it('有効なpriorityはtrue', () => {
    expect(isValidRecheckPriority('critical')).toBe(true);
    expect(isValidRecheckPriority('high')).toBe(true);
    expect(isValidRecheckPriority('medium')).toBe(true);
    expect(isValidRecheckPriority('low')).toBe(true);
  });
});

describe('resolveRecheckProcessStatus', () => {
  it('未設定は not_started として扱う', () => {
    expect(resolveRecheckProcessStatus(undefined)).toBe('not_started');
  });
  it('設定済みの値はそのまま返す', () => {
    expect(resolveRecheckProcessStatus('checked')).toBe('checked');
    expect(resolveRecheckProcessStatus('skipped')).toBe('skipped');
  });
});

describe('21. 再確認完了日時が保存される（shouldUpdateLastCheckedAt）', () => {
  it('complete のときだけ true', () => {
    expect(shouldUpdateLastCheckedAt('complete')).toBe(true);
  });
  it('start / needs_review / skip / note では false（確認完了ではないため確認日時を更新しない）', () => {
    expect(shouldUpdateLastCheckedAt('start')).toBe(false);
    expect(shouldUpdateLastCheckedAt('needs_review')).toBe(false);
    expect(shouldUpdateLastCheckedAt('skip')).toBe(false);
    expect(shouldUpdateLastCheckedAt('note')).toBe(false);
  });
});

describe('22. unknownが有効VOD数へ加算されない', () => {
  it('unknownのみのVODは activeCount に含まれない', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [
        provider({ providerId: 1, providerName: 'unknown', type: 'unknown' }),
        provider({ providerId: 2, providerName: '', type: 'flatrate' }),
      ],
      lastVodCheckAt: NOW,
    }));
    expect(result.activeCount).toBe(0);
  });
});

describe('23. dTVが有効VOD数へ加算されない', () => {
  it('terminatedSlugsに含まれるdTVは type/providerNameが正常でも activeCount に含まれない', () => {
    const result = detectRecheckReasons(baseInput({
      vodProviders: [provider({ providerName: 'dTV', type: 'flatrate' })],
      lastVodCheckAt: NOW,
      terminatedSlugs: new Set(['dtv']),
    }));
    expect(result.activeCount).toBe(0);
    expect(result.codes).toContain('no_active_provider');
    expect(result.codes).toContain('deprecated_provider');
  });
});
