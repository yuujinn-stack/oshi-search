/**
 * Instagramキャプションの上限チェック（純粋関数）。予約画面のキャプション編集欄と、
 * 予約・一括予約API（サーバー側の最終チェック）の両方で使う。
 */

/** Instagramのキャプション上限（文字数・ハッシュタグ数） */
export const INSTAGRAM_CAPTION_MAX_LENGTH = 2200;
export const INSTAGRAM_HASHTAG_MAX_COUNT = 30;

export function countHashtags(text: string): number {
  return (text.match(/#[^\s#]+/g) ?? []).length;
}

/** 問題があれば日本語のエラーメッセージを返す（問題なければnull） */
export function validateCaption(caption: string): string | null {
  if (!caption.trim()) return 'キャプションが空です';
  if (caption.length > INSTAGRAM_CAPTION_MAX_LENGTH) {
    return `キャプションは${INSTAGRAM_CAPTION_MAX_LENGTH}文字以内にしてください（現在${caption.length}文字）`;
  }
  if (countHashtags(caption) > INSTAGRAM_HASHTAG_MAX_COUNT) {
    return `ハッシュタグは${INSTAGRAM_HASHTAG_MAX_COUNT}個以内にしてください（現在${countHashtags(caption)}個）`;
  }
  return null;
}
