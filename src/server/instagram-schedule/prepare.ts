import 'server-only';
import { InsufficientWorksError, PersonPhotoMissingError, type BuildPostResult } from '../instagram-post/build-post';
import { TEMPLATE_BUILDERS } from '../instagram-post/template-builders';
import { getInstagramTemplateMeta, AUTO_TEMPLATE_ID } from '@/lib/instagram-templates';
import { resolveAutoTemplateId, NoEligibleTemplateError } from './auto-template';
import { getMostRecentTemplateId } from './schedule-store';

export { InsufficientWorksError, PersonPhotoMissingError, NoEligibleTemplateError };
export class UnknownTemplateError extends Error {}

export interface PrepareScheduleContentResult extends BuildPostResult {
  templateId: string;
}

/**
 * 予約登録前の「投稿内容を完成させる」処理（人物選択→3枚生成→Blobアップロード→
 * キャプション/ハッシュタグ生成）。テンプレートごとの実際の生成関数は
 * src/server/instagram-post/template-builders.ts のTEMPLATE_BUILDERSに集約されており、
 * ここではテンプレートIDから対応する関数を引いて呼び出すだけにしている
 * （テンプレート追加のたびにここへif文を増やす必要はない）。
 *
 * templateIdが'auto'の場合のみ、人物の実データ（人物写真・作品件数・配信サービス数）に
 * 応じて候補テンプレートを絞り込み、直前に使われたテンプレートを避けて自動選択する
 * （src/server/instagram-schedule/auto-template.ts）。手動で具体的なテンプレートIDを
 * 指定した場合はこの解決処理を一切通らず、従来通りそのテンプレートを必ず使用する。
 *
 * previousTemplateIdは、一括予約のように呼び出し側（クライアント）が同一バッチ内で
 * 直前に解決したテンプレートIDを把握している場合に渡す。省略時は、DB上の直近の予約
 * （cancelled除く）のtemplateIdを基準にローテーションする。
 */
export async function prepareScheduleContent(
  personName: string,
  templateId: string,
  previousTemplateId?: string | null,
): Promise<PrepareScheduleContentResult> {
  let resolvedTemplateId = templateId;

  if (templateId === AUTO_TEMPLATE_ID) {
    const prev = previousTemplateId !== undefined ? previousTemplateId : await getMostRecentTemplateId();
    resolvedTemplateId = await resolveAutoTemplateId(personName, prev);
  }

  const template = getInstagramTemplateMeta(resolvedTemplateId);
  if (!template) {
    throw new UnknownTemplateError(`未知のテンプレートIDです: ${templateId}`);
  }

  const builder = TEMPLATE_BUILDERS[template.id];
  if (!builder) {
    throw new UnknownTemplateError(`テンプレート「${template.id}」の生成処理はまだ実装されていません`);
  }

  const result = await builder(personName);
  return { ...result, templateId: template.id };
}
