// /api/track（type:'product'）でクリック時にクライアントから送られる URL の検証（純粋関数・DB非依存）。
//
// 背景: 商品メタデータ（product:meta:*）の affiliateUrl はトップ「人気商品」のリンク先にそのまま使われる。
// /api/track は誰でも呼べるため、楽天以外のURLや javascript: 等を保存させない。
//
// 方針（保存時と表示時で判定を分ける）:
// - 保存時（isStorableRakutenLinkUrl）: http/https で、ホストが楽天のドメイン（rakuten.co.jp とそのサブドメイン、
//   楽天の短縮URL r10.to とそのサブドメイン）のものだけ保存する。URLの「形式」（/hgc/… 等のパス）では判定しない
//   ＝楽天が発行する形式を推測で絞り込まず、楽天APIのアフィリエイトURL・楽天ブックス/楽天市場の通常URL・
//   短縮URL・旧形式のアフィリエイトURLはすべて保存できる。保存しない場合も、クリック数の加算は従来どおり行い、
//   既存の affiliateUrl も上書きしない（呼び出し側）。
// - 表示時（isSafeHttpUrl）: 既に保存済みの値は、http/https 以外（javascript: 等）だけを使わない。
//   ホストでは絞らないため、既存の正当なリンクの動作は変わらない。
// URL は読むだけで、加工・正規化した値を保存・表示することはない（受け取った文字列をそのまま使う）。

const MAX_URL_LENGTH = 2048;
const RAKUTEN_DOMAINS = ['rakuten.co.jp', 'r10.to'];

function parseHttpUrl(url: unknown, maxLength = Infinity): URL | null {
  if (typeof url !== 'string') return null;
  const s = url.trim();
  if (!s || s.length > maxLength) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    // user:pass@host 形式は表示上のホストと実際の遷移先が紛らわしいため扱わない
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

/** 表示してよい URL か（http/https の絶対URLだけ。ホスト・長さは問わない） */
export function isSafeHttpUrl(url: unknown): url is string {
  return parseHttpUrl(url) !== null;
}

/** 楽天のドメインか（rakuten.co.jp・r10.to と、そのサブドメイン） */
export function isRakutenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return RAKUTEN_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** /api/track で商品リンクとして保存してよい URL か（http/https・楽天のドメイン・2048文字以内） */
export function isStorableRakutenLinkUrl(url: unknown): url is string {
  const u = parseHttpUrl(url, MAX_URL_LENGTH);
  return !!u && isRakutenHost(u.hostname);
}
