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
