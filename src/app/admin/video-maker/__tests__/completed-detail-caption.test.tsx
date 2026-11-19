import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompletedDetail } from '../VideoMakerClient';
import { captionGroupName, resolveJobPostTexts } from '@/lib/video-instagram-caption';
import { isMediaGroupTemplateId } from '@/lib/video-media-reel';
import { withTiktokPostText } from '@/lib/video-tiktok-caption';

// 完了ジョブのデータ（Worker が返した投稿文つき）→ 管理画面の完了ジョブの詳細（CompletedDetail）の投稿文欄まで。
// 生成履歴の一覧と同じ組み立てで captionPerson を作る（VideoMakerClient の CompletedDetail 呼び出しと同じ式）。

type Job = ComponentProps<typeof CompletedDetail>['job'];

const NOTE = '※サイトの検索・診断は無料。配信サービス・商品・外部サービスの利用は各サービスの料金がかかる場合があります。';

/** oshi-video-maker の buildMediaPosts が OSHI_GROUP_09 で返す形の旧投稿文（料金の注記つき） */
function workerPostTexts(group: string, tag: string): Record<string, string | null> {
  const title = `${group}を推してる人 このサイトまだ知らないの？`;
  const tags = `#推しサーチ #推し活 ${tag}`.trim();
  return {
    default: `${title}\n\n名前は推しサーチ。プロフからチェック！\n${NOTE}\n\n${tags}`,
    instagram: null,
    tiktok: null,
    threads: `${title}\n\nhttps://oshi-search.jp/\n${NOTE}\n\n${tags}`,
    x: `${title}\nhttps://oshi-search.jp/\n${tags}`,
  };
}

function makeJob(over: Partial<Job>): Job {
  return {
    id: 'job-1',
    batchId: null,
    retryOfJobId: null,
    personName: 'Number_i',
    personSlug: null,
    templateId: 'OSHI_GROUP_09',
    templateInput: { templateCategory: 'media_intro', groupName: 'Number_i' },
    narrationMode: 'capcut',
    status: 'completed',
    attempts: 1,
    progressStep: null,
    progressTotal: null,
    progressLabel: null,
    createdAt: '2026-11-19T02:46:00.000Z',
    startedAt: null,
    completedAt: '2026-11-19T02:50:00.000Z',
    errorStep: null,
    errorMessage: null,
    videoUrl: 'https://blob.test/video-jobs/job-1/final.mp4',
    videoSizeBytes: 1000,
    durationSec: 21,
    qaStatus: 'PASS',
    qaWarnings: null,
    postTexts: workerPostTexts('Number_i', '#Number_i'),
    narrationScript: null,
    result: {},
    ...over,
  };
}

/** 生成履歴と同じ captionPerson（人物データに無い名前 = グループ） */
const personByName = new Map<string, { group?: string }>([['目黒蓮', { group: 'Snow Man' }]]);
const captionPersonOf = (job: Job) => ({
  name: job.personName,
  groupName: captionGroupName(personByName.get(job.personName)),
  kind: isMediaGroupTemplateId(job.templateId) ? ('group' as const) : ('person' as const),
});

function render(job: Job) {
  return renderToStaticMarkup(
    <CompletedDetail job={job} captionPerson={captionPersonOf(job)} onRetry={() => {}} reelSchedule={null} reelAutopublishEnabled={false} onReelChanged={() => {}} />,
  );
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** 投稿文タブの textarea（最初に表示するタブの文面） */
const postTabText = (html: string) => decode(html.match(/<textarea[^>]*aria-label="投稿文（編集してからコピーできます）"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '');
/** Instagram投稿文の欄の textarea */
const igSectionText = (html: string) => decode(html.match(/<textarea[^>]*aria-label="Instagram投稿文（編集してからコピーできます）"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '');
const tabLabels = (html: string) => [...html.matchAll(/<button type="button" class="text-xs px-2 py-0\.5 rounded[^"]*">([^<]+)<\/button>/g)].map((m) => m[1]);

const NUMBER_I = [
  'Number_iを推してる人、このサイトまだ知らないの？',
  '',
  '推しサーチなら、Number_iの',
  '✅ メンバーの情報・出演作品をまとめて検索',
  '✅ ドラマ・映画などの配信先をチェック',
  '✅ 写真集・CD・関連グッズを探せる',
  '✅ 推しに合うサブスクを診断できる',
  '',
  '推し活に役立つ情報をまとめてチェックできます🔍',
  '',
  'プロフィールのリンクからチェック🔗',
  '',
  '#推し活 #推しサーチ #Number_i',
].join('\n');

describe('完了ジョブの投稿文欄（OSHI_GROUP_09: Worker の旧投稿文より新しい Instagram 投稿文を優先）', () => {
  it('Number_i: Worker が旧投稿文（料金の注記つき）を返しても、最初の「投稿文」タブと Instagram投稿文の欄は新しい文面', () => {
    const job = makeJob({});
    const html = render(job);
    expect(postTabText(html)).toBe(NUMBER_I);
    expect(igSectionText(html)).toBe(NUMBER_I);
    expect(postTabText(html)).not.toContain('料金');
    expect(tabLabels(html)).toEqual(['投稿文', 'Instagram', 'TikTok', 'Threads', 'X']);
    // 保存データ（job.postTexts）は変えない
    expect(job.postTexts).toEqual(workerPostTexts('Number_i', '#Number_i'));
  });

  it('Snow Man: グループ名・ハッシュタグが選んだグループになる', () => {
    const html = render(makeJob({ personName: 'Snow Man', templateInput: { templateCategory: 'media_intro', groupName: 'Snow Man' }, postTexts: workerPostTexts('Snow Man', '#SnowMan') }));
    const t = postTabText(html);
    expect(t.startsWith('Snow Manを推してる人、このサイトまだ知らないの？\n\n推しサーチなら、Snow Manの\n')).toBe(true);
    expect(t.split('\n').at(-1)).toBe('#推し活 #推しサーチ #SnowMan');
    expect(t).not.toMatch(/料金|Number_i/);
  });

  it('TikTok・Threads・X は Worker の投稿文から従来どおり（TikTok は旧投稿文から作った TikTok 用の文面のまま）', () => {
    const worker = workerPostTexts('Number_i', '#Number_i');
    const shown = resolveJobPostTexts('OSHI_GROUP_09', worker, { name: 'Number_i', groupName: null, kind: 'group' });
    const before = withTiktokPostText(worker);
    expect(shown.tiktok).toBe(before.tiktok);
    expect(shown.tiktok).toContain('『推しサーチ』で検索');
    expect(shown.threads).toBe(worker.threads);
    expect(shown.x).toBe(worker.x);
    expect(shown.default).toBe(NUMBER_I);
    expect(shown.instagram).toBe(NUMBER_I);
  });

  it('リール予約の投稿文の初期値も新しい文面（ig-reel.mp4 があるとき）', () => {
    const html = render(makeJob({ result: { instagramReelVideo: { url: 'https://blob.test/video-jobs/job-1/ig-reel.mp4', qaStatus: 'PASS', durationSec: 21 } } }));
    const reel = decode(html.match(/<textarea[^>]*id="reel-caption-job-1"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] ?? '');
    expect(reel).toBe(NUMBER_I);
  });

  it('ほかのテンプレートは Worker の投稿文のまま（グループ版の別テンプレート・ブラックフライデー・損してるかも？）', () => {
    for (const templateId of ['OSHI_GROUP_10', 'OSHI_GENERAL_09', 'site_bf_goods']) {
      const job = makeJob({ templateId });
      expect(postTabText(render(job))).toBe(job.postTexts!.default);
    }
    const sonkamo = makeJob({ templateId: 'oshi-sonkamo-v1', personName: '目黒蓮', templateInput: null, postTexts: { default: 'Worker の投稿文', instagram: 'Worker の Instagram 投稿文' } });
    const html = render(sonkamo);
    expect(postTabText(html)).toBe('Worker の投稿文');
    // 損してるかも？の「Instagram投稿文」欄（従来からある管理画面の文面）は従来どおり
    expect(igSectionText(html).startsWith('目黒蓮推し、これ知らないと損かも？👀')).toBe(true);
    expect(resolveJobPostTexts('oshi-sonkamo-v1', sonkamo.postTexts, captionPersonOf(sonkamo))).toEqual(withTiktokPostText(sonkamo.postTexts));
  });
});
