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
 * H「観るもの・買うもの、まとめて」（生成処理は src/server/instagram-post/site-ui/builders.ts）。
 * 予約投稿画面・一括予約画面で、管理者が明示的に選んだ場合だけ使うテンプレート。
 * INSTAGRAM_TEMPLATES には含めないため、「自動（おすすめ）」の候補・ローテーション
 * （getEligibleTemplates / getMostRecentTemplateId）と手動投稿画面には現れない。
 */
export const H_TEMPLATE_ID = 'watch-and-buy';

export const H_SCHEDULE_TEMPLATE_META: InstagramTemplateMeta = {
  id: H_TEMPLATE_ID,
  label: 'H 観るもの・買うもの、まとめて',
  requiresPersonPhoto: false,
  autoRotation: false,
  minWorks: 1,
  minVodServices: 1,
};

/**
 * 予約できるテンプレート（既存4テンプレート＋H）。予約・一括予約APIと予約内容の生成（prepare）の検証に使う。
 * 「自動」はここに含めない（prepareで実テンプレートへ解決してから保存するため）。
 */
export const SCHEDULABLE_TEMPLATES: InstagramTemplateMeta[] = [...INSTAGRAM_TEMPLATES, H_SCHEDULE_TEMPLATE_META];

export function getSchedulableTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return SCHEDULABLE_TEMPLATES.find((t) => t.id === templateId);
}

/**
 * Instagram予約投稿画面・一括予約画面のテンプレート選択肢（「自動」＋既存4テンプレート＋H）。
 * 手動投稿画面（/admin/instagram-post）は引き続き INSTAGRAM_TEMPLATES のみを使用し、
 * 「自動」とHは表示しない。
 */
export const SCHEDULE_TEMPLATE_OPTIONS: InstagramTemplateMeta[] = [AUTO_TEMPLATE_META, ...SCHEDULABLE_TEMPLATES];

/** 予約のテンプレートIDから表示用のメタデータを返す（選択肢・予約一覧・通知・ハブの表示名用） */
export function getScheduleTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return SCHEDULE_TEMPLATE_OPTIONS.find((t) => t.id === templateId);
}

/**
 * 手動投稿画面（/admin/instagram-post）でのPreview確認専用テンプレート。
 *
 * INSTAGRAM_TEMPLATESには含めないため、予約投稿・一括予約の選択肢、「自動（おすすめ）」の
 * 候補・ローテーション、予約APIのテンプレートID検証（getSchedulableTemplateMeta）の
 * いずれにも現れない（予約APIに直接このIDを送っても未知のテンプレートとして拒否される）。
 * 例外として watch-and-buy（H）は予約テンプレートとして正式採用済み（SCHEDULABLE_TEMPLATES）。
 * 手動投稿画面でも生成・プレビューまでに限り、「Instagramに投稿」ボタンは表示しない。
 * 正式採用する際は、ここからINSTAGRAM_TEMPLATESへ移し、template-builders.tsへ登録する。
 */
export const PREVIEW_ONLY_INSTAGRAM_TEMPLATES: InstagramTemplateMeta[] = [
  {
    id: 'search-flow',
    label: '【Preview】検索体験（人物写真なし）',
    requiresPersonPhoto: false,
    autoRotation: false,
    minWorks: 2,
    minVodServices: 0,
  },
  // 以下5件は比較検討用のテンプレート候補（src/server/instagram-post/candidates/builders.ts）。
  // minWorks / minVodServices は自動選択用の値で、Preview専用のため使われない（生成可否は各生成関数が実データで判定する）。
  { id: 'curious-person', label: '【Preview】最近この人、気になってる？', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 0 },
  { id: 'service-only', label: '【Preview】○○だけ契約してる人へ', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 1 },
  { id: 'subscription-count', label: '【Preview】この推し、サブスク何個必要？', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 1 },
  { id: 'oshi-status', label: '【Preview】推しの現在地', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 1 },
  { id: 'search-pain', label: '【Preview】推し活で地味に面倒なこと', requiresPersonPhoto: false, autoRotation: false, minWorks: 0, minVodServices: 0 },
  // 以下4件は推しサーチの人物ページUIをベースにしたテンプレート候補（src/server/instagram-post/site-ui/builders.ts）。
  { id: 'name-to-everything', label: '【Preview】F 名前を入れたら、ここまで出る', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 0 },
  { id: 'search-too-much', label: '【Preview】G 推し活、検索しすぎ問題', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 0 },
  { id: 'watch-and-buy', label: '【Preview】H 観るもの・買うもの、まとめて', requiresPersonPhoto: false, autoRotation: false, minWorks: 1, minVodServices: 1 },
  { id: 'oshi-products', label: '【Preview】I ○○の商品、どこまで知ってる？', requiresPersonPhoto: false, autoRotation: false, minWorks: 0, minVodServices: 0 },
];

/** 手動投稿画面のテンプレート選択肢（既存4テンプレート＋Preview専用テンプレート） */
export const MANUAL_POST_TEMPLATE_OPTIONS: InstagramTemplateMeta[] = [
  ...INSTAGRAM_TEMPLATES,
  ...PREVIEW_ONLY_INSTAGRAM_TEMPLATES,
];

export function getManualPostTemplateMeta(templateId: string): InstagramTemplateMeta | undefined {
  return MANUAL_POST_TEMPLATE_OPTIONS.find((t) => t.id === templateId);
}

export function isPreviewOnlyTemplate(templateId: string | undefined): boolean {
  return !!templateId && PREVIEW_ONLY_INSTAGRAM_TEMPLATES.some((t) => t.id === templateId);
}
