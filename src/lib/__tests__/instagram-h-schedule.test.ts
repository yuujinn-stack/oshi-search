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
// 予約APIのテスト用：DBへは書き込まず、渡された内容だけを記録する（publish-schedule はモジュールの型だけを使う）
const createScheduleMock = vi.fn(async (input: Record<string, unknown>) => ({ id: 1, status: 'scheduled', ...input }));
const createSchedulesBatchMock = vi.fn(async (inputs: Record<string, unknown>[]) => inputs.map((x, i) => ({ id: i + 1, status: 'scheduled', ...x })));
vi.mock('@/server/instagram-schedule/schedule-store', () => ({
  createSchedule: (input: Record<string, unknown>) => createScheduleMock(input),
  createSchedulesBatch: (inputs: Record<string, unknown>[]) => createSchedulesBatchMock(inputs),
  listSchedules: vi.fn(),
  getScheduleStatusCounts: vi.fn(),
  SlotConflictError: class extends Error {},
}));

import { buildWatchAndBuyCaption, buildWatchAndBuyHashtags } from '@/server/instagram-post/site-ui/h-schedule';
import { countHashtags, validateCaption } from '@/lib/instagram-caption-rules';
import { NextRequest } from 'next/server';
import { POST as postSchedule } from '@/app/api/admin/instagram-schedule/route';
import { POST as postBulk } from '@/app/api/admin/instagram-schedule/bulk/route';
import { publishScheduleToInstagram, AmbiguousPublishError, AlreadyPublishedError } from '@/server/instagram-schedule/publish-schedule';
import type { ScheduleRecord } from '@/server/instagram-schedule/schedule-store';
import { H_TEMPLATE_ID, AUTO_TEMPLATE_ID, getScheduleTemplateMeta, getInstagramTemplateMeta, getSchedulableTemplateMeta, SCHEDULE_TEMPLATE_OPTIONS, INSTAGRAM_TEMPLATES } from '@/lib/instagram-templates';

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

describe('キャプションの上限チェック（予約画面の編集欄と予約APIで共通）', () => {
  it('生成したHのキャプションは通る', () => {
    expect(validateCaption(buildWatchAndBuyCaption('松本若菜'))).toBeNull();
  });
  it('空・2200文字超・ハッシュタグ30個超は拒否', () => {
    expect(validateCaption('   ')).toMatch(/空/);
    expect(validateCaption('あ'.repeat(2201))).toMatch(/2200/);
    expect(validateCaption(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' '))).toMatch(/ハッシュタグ/);
    expect(countHashtags('#a #b c #d')).toBe(3);
  });
});

describe('H は既存の予約画面のテンプレートの1つ（自動選択には入らない）', () => {
  it('予約画面の選択肢に H・G・J がある（自動＋既存4テンプレートの後ろ）', () => {
    expect(SCHEDULE_TEMPLATE_OPTIONS.map((t) => t.id)).toEqual([AUTO_TEMPLATE_ID, ...INSTAGRAM_TEMPLATES.map((t) => t.id), H_TEMPLATE_ID, 'search-too-much', 'real-screen']);
    expect(getScheduleTemplateMeta(H_TEMPLATE_ID)?.label).toBe('H 観るもの・買うもの、まとめて');
  });
  it('予約できるテンプレートに含まれるが、自動選択の候補（INSTAGRAM_TEMPLATES）と手動投稿には含まれない', () => {
    expect(getSchedulableTemplateMeta(H_TEMPLATE_ID)?.id).toBe(H_TEMPLATE_ID);
    expect(getInstagramTemplateMeta(H_TEMPLATE_ID)).toBeUndefined();
    expect(INSTAGRAM_TEMPLATES.some((t) => t.id === H_TEMPLATE_ID)).toBe(false);
  });
  it('予約できないID（Preview専用・自動）は引き続き拒否', () => {
    expect(getSchedulableTemplateMeta('search-flow')).toBeUndefined();
    expect(getSchedulableTemplateMeta(AUTO_TEMPLATE_ID)).toBeUndefined();
  });
});

describe('既存の予約API（通常・一括）でHを予約できる（DBはモック）', () => {
  const future = new Date(Date.now() + 86400_000).toISOString();
  const req = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const item = { personName: '松本若菜', templateId: H_TEMPLATE_ID, scheduledAtIso: future, caption: buildWatchAndBuyCaption('松本若菜'), hashtags: buildWatchAndBuyHashtags('松本若菜'), imageUrls: urls };

  beforeEach(() => { createScheduleMock.mockClear(); createSchedulesBatchMock.mockClear(); });

  it('通常予約：template_id=watch-and-buy で保存される', async () => {
    const res = await postSchedule(req('http://x/api/admin/instagram-schedule', item));
    expect(res.status).toBe(200);
    expect(createScheduleMock).toHaveBeenCalledWith(expect.objectContaining({ templateId: H_TEMPLATE_ID, imageUrls: urls, caption: item.caption }));
  });
  it('一括予約：複数件をまとめて保存（既存テンプレートとの混在も可）', async () => {
    const res = await postBulk(req('http://x/api/admin/instagram-schedule/bulk', { items: [item, { ...item, personName: '久保史緒里', templateId: 'works-only' }] }));
    expect(res.status).toBe(200);
    expect(createSchedulesBatchMock.mock.calls[0][0].map((x) => x.templateId)).toEqual([H_TEMPLATE_ID, 'works-only']);
  });
  it('一括予約：1週間×10件＝70件をまとめて保存できる（件数の上限なし・日時の重複なし）', async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ ...item, scheduledAtIso: new Date(Date.now() + (i + 1) * 3600_000).toISOString() }));
    const res = await postBulk(req('http://x/api/admin/instagram-schedule/bulk', { items }));
    expect(res.status).toBe(200);
    expect(createSchedulesBatchMock.mock.calls[0][0]).toHaveLength(70);
  });
  it('J（4枚）の予約：通常予約・一括予約とも4枚の画像URLをそのまま保存する', async () => {
    const urls4 = [...urls, `${BLOB}/ig-posts/person_1_realscreen_04-XYZ.jpg`];
    const j = { ...item, templateId: 'real-screen', imageUrls: urls4 };
    expect((await postSchedule(req('http://x', j))).status).toBe(200);
    expect(createScheduleMock).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: 'real-screen', imageUrls: urls4 }));
    expect((await postBulk(req('http://x', { items: [j] }))).status).toBe(200);
    expect(createSchedulesBatchMock.mock.calls.at(-1)![0][0].imageUrls).toEqual(urls4);
  });
  it('画像は3〜10枚（2枚・11枚は拒否）', async () => {
    createScheduleMock.mockClear();
    expect((await postSchedule(req('http://x', { ...item, imageUrls: urls.slice(0, 2) }))).status).toBe(400);
    expect((await postSchedule(req('http://x', { ...item, imageUrls: Array.from({ length: 11 }, (_, i) => `${BLOB}/ig-posts/x_${i}.jpg`) }))).status).toBe(400);
    expect(createScheduleMock).not.toHaveBeenCalled();
  });
  it('未知のテンプレート・長すぎるキャプションは拒否（DBへ書き込まない）', async () => {
    expect((await postSchedule(req('http://x', { ...item, templateId: 'search-flow' }))).status).toBe(400);
    expect((await postSchedule(req('http://x', { ...item, caption: 'あ'.repeat(2201) }))).status).toBe(400);
    expect((await postBulk(req('http://x', { items: [{ ...item, caption: '' }] }))).status).toBe(400);
    expect(createScheduleMock).not.toHaveBeenCalled();
    expect(createSchedulesBatchMock).not.toHaveBeenCalled();
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

  it('J（4枚）の予約：保存済みの4枚を1→2→3→4の順で子コンテナにし、カルーセルに4件入れる', async () => {
    let n = 0;
    postMock.mockImplementation(async () => ({ id: `ID${++n}` }));
    const urls4 = [...urls, `${BLOB}/ig-posts/person_1_realscreen_04-XYZ.jpg`];
    const result = await publishScheduleToInstagram({ ...schedule, templateId: 'real-screen', imageUrls: urls4 });
    const calls = postMock.mock.calls;
    expect(calls.slice(0, 4).map((c) => c[1].image_url)).toEqual(urls4);
    expect(calls[4][1]).toMatchObject({ media_type: 'CAROUSEL', children: 'ID1,ID2,ID3,ID4' });
    expect(calls[5][0]).toBe('IGUSER/media_publish');
    expect(result.mediaId).toBe('ID6');
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ imageUrls: urls4 }));
  });

  it('保存されている画像が3枚未満なら投稿しない（Instagram APIを呼ばない）', async () => {
    await expect(publishScheduleToInstagram({ ...schedule, imageUrls: urls.slice(0, 2) })).rejects.toThrow(/画像URLが不正/);
    expect(postMock).not.toHaveBeenCalled();
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
