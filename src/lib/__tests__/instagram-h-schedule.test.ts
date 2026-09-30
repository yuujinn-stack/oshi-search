import { describe, it, expect, vi, beforeEach } from 'vitest';

// server-only はテスト環境（react-server 条件なし）では読み込むと例外になるため空にする
vi.mock('server-only', () => ({}));

// ── Graph API・設定・投稿履歴はモックする（ネットワーク・DBに一切触れない） ──
const postMock = vi.fn();
const getMock = vi.fn();
vi.mock('@/server/instagram-post/graph-client', () => {
  class GraphApiRequestError extends Error {}
  class InstagramGraphClient {
    post = postMock;
    get = getMock;
  }
  return { InstagramGraphClient, GraphApiRequestError };
});
vi.mock('@/server/instagram-post/config', () => ({
  loadInstagramConfig: () => ({ igUserId: 'IGUSER', accessToken: 'dummy' }),
}));
const recordMock = vi.fn();
vi.mock('@/lib/instagram-post-store', () => ({ recordInstagramPost: (...args: unknown[]) => recordMock(...args) }));

import {
  buildWatchAndBuyCaption,
  buildWatchAndBuyHashtags,
  countHashtags,
  isOwnPostImageUrl,
  validateHScheduleInput,
} from '@/server/instagram-post/site-ui/h-schedule';
import { publishScheduleToInstagram, AmbiguousPublishError, AlreadyPublishedError } from '@/server/instagram-schedule/publish-schedule';
import type { ScheduleRecord } from '@/server/instagram-schedule/schedule-store';
import { H_TEMPLATE_ID, getScheduleTemplateMeta, getInstagramTemplateMeta, SCHEDULE_TEMPLATE_OPTIONS } from '@/lib/instagram-templates';

const BLOB = 'https://abc123.public.blob.vercel-storage.com';
const urls = [1, 2, 3].map((n) => `${BLOB}/ig-posts/person_1_watchbuy_0${n}-XYZ.jpg`);

describe('H キャプション', () => {
  it('人物名が置換され、指定の文面・ハッシュタグになる', () => {
    const caption = buildWatchAndBuyCaption('松本若菜');
    expect(caption.startsWith('松本若菜を追うなら、\n観るものも、買うものもまとめてチェック。')).toBe(true);
    expect(caption).toContain('プロフィールのリンクから「推しサーチ」へ。');
    expect(caption).toContain('※配信情報・商品情報は確認時点の情報です。');
    expect(caption.trimEnd().endsWith('#推しサーチ\n#推し活\n#松本若菜')).toBe(true);
  });
  it('ハッシュタグの人物名は空白を除く', () => {
    expect(buildWatchAndBuyHashtags('Snow Man')).toBe('#推しサーチ #推し活 #SnowMan');
  });
});

describe('H 予約の入力チェック', () => {
  const base = { personName: '松本若菜', imageUrls: urls, caption: buildWatchAndBuyCaption('松本若菜'), hashtags: '', scheduledAt: new Date('2099-01-01T11:00:00Z') };
  const now = new Date('2026-09-30T00:00:00Z');

  it('正しい入力は通る', () => {
    expect(validateHScheduleInput(base, now)).toBeNull();
  });
  it('画像は自分たちのBlob（ig-posts/）のURLちょうど3枚のみ', () => {
    expect(validateHScheduleInput({ ...base, imageUrls: urls.slice(0, 2) }, now)).toMatch(/3枚/);
    expect(validateHScheduleInput({ ...base, imageUrls: [...urls.slice(0, 2), 'https://example.com/a.jpg'] }, now)).toMatch(/URLが不正/);
    expect(isOwnPostImageUrl(`${BLOB}/person-photos/a.jpg`)).toBe(false);
    expect(isOwnPostImageUrl('http://abc.public.blob.vercel-storage.com/ig-posts/a.jpg')).toBe(false);
  });
  it('過去日時・空キャプション・長すぎるキャプション・ハッシュタグ過多は拒否', () => {
    expect(validateHScheduleInput({ ...base, scheduledAt: new Date('2026-09-29T00:00:00Z') }, now)).toMatch(/過去/);
    expect(validateHScheduleInput({ ...base, caption: '   ' }, now)).toMatch(/空/);
    expect(validateHScheduleInput({ ...base, caption: 'あ'.repeat(2201) }, now)).toMatch(/2200/);
    expect(validateHScheduleInput({ ...base, caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') }, now)).toMatch(/ハッシュタグ/);
    expect(countHashtags('#a #b c #d')).toBe(3);
  });
});

describe('H テンプレートの表示名と、既存の予約・自動選択への非混入', () => {
  it('予約一覧の表示名は「H 観るもの・買うもの、まとめて」', () => {
    expect(getScheduleTemplateMeta(H_TEMPLATE_ID)?.label).toBe('H 観るもの・買うもの、まとめて');
  });
  it('既存の予約・一括予約APIの検証（getInstagramTemplateMeta）と選択肢には含まれない', () => {
    expect(getInstagramTemplateMeta(H_TEMPLATE_ID)).toBeUndefined();
    expect(SCHEDULE_TEMPLATE_OPTIONS.some((t) => t.id === H_TEMPLATE_ID)).toBe(false);
  });
});

describe('H 予約の自動投稿（既存の publishScheduleToInstagram をそのまま使う）', () => {
  const schedule: ScheduleRecord = {
    id: 999,
    personId: '松本若菜',
    personName: '松本若菜',
    templateId: H_TEMPLATE_ID,
    scheduledAt: new Date('2099-01-01T11:00:00Z'),
    status: 'processing',
    caption: buildWatchAndBuyCaption('松本若菜'),
    hashtags: buildWatchAndBuyHashtags('松本若菜'),
    imageUrls: urls,
    mediaId: null,
    publishedAt: null,
    errorMessage: null,
    attempts: 0,
    processingStartedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
    recordMock.mockReset();
    getMock.mockResolvedValue({ status_code: 'FINISHED' });
  });

  it('保存済みの3枚を1→2→3の順で子コンテナにし、カルーセル（children・caption）を作って media_publish する', async () => {
    let n = 0;
    postMock.mockImplementation(async () => ({ id: `ID${++n}` }));
    const result = await publishScheduleToInstagram(schedule);
    const calls = postMock.mock.calls;
    expect(calls.slice(0, 3).map((c) => c[1].image_url)).toEqual(urls);
    expect(calls.slice(0, 3).every((c) => c[0] === 'IGUSER/media' && c[1].is_carousel_item === 'true')).toBe(true);
    expect(calls[3][1]).toEqual({ media_type: 'CAROUSEL', children: 'ID1,ID2,ID3', caption: schedule.caption });
    expect(calls[4]).toEqual(['IGUSER/media_publish', { creation_id: 'ID4' }]);
    expect(result.mediaId).toBe('ID5');
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ personName: '松本若菜', imageUrls: urls }));
  });

  it('media_publish 自体の失敗は needs_review 扱い（AmbiguousPublishError）', async () => {
    let n = 0;
    postMock.mockImplementation(async (path: string) => {
      if (path.endsWith('media_publish')) throw new Error('network');
      return { id: `ID${++n}` };
    });
    await expect(publishScheduleToInstagram(schedule)).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it('media_publish より前の失敗（画像URL取得失敗など）は通常のエラー（failed 扱い）', async () => {
    postMock.mockRejectedValueOnce(new Error('image fetch failed'));
    const err = await publishScheduleToInstagram(schedule).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AmbiguousPublishError);
  });

  it('公開済み（media_id あり）の予約は再投稿しない', async () => {
    await expect(publishScheduleToInstagram({ ...schedule, mediaId: 'EXISTING' })).rejects.toBeInstanceOf(AlreadyPublishedError);
    expect(postMock).not.toHaveBeenCalled();
  });
});
