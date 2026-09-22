import 'server-only';
import {
  buildInstagramPost,
  InsufficientWorksError,
  PersonPhotoMissingError,
  type BuildPostResult,
} from '../instagram-post/build-post';
import { buildInstagramPostWorksOnly } from '../instagram-post/build-post-works-only';
import { getInstagramTemplateMeta } from '@/lib/instagram-templates';

export { InsufficientWorksError, PersonPhotoMissingError };
export class UnknownTemplateError extends Error {}

export interface PrepareScheduleContentResult extends BuildPostResult {
  templateId: string;
}

/**
 * 予約登録前の「投稿内容を完成させる」処理（人物選択→3枚生成→Blobアップロード→
 * キャプション/ハッシュタグ生成）。テンプレートごとに分岐する入口をここに用意する。
 *
 * 現時点で実装済みのテンプレートは default-person のみで、これは既存の手動投稿
 * （/admin/instagram-post）が使っている buildInstagramPost をそのまま呼び出す
 * （生成ロジックは一切複製しない）。将来 requiresPersonPhoto: false のテンプレート
 * （works-only等）を追加する際は、ここに template.id ごとの分岐を増やし、
 * 人物写真を使わない専用の生成関数を呼び出すようにする。
 */
export async function prepareScheduleContent(personName: string, templateId: string): Promise<PrepareScheduleContentResult> {
  const template = getInstagramTemplateMeta(templateId);
  if (!template) {
    throw new UnknownTemplateError(`未知のテンプレートIDです: ${templateId}`);
  }

  if (template.id === 'default-person') {
    const result = await buildInstagramPost(personName);
    return { ...result, templateId: template.id };
  }

  if (template.id === 'works-only') {
    const result = await buildInstagramPostWorksOnly(personName);
    return { ...result, templateId: template.id };
  }

  throw new UnknownTemplateError(`テンプレート「${templateId}」の生成処理はまだ実装されていません`);
}
