import 'server-only';

/**
 * Instagramキャプション・ハッシュタグのテンプレート生成。
 * tools/instagram-post-generator/instagram-api/caption.ts と同一ロジック。
 * 実データ（作品名・VOD名）のみから機械的に組み立てる。
 */
export interface CaptionWorkInput {
  title: string;
  vod: string;
}

const BASE_HASHTAGS = ['#推しサーチ', '#推し活', '#VOD', '#サブスク'];

export function buildHashtags(personName: string): string {
  const personHashtag = `#${personName.replace(/\s+/g, '')}`;
  return [personHashtag, ...BASE_HASHTAGS].join(' ');
}

/** Instagramへ実際に投稿する本文（キャプション＋ハッシュタグを1つの文字列にまとめたもの） */
export function buildCaption(personName: string, works: CaptionWorkInput[]): string {
  const workLines = works.map((w) => `・${w.title}（${w.vod}）`).join('\n');

  return [
    `${personName}の出演作、どのサブスクで見られるかまとめました📺`,
    '',
    workLines,
    '',
    'プロフィールのリンクから「推しサーチ」で他の出演作もチェック✨',
    '',
    buildHashtags(personName),
  ].join('\n');
}
