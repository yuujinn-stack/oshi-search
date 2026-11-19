import { describe, it, expect } from 'vitest';
import { isSuspectedPrimeChannelRow, describeSuspectedPrimeChannelRow, PRIME_CHANNEL_SUSPECT_WARNING, partitionSuspectedPrimeChannelProviders, classifyPrimeVideoRow, validateApprovalFields } from '../vod-channel-guard';
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

describe('classifyPrimeVideoRow（A:会員料金のみ / B:追加チャンネル / C:レンタルのみ / D:判定不能）', () => {
  const c = (note: string, availabilityType = 'flatrate', sourceUrl = '') =>
    classifyPrimeVideoRow({ providerName: 'Prime Video', note, sourceUrl, availabilityType }).category;

  it.each([
    'Prime Video公式でプライム会員向けの視聴案内を確認。追加チャンネル不要',
    'プライム会員見放題（追加料金なし）',
    'Amazonチャンネルの追加料金は不要。プライム会員特典',
    'プライム会員なら追加料金なしで視聴可能。チャンネル登録不要',
    'プライム会員なら購入不要',
  ])('A: 否定形の記述は誤検知しない「%s」→ included', (note) => {
    expect(c(note)).toBe('included');
    expect(isSuspectedPrimeChannelRow({ providerName: 'Prime Video', note })).toBe(false);
  });

  it('「Prime Video」という語だけでは見放題の根拠にしない（従来どおり CSV の種別で登録）', () => {
    expect(c('Prime Video独占配信')).toBe('no_evidence');
    expect(c('')).toBe('no_evidence');
  });

  it.each([
    'Prime Video内のNHKオンデマンドチャンネルで現在配信中。別途チャンネル契約が必要。',
    'Prime Video内のFOD Channel追加契約で視聴可能。Prime会員特典単体の見放題ではない。',
    'TELASA for Prime Videoチャンネル加入で見放題',
  ])('B: 「%s」→ channel', (note) => {
    expect(c(note)).toBe('channel');
  });

  it('B: sourceUrl が追加チャンネルのページなら種別に関係なく channel', () => {
    expect(c('プライム会員特典', 'flatrate', 'https://www.amazon.co.jp/gp/video/channel/abc')).toBe('channel');
    expect(c('', 'rent', 'https://www.primevideo.com/region/fe/channel/d395')).toBe('channel');
  });

  it('C: 種別 flatrate で記述がレンタル・購入のみ → rental。種別 rent/buy はそのまま登録可', () => {
    expect(c('レンタルのみ')).toBe('rental');
    expect(c('プライム会員特典の対象外。レンタル可')).toBe('rental');
    expect(c('レンタル330円', 'rent')).toBe('rental_typed');
    expect(c('NHKオンデマンドチャンネルでも配信。購入可', 'buy')).toBe('rental_typed');
  });

  it('D: 見放題の記述とチャンネル／レンタルの記述が混在 → ambiguous', () => {
    expect(c('プライム会員特典対象。NHKオンデマンドチャンネルでも配信')).toBe('ambiguous');
    expect(c('プライム会員見放題、非会員はレンタル')).toBe('ambiguous');
  });

  it('Prime Video 本体以外は対象外', () => {
    expect(classifyPrimeVideoRow({ providerName: 'NHK On Demand Amazon Channel', note: '別途チャンネル契約が必要' }).category).toBe('not_prime');
    expect(classifyPrimeVideoRow({ providerName: 'U-NEXT', note: 'レンタル' }).category).toBe('not_prime');
  });
});

describe('validateApprovalFields（保留行の手動承認の入力検証）', () => {
  it('https の公式URLと5文字以上の理由があれば OK', () => {
    expect(validateApprovalFields('https://befirst.tokyo/news/x/', 'BE:FIRST公式で確認')).toBeNull();
  });
  it('チャンネルページ・不正なURL・短い理由は NG', () => {
    expect(validateApprovalFields('https://www.amazon.co.jp/gp/video/channel/abc', '公式で確認しました')).not.toBeNull();
    expect(validateApprovalFields('ftp://example.com', '公式で確認しました')).not.toBeNull();
    expect(validateApprovalFields('https://example.com', '確認')).not.toBeNull();
    expect(validateApprovalFields(undefined, undefined)).not.toBeNull();
  });
});
