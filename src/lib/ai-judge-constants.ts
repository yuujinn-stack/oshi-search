// AI判定に関するクライアント/サーバー共通定数。
// DB・OpenAI SDK等への依存を一切持たない（クライアントコンポーネントから直接importするため）。

// 1回のAPI呼び出しで実際にOpenAIへ送信する上限（個別呼び出し方式を維持するための単位）
export const AI_JUDGE_BATCH_SIZE = 10;

// 「全件AI判定」で、開始時点の未判定数がこれを超える場合はUIに警告を表示する
// （処理自体は継続するが、時間がかかることをユーザーに知らせる目的のみ）
export const MAX_AUTO_JUDGE_ITEMS = 500;

// 1回のリクエストで受け付けるexcludeProductIdsの最大件数（無制限な配列肥大化を防ぐ）
export const MAX_EXCLUDE_PRODUCT_IDS = 500;
