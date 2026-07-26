import { describe, it, expect, vi } from 'vitest';

// mergeManualCsvVodProviders は純粋関数だが、work-store.ts 自体は @/db/client を
// モジュール読み込み時に初期化するため（neon()はDATABASE_URL未設定だと即エラー）、
// 既存の他テストと同じパターンでモックする。
vi.mock('@/db/client', () => ({
  neonSql: vi.fn(),
  db: { select: vi.fn(), insert: vi.fn() },
}));

import { mergeManualCsvVodProviders } from '../work-store';
import type { VodProvider } from '@/types/vod';

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Netflix',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'manual_csv',
    ...overrides,
  };
}

describe('mergeManualCsvVodProviders', () => {
  it('新規サービスは追加される', () => {
    const { merged, added, updated } = mergeManualCsvVodProviders([], [provider({ providerName: 'Netflix' })]);
    expect(merged).toHaveLength(1);
    expect(added).toBe(1);
    expect(updated).toBe(0);
  });

  it('同名のmanual_csvサービスは上書きされる（追加ではなく更新）', () => {
    const existing = [provider({ providerId: 1, providerName: 'Netflix', type: 'flatrate', source: 'manual_csv' })];
    const incoming = [provider({ providerId: 1, providerName: 'Netflix', type: 'rent', source: 'manual_csv' })];
    const { merged, added, updated } = mergeManualCsvVodProviders(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('rent');
    expect(added).toBe(0);
    expect(updated).toBe(1);
  });

  it('TMDb由来など他ソースのエントリは保持される（上書きしない）', () => {
    const existing = [provider({ providerId: 9, providerName: 'Prime Video', source: 'tmdb_watch_provider' })];
    const incoming = [provider({ providerId: 8, providerName: 'Netflix', source: 'manual_csv' })];
    const { merged } = mergeManualCsvVodProviders(existing, incoming);
    expect(merged).toHaveLength(2);
    expect(merged.some((p) => p.source === 'tmdb_watch_provider')).toBe(true);
  });

  it('既存配列を直接変更しない（イミュータブル）', () => {
    const existing = [provider({ providerName: 'Netflix' })];
    const existingCopy = [...existing];
    mergeManualCsvVodProviders(existing, [provider({ providerName: 'Hulu' })]);
    expect(existing).toEqual(existingCopy);
  });
});
