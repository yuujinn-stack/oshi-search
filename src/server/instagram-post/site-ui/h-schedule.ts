/**
 * H「観るもの・買うもの、まとめて」のキャプション生成と、予約登録の入力チェック（純粋関数。DB・外部APIに触れない）。
 * 保存そのものは既存の createSchedule（src/server/instagram-schedule/schedule-store.ts）を使う。
 */

/** H案のハッシュタグ（#推しサーチ #推し活 #人物名）。人物名の空白は除く */
export function buildWatchAndBuyHashtags(personName: string): string {
  return ['#推しサーチ', '#推し活', `#${personName.replace(/\s+/g, '')}`].join(' ');
}

/** H案のキャプション（予約前に管理画面で編集できる初期値） */
export function buildWatchAndBuyCaption(personName: string): string {
  return [
    `${personName}を追うなら、`,
    '観るものも、買うものもまとめてチェック。',
    '',
    '出演作品・配信先・関連商品を',
    '人物名からまとめて探せます。',
    '',
    '気になる人ができたら',
    'プロフィールのリンクから「推しサーチ」へ。',
    '',
    '※配信情報・商品情報は確認時点の情報です。',
    '',
    ...buildWatchAndBuyHashtags(personName).split(' '),
  ].join('\n');
}

/** Instagramのキャプション上限（文字数・ハッシュタグ数） */
export const INSTAGRAM_CAPTION_MAX_LENGTH = 2200;
export const INSTAGRAM_HASHTAG_MAX_COUNT = 30;

export interface HScheduleInput {
  personName: string;
  imageUrls: string[];
  caption: string;
  hashtags: string;
  scheduledAt: Date;
}

/**
 * 画像URLが、このサービスがVercel Blobの ig-posts/ に保存した投稿画像か。
 * 予約APIに任意のURLを渡されて、それがInstagramへ投稿されることを防ぐ。
 */
export function isOwnPostImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') && u.pathname.startsWith('/ig-posts/');
  } catch {
    return false;
  }
}

export function countHashtags(text: string): number {
  return (text.match(/#[^\s#]+/g) ?? []).length;
}

/** 入力を検証し、問題があれば日本語のエラーメッセージを返す（問題なければnull） */
export function validateHScheduleInput(input: HScheduleInput, now: Date = new Date()): string | null {
  if (!input.personName.trim()) return '人物名が指定されていません';
  if (input.imageUrls.length !== 3) return '投稿画像は3枚である必要があります';
  if (!input.imageUrls.every(isOwnPostImageUrl)) return '投稿画像のURLが不正です（このサービスで生成した画像のみ予約できます）';
  if (!input.caption.trim()) return 'キャプションが空です';
  if (input.caption.length > INSTAGRAM_CAPTION_MAX_LENGTH) return `キャプションは${INSTAGRAM_CAPTION_MAX_LENGTH}文字以内にしてください（現在${input.caption.length}文字）`;
  if (countHashtags(input.caption) > INSTAGRAM_HASHTAG_MAX_COUNT) return `ハッシュタグは${INSTAGRAM_HASHTAG_MAX_COUNT}個以内にしてください`;
  if (Number.isNaN(input.scheduledAt.getTime())) return '予約日時の形式が不正です';
  if (input.scheduledAt.getTime() <= now.getTime()) return '過去の日時は予約できません';
  return null;
}
