import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Reel（Phase R1b）の公開処理 publishReelToInstagram の単体テスト。
 * Instagram Graph API・DB（schedule-store）・投稿履歴はすべてモックし、外部には一切送らない。
 */
vi.mock('server-only', () => ({}));

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
vi.mock('@/lib/instagram-post-store', () => ({ recordInstagramPost: (...a: unknown[]) => recordMock(...a) }));
const saveContainerMock = vi.fn(async () => true);
const stillPublishableMock = vi.fn(async () => true);
vi.mock('@/server/instagram-schedule/schedule-store', () => ({
  saveReelContainer: (...a: unknown[]) => saveContainerMock(...(a as [])),
  isReelStillPublishable: (...a: unknown[]) => stillPublishableMock(...(a as [])),
}));

import { publishReelToInstagram, ReelContainerFailedError } from '@/server/instagram-schedule/publish-reel';
import { AmbiguousPublishError, AlreadyPublishedError } from '@/server/instagram-schedule/publish-schedule';
import type { ScheduleRecord } from '@/server/instagram-schedule/schedule-store';

const VIDEO = 'https://abc123.public.blob.vercel-storage.com/video-jobs/j1/ig-reel-0123456789abcdef.mp4';
const reel = (over: Partial<ScheduleRecord> = {}): ScheduleRecord => ({
  id: 7, personId: '松村北斗', personName: '松村北斗', templateId: 'reel:oshi-curious-v1',
  scheduledAt: new Date('2099-01-01T11:00:00Z'), status: 'processing', caption: 'キャプション #推し活', hashtags: '',
  imageUrls: [], mediaId: null, publishedAt: null, errorMessage: null, attempts: 0, processingStartedAt: new Date(),
  createdAt: new Date(), updatedAt: new Date(), mediaType: 'REEL', videoUrl: VIDEO, videoGenerationJobId: 'j1',
  igContainerId: null, containerCreatedAt: null, permalink: null, ...over,
});

// 仮想時計（待ち時間を実際には待たない）
let clock = 0;
const opts = (pollBudgetMs: number) => ({ pollBudgetMs, pollIntervalMs: 10_000, now: () => clock, sleep: async (ms: number) => { clock += ms; } });
const statuses = (...codes: string[]) => {
  getMock.mockImplementation(async (path: string, params: Record<string, string>) => {
    if (params.fields === 'permalink') return { permalink: 'https://www.instagram.com/reel/XYZ/' };
    return { status_code: codes.length > 1 ? codes.shift() : codes[0] };
  });
};

beforeEach(() => {
  clock = 0;
  postMock.mockReset(); getMock.mockReset(); recordMock.mockReset();
  saveContainerMock.mockClear(); stillPublishableMock.mockClear();
  saveContainerMock.mockResolvedValue(true); stillPublishableMock.mockResolvedValue(true);
});

describe('publishReelToInstagram', () => {
  it('コンテナ（REELS・video_url=ig-reel・caption）を作り、ポーリング前にIDを保存し、FINISHEDでmedia_publishする', async () => {
    postMock.mockImplementation(async (path: string) => (path.endsWith('/media') ? { id: 'C1' } : { id: 'M1' }));
    statuses('IN_PROGRESS', 'FINISHED');
    const out = await publishReelToInstagram(reel(), opts(60_000));
    expect(out).toMatchObject({ kind: 'published', mediaId: 'M1', permalink: 'https://www.instagram.com/reel/XYZ/' });
    expect(postMock.mock.calls[0]).toEqual(['IGUSER/media', { media_type: 'REELS', video_url: VIDEO, caption: 'キャプション #推し活', share_to_feed: 'true' }]);
    expect(saveContainerMock).toHaveBeenCalledWith(7, 'C1');
    expect(saveContainerMock.mock.invocationCallOrder[0]).toBeLessThan(getMock.mock.invocationCallOrder[0]);
    expect(stillPublishableMock).toHaveBeenCalledWith(7, 'C1');
    expect(postMock.mock.calls[1]).toEqual(['IGUSER/media_publish', { creation_id: 'C1' }]);
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 'M1', personName: '松村北斗' }));
  });

  it('保存済みのコンテナIDがあれば再利用し、新しいコンテナを作らない', async () => {
    postMock.mockResolvedValue({ id: 'M2' });
    statuses('FINISHED');
    const out = await publishReelToInstagram(reel({ igContainerId: 'OLD' }), opts(60_000));
    expect(out).toMatchObject({ kind: 'published', mediaId: 'M2' });
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('IGUSER/media_publish', { creation_id: 'OLD' });
    expect(saveContainerMock).not.toHaveBeenCalled();
  });

  it('時間内にFINISHEDにならなければ waiting を返し、公開しない（次回のCronへ持ち越し）', async () => {
    postMock.mockResolvedValue({ id: 'C3' });
    statuses('IN_PROGRESS');
    const out = await publishReelToInstagram(reel(), opts(30_000));
    expect(out).toEqual({ kind: 'waiting', containerId: 'C3', status: 'IN_PROGRESS' });
    expect(postMock).toHaveBeenCalledTimes(1); // コンテナ作成のみ
    expect(clock).toBeLessThanOrEqual(30_000);
  });

  it('保存済みコンテナが PUBLISHED なら二重投稿を避けて needs_review（AmbiguousPublishError）', async () => {
    statuses('PUBLISHED');
    await expect(publishReelToInstagram(reel({ igContainerId: 'C4' }), opts(60_000))).rejects.toBeInstanceOf(AmbiguousPublishError);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('コンテナが ERROR / EXPIRED なら ReelContainerFailedError（未公開が確定）', async () => {
    for (const code of ['ERROR', 'EXPIRED']) {
      postMock.mockReset();
      statuses(code);
      await expect(publishReelToInstagram(reel({ igContainerId: 'C5' }), opts(60_000))).rejects.toBeInstanceOf(ReelContainerFailedError);
      expect(postMock).not.toHaveBeenCalled();
    }
  });

  it('media_publish 自体の失敗は needs_review（AmbiguousPublishError）', async () => {
    postMock.mockRejectedValue(new Error('network'));
    statuses('FINISHED');
    await expect(publishReelToInstagram(reel({ igContainerId: 'C6' }), opts(60_000))).rejects.toBeInstanceOf(AmbiguousPublishError);
  });

  it('公開直前の再確認で状態が変わっていたら公開しない', async () => {
    stillPublishableMock.mockResolvedValue(false);
    statuses('FINISHED');
    await expect(publishReelToInstagram(reel({ igContainerId: 'C7' }), opts(60_000))).rejects.toThrow('公開を中止');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('コンテナIDを保存できなければ（キャンセル等）、そこで止めて公開しない', async () => {
    postMock.mockResolvedValue({ id: 'C8' });
    saveContainerMock.mockResolvedValue(false);
    await expect(publishReelToInstagram(reel(), opts(60_000))).rejects.toThrow('保存できませんでした');
    expect(getMock).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('公開済み（media_idあり）・カルーセル・動画URLなしの予約はAPIを呼ばずに拒否', async () => {
    await expect(publishReelToInstagram(reel({ mediaId: 'M9' }), opts(60_000))).rejects.toBeInstanceOf(AlreadyPublishedError);
    await expect(publishReelToInstagram(reel({ mediaType: 'CAROUSEL' }), opts(60_000))).rejects.toThrow('Reelではありません');
    await expect(publishReelToInstagram(reel({ videoUrl: null }), opts(60_000))).rejects.toThrow('動画URL');
    expect(postMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('permalinkや投稿履歴の記録に失敗しても、公開自体は成功として返す', async () => {
    postMock.mockResolvedValue({ id: 'M10' });
    getMock.mockImplementation(async (_p: string, params: Record<string, string>) => {
      if (params.fields === 'permalink') throw new Error('x');
      return { status_code: 'FINISHED' };
    });
    recordMock.mockRejectedValue(new Error('db'));
    const out = await publishReelToInstagram(reel({ igContainerId: 'C10' }), opts(60_000));
    expect(out).toMatchObject({ kind: 'published', mediaId: 'M10', permalink: null });
  });
});
