import type { Metadata } from 'next';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetasOrThrow } from '@/lib/person-meta';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { buildGroupRoster, groupMembershipRecords, isCurrentMembership, listGroupNames } from '@/lib/group-membership';
import { getAllGroupMetas } from '@/lib/group-meta';
import { canonicalGroupSlug, groupHrefByName, isAsciiSlug } from '@/lib/group-slug';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import { LogoutButton } from '@/components/admin/LogoutButton';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import StoryMakerClient, { type GroupChoice } from './StoryMakerClient';
import { parseStoryMakerInitial } from '@/lib/story-maker/open-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

/**
 * Instagramストーリーズ作成。人物・グループの読み取りだけを行い、DB・既存データは変更しない。
 * 認証は src/proxy.ts（/admin/:path*）。動画生成（/admin/video-maker）・ストーリーズテンプレート（/admin/instagram-stories）とは独立。
 */
export default async function StoryMakerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let persons: Awaited<ReturnType<typeof getAllPersonsMerged>>;
  let metas: Awaited<ReturnType<typeof getAllPersonMetasOrThrow>>;
  try {
    [persons, metas] = await Promise.all([getAllPersonsMerged(), getAllPersonMetasOrThrow()]);
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  // グループ（公開サイトのグループ一覧と同じ判定）。取得できなくても人物は選べる
  let groups: GroupChoice[] = [];
  try {
    const [records, groupMetas] = await Promise.all([getAllMembershipRecords(), getAllGroupMetas()]);
    const recordsByPerson = groupMembershipRecords(records);
    const names = listGroupNames(persons, recordsByPerson);
    groups = names.map((name) => {
      const meta = groupMetas.find((m) => m.groupName === name);
      const slug = meta ? canonicalGroupSlug(meta) : '';
      // 自動作成（診断・カード）でメンバーを選ぶための一覧（グループページと同じ判定。現メンバーを先に）
      const members = buildGroupRoster(name, persons, metas, recordsByPerson).members
        .map((e) => ({ name: e.person.name, current: isCurrentMembership(e.membership) }))
        .sort((a, b) => Number(b.current) - Number(a.current));
      return { name, pagePath: groupHrefByName(name, groupMetas), slug: isAsciiSlug(slug) ? slug : undefined, members };
    });
  } catch (err) {
    console.warn('[story-maker] groups unavailable:', String(err));
  }

  const personOptions: PersonOption[] = persons.map((p) => ({
    name: p.name,
    group: p.group || undefined,
    currentGroupName: metas[p.name]?.currentGroupName || undefined,
    activityStatus: metas[p.name]?.activityStatus,
    generation: metas[p.name]?.generation,
  }));

  // 他の管理画面からのリンク（?template=bf&person=…&from=instagram-post）。実在するものだけ採用し、無ければ従来の初期状態
  // 楽天BFの開催状態・承認期限の表示は、このサーバーの時刻から始める（PCの時計に頼らない・表示の不一致を起こさない）
  const serverNow = Date.now();
  const initial = parseStoryMakerInitial(await searchParams, personOptions.map((p) => p.name), groups.map((g) => g.name));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <a href="/admin/instagram" className="text-xs text-violet-600 hover:text-violet-700 font-semibold">← Instagram管理へ戻る</a>
          <h1 className="text-2xl font-black text-slate-800 mt-1">📱 Instagramストーリーズ作成</h1>
          <p className="text-sm text-gray-500 mt-1">
            テンプレート・推しを選んで、1080×1920 のストーリーズ画像と計測用URLを作ります。リンクスタンプ・質問スタンプは Instagram アプリで置いてください。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>
      <StoryMakerClient persons={personOptions} groups={groups} initial={initial} serverNow={serverNow} />
    </div>
  );
}
