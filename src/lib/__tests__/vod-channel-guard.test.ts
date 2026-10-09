import { describe, it, expect } from 'vitest';
import { isSuspectedPrimeChannelRow, describeSuspectedPrimeChannelRow, PRIME_CHANNEL_SUSPECT_WARNING, partitionSuspectedPrimeChannelProviders } from '../vod-channel-guard';
import type { VodProvider } from '@/types/vod';
import { PRIME_VIDEO_CHANNEL_RULE, buildBatchVodResearchPrompt, buildChatgptFullSyncPrompt } from '../vod-research-prompt';

describe('isSuspectedPrimeChannelRow（Prime Video 追加チャンネルの誤登録検出）', () => {
  it.each([
    'Prime Video内のNHKオンデマンドチャンネルで現在配信中。別途チャンネル契約が必要。',
    'TELASA for Prime Videoチャンネル加入で見放題',
    'Prime Video内のFOD Channel追加契約で視聴可能。Prime会員特典単体の見放題ではない。',
    'Prime会費とは別に追加チャンネル契約が必要',
    'Leminoセレクトの追加サブスクリプション対象',
    'NHKオンデマンドの別料金',
  ])('Prime Video ＋ note「%s」→ 保留', (note) => {
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', note })).toBe(true);
    expect(isSuspectedPrimeChannelRow({ providerName: 'Amazon Prime Video', note })).toBe(true);
  });

  it('sourceUrl が Prime Video のチャンネルページなら保留', () => {
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', sourceUrl: 'https://www.primevideo.com/region/fe/channel/d395cdd2' })).toBe(true);
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', sourceUrl: 'https://www.amazon.co.jp/gp/video/channel/4bc76c2e' })).toBe(true);
  });

  it('Prime Video 本体の通常の記述は保留しない', () => {
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', note: 'Prime Video公式でプライム会員特典対象を確認' })).toBe(false);
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', note: '', sourceUrl: 'https://www.amazon.co.jp/dp/B0XXXX' })).toBe(false);
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video' })).toBe(false);
  });

  it('Prime Video 以外のサービス・正式な追加チャンネル名は対象外（provider を書き換えない）', () => {
    expect(isSuspectedPrimeChannelRow({ providerName: 'NHKオンデマンド', note: 'チャンネル' })).toBe(false);
    expect(isSuspectedPrimeChannelRow({ providerName: 'NHK On Demand Amazon Channel', note: '別途チャンネル契約が必要' })).toBe(false);
    expect(isSuspectedPrimeChannelRow({ providerName: 'YouTube', note: '公式チャンネル' })).toBe(false);
  });

  it('説明文・警告文', () => {
    expect(describeSuspectedPrimeChannelRow({ providerName: 'Prime Video', note: 'NHKチャンネル', workTitle: 'つばさ' })).toBe('つばさ: Prime Video（note: NHKチャンネル）');
    expect(PRIME_CHANNEL_SUSPECT_WARNING).toContain('追加チャンネルの可能性があります');
  });
});

describe('VOD調査プロンプト：Prime Video と追加チャンネルの区別ルール', () => {
  it('通常の調査プロンプト・ChatGPT完全同期プロンプトの両方にルールが入り、CSVダウンロード指示は末尾のまま', () => {
    for (const prompt of [buildBatchVodResearchPrompt('workId\nx', 'test'), buildChatgptFullSyncPrompt('workId\nx', 'test')]) {
      expect(prompt).toContain(PRIME_VIDEO_CHANNEL_RULE);
      expect(prompt.indexOf(PRIME_VIDEO_CHANNEL_RULE)).toBeLessThan(prompt.indexOf('---作品CSVここから---'));
    }
    expect(PRIME_VIDEO_CHANNEL_RULE).toContain('追加料金なしで視聴できる作品');
    expect(PRIME_VIDEO_CHANNEL_RULE).toContain('NHK On Demand Amazon Channel');
  });
});

describe('partitionSuspectedPrimeChannelProviders（AI Web検索補完の結果）', () => {
  const ai = (o: Partial<VodProvider>): VodProvider => ({
    providerId: 9, providerName: 'Amazon Prime Video', type: 'flatrate', countryCode: 'JP', source: 'openai_web_search', ...o,
  });

  it('note / reason / officialUrl に追加チャンネルの記述がある Prime Video は保留し、名前は書き換えない', () => {
    const viaNote = ai({ note: 'NHKオンデマンドチャンネル経由' });
    const viaReason = ai({ reason: 'Prime Video内のFODチャンネルで配信（別途契約）' });
    const viaUrl = ai({ officialUrl: 'https://www.amazon.co.jp/gp/video/channel/abc' });
    const body = ai({ reason: 'プライム会員特典の見放題対象を公式ページで確認' });
    const other = ai({ providerName: 'U-NEXT', providerId: 84, note: 'チャンネル' });
    const { kept, held } = partitionSuspectedPrimeChannelProviders([viaNote, viaReason, viaUrl, body, other]);
    expect(held).toEqual([viaNote, viaReason, viaUrl]);
    expect(kept).toEqual([body, other]);
    expect(held.every((p) => p.providerName === 'Amazon Prime Video')).toBe(true);
  });

  it('正式な追加チャンネル名で返ってきたものはそのまま採用', () => {
    const ch = ai({ providerName: 'NHK On Demand Amazon Channel', note: 'チャンネル登録が必要' });
    expect(partitionSuspectedPrimeChannelProviders([ch])).toEqual({ kept: [ch], held: [] });
  });
});
