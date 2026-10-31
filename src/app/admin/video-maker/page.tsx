import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetasOrThrow } from '@/lib/person-meta';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import { LogoutButton } from '@/components/admin/LogoutButton';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import VideoMakerClient from './VideoMakerClient';
import { listPersonReadingCandidates } from '@/server/video-jobs/script-prep-store';
import { personVideoSlug } from '@/server/video-jobs/person-slug';
import { listSonkamoGroups } from '@/server/video-jobs/sonkamo-target';

export const dynamic = 'force-dynamic';

/**
 * 動画生成（Phase A）。ここではジョブの作成・進捗表示だけを行い、重い処理（Remotion/FFmpeg/Chromium）は
 * oshi-video-maker Worker（自宅Mac）が /api/worker/* 経由でジョブを取得して実行する。
 */
export default async function VideoMakerPage() {
  let persons: Awaited<ReturnType<typeof getAllPersonsMerged>>;
  let metas: Awaited<ReturnType<typeof getAllPersonMetasOrThrow>>;
  try {
    [persons, metas] = await Promise.all([getAllPersonsMerged(), getAllPersonMetasOrThrow()]);
  } catch (err) {
    return <RedisErrorBanner detail={String(err)} />;
  }

  // まず見る3作の読み未登録の人物名に、人物登録データの別名（ひらがな・カタカナ）を候補として表示する（自動では確定しない）
  const readingCandidates = await listPersonReadingCandidates().catch(() => ({}));
  // 推し活で損してるかも？: 選べるグループ（公開サイトのグループ一覧と同じ）。取得できなくても他のテンプレートは使える
  const groups = await listSonkamoGroups().catch(() => []);

  const personOptions: PersonOption[] = persons.map((p) => ({
    name: p.name,
    group: p.group || undefined,
    currentGroupName: metas[p.name]?.currentGroupName || undefined,
    activityStatus: metas[p.name]?.activityStatus,
    generation: metas[p.name]?.generation,
  }));
  // 推しでサブスク比較（人物3人で1本）の選択で内部値に使う、推しサーチDBの人物slug（Workerへ渡すslugと同じ計算）
  const personSlugByName = Object.fromEntries(persons.map((p) => [p.name, personVideoSlug(p.name)]));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">🎬 動画生成</h1>
          <p className="text-sm text-gray-500 mt-1">
            人物・テンプレート・ナレーション方式を選んでジョブを登録すると、動画生成Workerが1本ずつ順番に生成します。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>
      <VideoMakerClient persons={personOptions} readingCandidates={readingCandidates} personSlugByName={personSlugByName} groups={groups} />
    </div>
  );
}
