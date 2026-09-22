/**
 * Instagram予約投稿（/admin/instagram-schedule）で選べるテンプレートの一覧。
 *
 * サーバー専用コードではなく、クライアントコンポーネント（テンプレート選択UI）と
 * サーバーコード（src/server/instagram-schedule/prepare.ts）の両方から参照する
 * 純粋なメタデータのみを置く。実際の画像生成ロジックは含めない
 * （それは src/server/instagram-post/og-templates/ 側の責務）。
 *
 * 【将来のテンプレート追加方法】
 * ここに { id, label, requiresPersonPhoto, autoRotation, minWorks, minVodServices } を
 * 1件追加し、src/server/instagram-post/template-builders.ts の TEMPLATE_BUILDERS に
 * 生成関数を1行追加するだけでよい（分岐if文を増やす必要はない）。
 * requiresPersonPhoto: false のテンプレートは、人物写真が未登録でも予約できる。
 */
export interface InstagramTemplateMeta {
  id: string;
  label: string;
  /** true の場合、この人物の写真が未登録だと予約できない（生成に人物写真が必須） */
  requiresPersonPhoto: boolean;
  /** 「自動（おすすめ）」選択時のローテーション対象に含めるか */
  autoRotation: boolean;
  /** 自動選択の候補となるために必要な最小の出演作品件数 */
  minWorks: number;
  /** 自動選択の候補となるために必要な最小の異なる配信サービス数（0=問わない） */
  minVodServices: number;
}

export const INSTAGRAM_TEMPLATES: InstagramTemplateMeta[] = [
  {
    id: 'default-person',
    label: '標準（人物写真あり）',
    requiresPersonPhoto: true,
    autoRotation: true,
    minWorks: 3,
    minVodServices: 0,
  },
  {
    id: 'works-only',
    label: '作品・配信情報（人物写真なし）',
    requiresPersonPhoto: false,
    autoRotation: true,
    minWorks: 3,
    minVodServices: 0,
  },
  {
    id: 'works-picks',
    label: '出演作3選（人物写真なし）',
    requiresPersonPhoto: false,
    autoRotation: true,
    minWorks: 3,
    minVodServices: 0,
  },
  {
    id: 'vod-compare',
    label: 'サブスク比較（人物写真なし）',
    requiresPersonPhoto: false,
    autoRotation: true,
    minWorks: 3,
    minVodServices: 2,
  },
  // 将来追加予定（今回は未実装）:
  // { id: 'ranking', label: 'ランキング', requiresPersonPhoto: false, autoRotation: true, minWorks: 3, minVodServices: 0 },
  // { id: 'text-only', label: 'テキストのみ', requiresPersonPhoto: false, autoRotation: true, minWorks: 1, minVodServices: 0 },
];

export const DEFAULT_INSTAGRAM_TEMPLATE_ID = 'default-person';

/**
 * 人物写真を使わないテンプレートのID一覧（works-only / works-picks / vod-compare）。
 */
export const PHOTO_FREE_TEMPLATE_IDS = INSTAGRAM_TEMPLATES
  .filter((t) => !t.requiresPersonPhoto)
  .map((t) => t.id);

export function getInstagramTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return INSTAGRAM_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * 「自動（おすすめ）」の内部ID。実際に生成・保存されるテンプレートIDには使われない
 * （予約投稿画面・一括予約画面で選択した場合、src/server/instagram-schedule/auto-template.ts
 * が人物データに応じて上記4テンプレートのいずれかに解決してから生成する）。
 */
export const AUTO_TEMPLATE_ID = 'auto';

export const AUTO_TEMPLATE_META: InstagramTemplateMeta = {
  id: AUTO_TEMPLATE_ID,
  label: '自動（おすすめ）',
  // 自動選択は人物写真の有無に応じて候補を自動的に絞り込むため、
  // UI側で「人物写真が必須」の表示・ブロックを行わない。
  requiresPersonPhoto: false,
  autoRotation: false,
  minWorks: 0,
  minVodServices: 0,
};

/**
 * Instagram予約投稿画面・一括予約画面のテンプレート選択肢（「自動」＋既存4テンプレート）。
 * 手動投稿画面（/admin/instagram-post）は引き続き INSTAGRAM_TEMPLATES のみを使用し、
 * 「自動」は表示しない。
 */
export const SCHEDULE_TEMPLATE_OPTIONS: InstagramTemplateMeta[] = [AUTO_TEMPLATE_META, ...INSTAGRAM_TEMPLATES];

export function getScheduleTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return SCHEDULE_TEMPLATE_OPTIONS.find((t) => t.id === templateId);
}
