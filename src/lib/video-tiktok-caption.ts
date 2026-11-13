// 動画生成（/admin/video-maker）の TikTok 用投稿文。
//
// TikTok はフォロワー1,000人未満ではプロフィールにリンクを置けないため、「プロフィールのリンクから」等のリンクがある前提の文言を使わず、
// 基本の CTA を「気になったら『推しサーチ』で検索！」にする（TikTok 版の動画の CTA と同じ）。
// Worker が作った投稿文（TikTok 用があればそれ、無ければ共通の投稿文）から、管理画面の表示用に作る。Worker・動画・Instagram の投稿文は変えない。
// 純粋な関数だけ（クライアント・サーバーの両方から使える）。

export const TIKTOK_CAPTION_CTA = '気になったら『推しサーチ』で検索！';

/** リンクがある前提の言い回し（プロフィールのリンク・プロフから・リンクから 等） */
const LINK_PHRASE = /(?:プロフ(?:ィール)?(?:欄)?(?:の|に(?:ある)?)?(?:リンク|URL)(?:から)?|プロフ(?:ィール)?から|ハイライトの?リンクから|リンクから)/gu;
const URL_ONLY = /^\s*(?:https?:\/\/\S+|oshi-search\.jp\S*)\s*$/u;
const HASHTAG_LINE = /^\s*#\S+(?:\s+#\S+)*\s*$/u;

/** リンクがある前提の文言を含むか（TikTok 用投稿文の確認用） */
export function hasLinkWording(text: string): boolean {
  LINK_PHRASE.lastIndex = 0;
  return LINK_PHRASE.test(text) || text.split('\n').some((l) => URL_ONLY.test(l));
}

/** 文を句点・感嘆符などの後ろで区切る（区切りの記号・絵文字は前の文に含める） */
function sentences(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  const chars = [...line];
  for (let i = 0; i < chars.length; i++) {
    buf += chars[i];
    if (/[。！？!?]/u.test(chars[i])) {
      // 直後の絵文字・閉じかっこは同じ文に含める
      while (i + 1 < chars.length && /[\p{Extended_Pictographic}️」』）)]/u.test(chars[i + 1])) buf += chars[++i];
      out.push(buf);
      buf = '';
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** リンクの言い回しを除いたあとに残る内容（記号・絵文字・定型の語を除いた文字数で判断する） */
function meaningfulRest(sentence: string): string {
  return sentence
    .replace(LINK_PHRASE, '')
    .replace(/「推しサーチ」(?:へ|で試せます|で)?/gu, '')
    .replace(/続きは|詳しくは|チェック|へ|で試せます|試せます|から/gu, '')
    .replace(/[\s、。！？!?・…「」『』（）()\p{Extended_Pictographic}️]/gu, '');
}

/**
 * 1文を TikTok 向けにする。'cta' = 基本の CTA に置き換える文 / 文字列 = 言い換えた文 / null = 変更なし
 */
function rewriteSentence(s: string): 'cta' | string | null {
  LINK_PHRASE.lastIndex = 0;
  if (!LINK_PHRASE.test(s)) return null;
  // リンクへの誘導だけの文・「推しサーチ」へ誘導する文・検索を勧める文は、基本の CTA にそろえる
  if (meaningfulRest(s).length <= 6 || /「推しサーチ」/u.test(s) || /検索/u.test(s)) return 'cta';
  // 内容のある文は「推しサーチで」に言い換える（リンクの絵文字は検索の絵文字に）
  return s.replace(LINK_PHRASE, '推しサーチで').replace(/🔗/gu, '🔍').replace(/推しサーチで推しサーチで/gu, '推しサーチで');
}

/**
 * TikTok 用投稿文を作る。元の文章は TikTok 用があればそれ、無ければ共通の投稿文（無ければ Instagram 用）。
 * ハッシュタグ・作品名・人物名・グループ名など、元の文章の内容はそのまま残す。元の文章が無ければ null
 */
export function buildTiktokPostText(postTexts: Record<string, string | null | undefined> | null | undefined): string | null {
  const source = postTexts?.tiktok || postTexts?.default || postTexts?.instagram;
  if (!source || !source.trim()) return null;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let ctaPlaced = false;
  const placeCta = () => {
    if (!ctaPlaced) out.push(TIKTOK_CAPTION_CTA);
    ctaPlaced = true;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 元の文章にすでに同じ CTA がある場合は、その位置を使う（二重にしない）
    if (line.trim() === TIKTOK_CAPTION_CTA) {
      placeCta();
      continue;
    }
    // URL だけの行（TikTok のキャプションのリンクは押せない）。直前の「〜で👇」の行も CTA にまとめる
    if (URL_ONLY.test(line)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && /[👇⬇↓]️?\s*$/u.test(prev) && prev !== TIKTOK_CAPTION_CTA) out.pop();
      placeCta();
      continue;
    }
    if (HASHTAG_LINE.test(line)) {
      // CTA がまだ無ければ、ハッシュタグの前（空行の前）に置く
      if (!ctaPlaced) {
        let at = out.length;
        while (at > 0 && out[at - 1].trim() === '') at--;
        out.splice(at, 0, ...(at > 0 ? [''] : []), TIKTOK_CAPTION_CTA);
        ctaPlaced = true;
      }
      out.push(line);
      continue;
    }
    const parts = sentences(line);
    const kept: string[] = [];
    let replaced = false;
    for (const s of parts) {
      const r = rewriteSentence(s);
      if (r === null) kept.push(s);
      else if (r === 'cta') replaced = true;
      else kept.push(r);
    }
    if (!replaced) {
      out.push(kept.join(''));
      continue;
    }
    // CTA に置き換えた文がある行: 残りの文があれば先に残し、CTA は次の行（同じ位置）に1回だけ
    const rest = kept.join('').trim();
    if (rest) out.push(rest);
    placeCta();
  }
  if (!ctaPlaced) {
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    out.push('', TIKTOK_CAPTION_CTA);
  }
  // 空行の連続を1つにし、前後の空行を除く
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return `${text}\n`;
}

/**
 * 管理画面の投稿文タブ用: TikTok だけを TikTok 用投稿文に差し替えた投稿文（他の SNS・共通の投稿文はそのまま）
 */
export function withTiktokPostText(postTexts: Record<string, string | null> | null | undefined): Record<string, string | null> {
  return { ...(postTexts ?? {}), tiktok: buildTiktokPostText(postTexts) };
}
