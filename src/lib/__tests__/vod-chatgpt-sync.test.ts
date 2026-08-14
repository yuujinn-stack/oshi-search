import { describe, it, expect } from 'vitest';
import {
  computeChatgptFullSync, isChatgptScopeService, CHATGPT_SCOPE_SLUGS, CHATGPT_SERVICE_SCOPE,
  isChatgptProtectionActive, stripChatgptScopeServices, isChatgptResearchStale, CHATGPT_PROTECTION_DAYS,
} from '../vod-chatgpt-sync';
import type { VodProvider } from '@/types/vod';

const DAY_MS = 24 * 60 * 60 * 1000;

function provider(overrides: Partial<VodProvider>): VodProvider {
  return {
    providerId: 1,
    providerName: 'Hulu',
    type: 'flatrate',
    countryCode: 'JP',
    source: 'manual_csv',
    ...overrides,
  };
}

describe('CHATGPT_SCOPE_SLUGS / isChatgptScopeService', () => {
  it('対象14サービス全てがscopeに含まれる', () => {
    expect(CHATGPT_SCOPE_SLUGS.size).toBe(14);
    for (const name of [
      'Hulu', 'U-NEXT', 'Lemino', 'Netflix', 'Prime Video', 'DMM TV', 'TELASA',
      'FOD', 'ABEMA', 'TVer', 'Disney+', 'YouTube', 'NHKオンデマンド', 'のぎ動画',
    ]) {
      expect(isChatgptScopeService(name)).toBe(true);
    }
  });

  it('対象14サービス以外はscope外', () => {
    expect(isChatgptScopeService('WOWOW')).toBe(false);
    expect(isChatgptScopeService('特殊provider-X')).toBe(false);
    expect(isChatgptScopeService('dTV')).toBe(false);
  });

  it('CHATGPT_SERVICE_SCOPE定数がmajor14である', () => {
    expect(CHATGPT_SERVICE_SCOPE).toBe('major14');
  });
});

describe('computeChatgptFullSync — 完全同期の基本動作', () => {
  it('新規: 既存が空でCSVにHulu・Disney+ → 両方addedになる', () => {
    const { merged, diff, resultCount } = computeChatgptFullSync([], [
      { providerName: 'Hulu', type: 'flatrate' },
      { providerName: 'Disney+', type: 'flatrate' },
    ]);
    expect(diff.added.sort()).toEqual(['Disney+', 'Hulu']);
    expect(diff.removed).toEqual([]);
    expect(merged.length).toBe(2);
    expect(resultCount).toBe(2);
  });

  it('ユーザー提示の例: Lemino/Huluが登録済み → 再調査結果Disney+/Hulu → LeminoはremovedでDisney+はadded・Huluはunchanged', () => {
    const existing: VodProvider[] = [
      provider({ providerName: 'Lemino', type: 'flatrate' }),
      provider({ providerName: 'Hulu', type: 'flatrate' }),
    ];
    const { merged, diff } = computeChatgptFullSync(existing, [
      { providerName: 'Disney+', type: 'flatrate' },
      { providerName: 'Hulu', type: 'flatrate' },
    ]);
    expect(diff.added).toEqual(['Disney+']);
    expect(diff.removed).toEqual(['Lemino']);
    expect(diff.unchanged).toEqual(['Hulu']);
    const names = merged.map((p) => p.providerName).sort();
    expect(names).toEqual(['Disney+', 'Hulu']);
    expect(names).not.toContain('Lemino');
  });

  it('type変更はupdatedとして検出される', () => {
    const existing: VodProvider[] = [provider({ providerName: 'Netflix', type: 'rent' })];
    const { diff } = computeChatgptFullSync(existing, [{ providerName: 'Netflix', type: 'flatrate' }]);
    expect(diff.updated).toEqual([{ service: 'Netflix', before: 'rent', after: 'flatrate' }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('14サービス以外（特殊provider）は一切変更しない', () => {
    const existing: VodProvider[] = [
      provider({ providerName: 'Lemino', type: 'flatrate' }),
      provider({ providerName: '特殊provider-X', type: 'flatrate', source: 'manual' }),
    ];
    const { merged, diff } = computeChatgptFullSync(existing, [{ providerName: 'Hulu', type: 'flatrate' }]);
    expect(diff.removed).toEqual(['Lemino']); // 14サービス内のみ対象
    const outsideScope = merged.find((p) => p.providerName === '特殊provider-X');
    expect(outsideScope).toBeDefined();
    expect(outsideScope?.type).toBe('flatrate'); // 変更されていない
  });

  it('STEP74: 現在Hulu/Netflixが登録済み、CSVがunknown（サービス0件） → 対象14VOD=0件、両方removed', () => {
    const existing: VodProvider[] = [
      provider({ providerName: 'Hulu', type: 'flatrate' }),
      provider({ providerName: 'Netflix', type: 'flatrate' }),
    ];
    const { merged, diff, resultCount } = computeChatgptFullSync(existing, []); // unknown行は呼び出し側でservices=[]として渡す
    expect(resultCount).toBe(0);
    expect(diff.removed.sort()).toEqual(['Hulu', 'Netflix']);
    expect(merged.filter((p) => isChatgptScopeService(p.providerName)).length).toBe(0);
  });

  it('新規に生成するproviderは source: manual_csv, sourceLabel: ChatGPT完全調査 を持つ', () => {
    const { merged } = computeChatgptFullSync([], [{ providerName: 'Hulu', type: 'flatrate', confidence: 'high' }]);
    expect(merged[0].source).toBe('manual_csv');
    expect(merged[0].sourceLabel).toBe('ChatGPT完全調査');
  });
});

describe('isChatgptProtectionActive — 保護期間の判定', () => {
  it('既存のRECHECK_STALE_DAYS（180日）と一致する', () => {
    expect(CHATGPT_PROTECTION_DAYS).toBe(180);
  });

  it('chatgptResearchModeがfull_syncでない場合は常にfalse', () => {
    expect(isChatgptProtectionActive({ lastChatgptResearchAt: Date.now() })).toBe(false);
  });

  it('lastChatgptResearchAt未設定の場合はfalse', () => {
    expect(isChatgptProtectionActive({ chatgptResearchMode: 'full_sync' })).toBe(false);
  });

  it('179日経過はまだ保護期間内（true）、181日経過は保護期間外（false）', () => {
    const now = Date.now();
    expect(isChatgptProtectionActive({ chatgptResearchMode: 'full_sync', lastChatgptResearchAt: now - 179 * DAY_MS }, now)).toBe(true);
    expect(isChatgptProtectionActive({ chatgptResearchMode: 'full_sync', lastChatgptResearchAt: now - 181 * DAY_MS }, now)).toBe(false);
  });

  it('推奨優先順位: 判定基準は常にlastChatgptResearchAtのみ（他の日時に影響されない）', () => {
    const now = Date.now();
    // ChatGPT調査: 2026/08/01, その後TMDb Cron等が2026/09/15に実行されても
    // isChatgptProtectionActiveの判定はlastChatgptResearchAt（2026/08/01）基準のまま変わらない
    const lastChatgptResearchAt = now - 45 * DAY_MS; // 45日前 = 保護期間内
    expect(isChatgptProtectionActive({ chatgptResearchMode: 'full_sync', lastChatgptResearchAt }, now)).toBe(true);
  });
});

describe('stripChatgptScopeServices', () => {
  it('対象14サービスのみ除去し、14サービス外は残す', () => {
    const providers: VodProvider[] = [
      { providerId: 1, providerName: 'Disney+', type: 'flatrate', countryCode: 'JP', source: 'tmdb_watch_provider' },
      { providerId: 2, providerName: 'WOWOW', type: 'flatrate', countryCode: 'JP', source: 'tmdb_watch_provider' },
    ];
    const result = stripChatgptScopeServices(providers);
    expect(result.map((p) => p.providerName)).toEqual(['WOWOW']);
  });
});

describe('isChatgptResearchStale — 30/60/90/180日フィルターの境界値', () => {
  const now = Date.now();

  it('未調査（lastChatgptResearchAt未設定）は常にfalse', () => {
    expect(isChatgptResearchStale(undefined, 30, now)).toBe(false);
  });

  it('30日フィルター: 29日前はfalse、30日前はtrue', () => {
    expect(isChatgptResearchStale(now - 29 * DAY_MS, 30, now)).toBe(false);
    expect(isChatgptResearchStale(now - 30 * DAY_MS, 30, now)).toBe(true);
  });

  it('60日フィルター: 59日前はfalse、60日前はtrue', () => {
    expect(isChatgptResearchStale(now - 59 * DAY_MS, 60, now)).toBe(false);
    expect(isChatgptResearchStale(now - 60 * DAY_MS, 60, now)).toBe(true);
  });

  it('90日フィルター: 89日前はfalse、90日前はtrue', () => {
    expect(isChatgptResearchStale(now - 89 * DAY_MS, 90, now)).toBe(false);
    expect(isChatgptResearchStale(now - 90 * DAY_MS, 90, now)).toBe(true);
  });

  it('180日フィルター: 179日前はfalse、180日前はtrue', () => {
    expect(isChatgptResearchStale(now - 179 * DAY_MS, 180, now)).toBe(false);
    expect(isChatgptResearchStale(now - 180 * DAY_MS, 180, now)).toBe(true);
  });
});
