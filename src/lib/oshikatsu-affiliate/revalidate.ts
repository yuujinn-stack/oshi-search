// 推し活サービスのアフィリエイト管理画面で変更したとき、広告の掲載先ページ（ISR）を再生成する。
// 公開ページは revalidate（定期再生成）も持つが、有効化・無効化をすぐ反映させるためにここで明示的に再検証する。
import { revalidatePath } from 'next/cache';
import { OSHIKATSU_CATEGORY_PAGE_PATHS, type OshikatsuCategoryId } from './constants';

export function revalidateOshikatsuAffiliatePages(...categories: (OshikatsuCategoryId | string | null | undefined)[]): void {
  const paths = new Set<string>();
  for (const c of categories) {
    const p = c ? OSHIKATSU_CATEGORY_PAGE_PATHS[c as OshikatsuCategoryId] : undefined;
    if (p) paths.add(p);
  }
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch (err) {
      console.error('[oshikatsu-affiliate] revalidatePath failed:', p, String(err));
    }
  }
}
