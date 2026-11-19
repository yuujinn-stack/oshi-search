// サイト全体の表示設定（site_settings テーブル）の読み書き。サーバー専用。
//
// 現在の設定は「作品画像の表示方式」（key = 'work_image_display'、value = 'd1' | 'legacy'）だけ。
// 管理画面（/admin/work-image-display → PUT /api/admin/work-image-display）で保存すると、
// キャッシュタグを無効化して公開ページの次の表示から反映される（再デプロイ不要）。
//
// 読み込みに失敗した場合（テーブル未作成＝db-init 前・DB の一時的なエラー）は既定値（従来画像表示）で
// 表示し、公開ページを壊さない。保存の失敗は呼び出し側（管理API）へそのまま伝え、成功と表示させない。
import { unstable_cache, revalidatePath, revalidateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { siteSettings } from '@/db/schema';
import { revalidatePublicListings } from '@/lib/public-listing-cache';
import {
  DEFAULT_WORK_IMAGE_DISPLAY_MODE,
  isWorkImageDisplayMode,
  type WorkImageDisplayMode,
} from '@/lib/work-image-display';

export const WORK_IMAGE_DISPLAY_SETTING_KEY = 'work_image_display';
export const SITE_SETTINGS_CACHE_TAG = 'site-settings';
/** タグによる即時無効化が届かなかった場合の保険（秒）。通常は保存直後に反映される */
const SITE_SETTINGS_REVALIDATE_SECONDS = 300;

export interface WorkImageDisplaySetting {
  mode: WorkImageDisplayMode;
  /** DB に保存された行があるか（false = 未保存のため既定値で表示中） */
  saved: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** 読み込みに失敗した場合の理由（テーブル未作成など）。成功時は null */
  loadError: string | null;
}

export function isMissingSiteSettingsTable(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const { message, code, cause } = e as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = String(message ?? e);
    if (code === '42P01' || (msg.includes('site_settings') && msg.includes('does not exist'))) return true;
    e = cause;
  }
  return false;
}

/** 管理画面用（キャッシュなし）。失敗しても例外にせず、loadError に理由を入れて既定値を返す */
export async function getWorkImageDisplaySetting(): Promise<WorkImageDisplaySetting> {
  try {
    const rows = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, WORK_IMAGE_DISPLAY_SETTING_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return { mode: DEFAULT_WORK_IMAGE_DISPLAY_MODE, saved: false, updatedAt: null, updatedBy: null, loadError: null };
    }
    return {
      // 想定外の値が入っていた場合も既定値（従来画像表示）で表示する
      mode: isWorkImageDisplayMode(row.value) ? row.value : DEFAULT_WORK_IMAGE_DISPLAY_MODE,
      saved: true,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      updatedBy: row.updatedBy ?? null,
      loadError: null,
    };
  } catch (err) {
    const loadError = isMissingSiteSettingsTable(err)
      ? 'site_settings テーブルが未作成です（/admin/db-init の実行が必要です）'
      : `設定の読み込みに失敗しました: ${String(err)}`;
    return { mode: DEFAULT_WORK_IMAGE_DISPLAY_MODE, saved: false, updatedAt: null, updatedBy: null, loadError };
  }
}

const getCachedWorkImageDisplayMode = unstable_cache(
  async (): Promise<WorkImageDisplayMode> => {
    const s = await getWorkImageDisplaySetting();
    if (s.loadError) console.warn(`[site-settings] ${s.loadError}。従来画像表示で表示します`);
    return s.mode;
  },
  ['site-settings', WORK_IMAGE_DISPLAY_SETTING_KEY],
  { revalidate: SITE_SETTINGS_REVALIDATE_SECONDS, tags: [SITE_SETTINGS_CACHE_TAG] },
);

/** 公開ページ用。どんな失敗でも既定値（従来画像表示）を返し、ページの表示を止めない */
export async function getWorkImageDisplayMode(): Promise<WorkImageDisplayMode> {
  try {
    return await getCachedWorkImageDisplayMode();
  } catch (err) {
    console.warn('[site-settings] 作品画像の表示方式を読み込めませんでした。従来画像表示で表示します:', String(err));
    return DEFAULT_WORK_IMAGE_DISPLAY_MODE;
  }
}

/** 保存（upsert）。失敗時は例外を投げる。成功後に公開ページのキャッシュを無効化する */
export async function saveWorkImageDisplayMode(mode: WorkImageDisplayMode, updatedBy = 'admin'): Promise<WorkImageDisplaySetting> {
  if (!isWorkImageDisplayMode(mode)) throw new Error(`不正な表示方式です: ${String(mode)}`);
  const now = new Date();
  await db
    .insert(siteSettings)
    .values({ key: WORK_IMAGE_DISPLAY_SETTING_KEY, value: mode, updatedBy, updatedAt: now })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: mode, updatedBy, updatedAt: now } });
  revalidateWorkImageDisplayPages();
  return { mode, saved: true, updatedAt: now.toISOString(), updatedBy, loadError: null };
}

// 作品画像を表示するページのキャッシュを無効化する。人物・作品・グループ・推しVOD診断は force-dynamic のため
// タグの無効化だけで次の表示から反映される。トップ（revalidate=3600）・/vod（revalidate=60）・
// ジャンル一覧はページのキャッシュも作り直させる。
export function revalidateWorkImageDisplayPages(): void {
  try {
    revalidateTag(SITE_SETTINGS_CACHE_TAG, { expire: 0 });
    revalidatePath('/vod/[provider]', 'page');
  } catch {
    // リクエスト外（スクリプト・テスト）では何もしない
  }
  revalidatePublicListings();
}
