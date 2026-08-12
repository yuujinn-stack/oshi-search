/**
 * 楽天商品画像 URL を高解像度版に正規化する。
 *
 * 楽天イチバの画像 URL は末尾に ?_ex=NxN サフィックスを含む場合があり、
 * N が小さいと表示画像が粗くなる。このサフィックスを 500x500 に上書きすることで
 * 高解像度版を取得できる。Books / DVD の largeImageUrl はサフィックスを持たないため
 * この関数を通しても変化しない（安全に呼び出せる）。
 */
export function getBestProductImageUrl(imageUrl: string): string {
  if (!imageUrl) return '';
  // ?_ex=NxN → ?_ex=500x500  (任意のサイズ指定を 500x500 に変換)
  return imageUrl.replace(/\?_ex=\d+x\d+/, '?_ex=500x500');
}

/**
 * 楽天商品名にHTMLエンティティ（&amp; 等）が未デコードのまま混入している場合に、
 * 表示直前でデコードする（work-image.ts の getRenderableWorkImageUrl と同じ方針）。
 * DBの値はそのまま保持し、表示時にのみ変換する（DB書き込みは行わない）。
 */
const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

export function getRenderableProductTitle(title: string): string {
  if (!title) return '';
  return title.replace(/&amp;|&quot;|&#39;|&apos;|&lt;|&gt;/g, (m) => HTML_ENTITY_MAP[m]);
}
