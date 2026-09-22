/**
 * Instagram予約投稿（/admin/instagram-schedule）で選べるテンプレートの一覧。
 *
 * サーバー専用コードではなく、クライアントコンポーネント（テンプレート選択UI）と
 * サーバーコード（src/server/instagram-schedule/prepare.ts）の両方から参照する
 * 純粋なメタデータのみを置く。実際の画像生成ロジックは含めない
 * （それは src/server/instagram-post/og-templates/ 側の責務）。
 *
 * 【将来のテンプレート追加方法】
 * ここに { id, label, requiresPersonPhoto } を1件追加し、
 * src/server/instagram-schedule/prepare.ts の分岐に実際の生成処理を追加する。
 * requiresPersonPhoto: false のテンプレートは、人物写真が未登録でも予約できる。
 */
export interface InstagramTemplateMeta {
  id: string;
  label: string;
  /** true の場合、この人物の写真が未登録だと予約できない（生成に人物写真が必須） */
  requiresPersonPhoto: boolean;
}

export const INSTAGRAM_TEMPLATES: InstagramTemplateMeta[] = [
  {
    id: 'default-person',
    label: '標準（人物写真あり）',
    requiresPersonPhoto: true,
  },
  {
    id: 'works-only',
    label: '作品・配信情報（人物写真なし）',
    requiresPersonPhoto: false,
  },
  // 将来追加予定（今回は未実装）:
  // { id: 'subscription-comparison', label: 'サブスク比較', requiresPersonPhoto: false },
  // { id: 'ranking', label: 'ランキング', requiresPersonPhoto: false },
  // { id: 'text-only', label: 'テキストのみ', requiresPersonPhoto: false },
];

export const DEFAULT_INSTAGRAM_TEMPLATE_ID = 'default-person';

export function getInstagramTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return INSTAGRAM_TEMPLATES.find((t) => t.id === templateId);
}
