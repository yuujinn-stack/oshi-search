// アフィリエイト管理画面の各APIから共通で呼ぶ再検証ヘルパー。
//
// /work/[workId] と /person/[slug] は force-dynamic（キャッシュを持たない）ため
// revalidatePath は不要（既存の people/publish route 等と同じ設計方針）。
// /vod/[provider] のみ revalidate=60 の ISR のため、該当VODサービスの公開ページを
// 明示的に再検証し、管理画面での変更を最大60秒待たずに反映させる。
import { revalidatePath } from 'next/cache';
import { VOD_PAGE_PROVIDERS } from '@/lib/vod-page';

export function revalidateAffiliateVodService(vodService: string): void {
  const match = VOD_PAGE_PROVIDERS.find((p) => p.normalizedSlug === vodService);
  if (match) {
    revalidatePath(`/vod/${match.urlSlug}`);
  }
}
