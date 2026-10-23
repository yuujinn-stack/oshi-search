// 推し活お買い物診断の「推し活に便利な一般商品」の選定リスト（推しサーチ独自の選定データ）。
//
// 楽天ウェブサービス規約 第10条1項(9)（不特定または多数人と情報を共有できる場所に、ウェブサービスを通じて
// 得た情報を保管することの禁止）に配慮し、公開リポジトリには選定リストを置かない。
// itemCode（店舗コード:商品コード）は API から得た情報であり、規約の「商品情報」に当たるかを判断できないため、
// サーバー側の環境変数 OSHI_SHOPPING_GENERAL_ITEMS（JSON 配列）から読み込む。
//   例: [{"itemCode":"shop:12345","use":"live","label":"コンサート向けの双眼鏡"}, ...]
// 商品名・価格・画像・URL は保存せず、表示時に楽天市場商品検索APIから取得する（rakuten-lookup.ts）。
// 一般用品であり、特定の人物・グループの商品や公式グッズではない。レビュー件数・評価で品質や安全性を確認したものではない。
import { USE_OPTIONS, type OshiShoppingUse } from './params';

export interface GeneralItemEntry {
  /** 楽天市場の商品識別子（店舗コード:商品コード） */
  itemCode: string;
  use: OshiShoppingUse;
  /** 推しサーチが付けた用途の短い説明（商品名ではない） */
  label: string;
}

export const GENERAL_ITEMS_ENV = 'OSHI_SHOPPING_GENERAL_ITEMS';
const ITEM_CODE_RE = /^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_.-]*$/;
// 推しサーチの説明に、人物の商品・公式品と誤認させる語を使わない
const FORBIDDEN_LABEL_RE = /公式|オフィシャル|本人/;

/**
 * 環境変数の JSON を検証して選定リストにする。不正な要素は捨てる（推測で補わない）。
 * JSON 自体が壊れている・未設定なら空配列（一般商品欄は「準備中」を表示する）。
 */
export function parseGeneralItemEntries(raw: string | undefined | null): GeneralItemEntry[] {
  const json = decodeGeneralItemsValue(raw);
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: GeneralItemEntry[] = [];
  for (const x of data) {
    if (!x || typeof x !== 'object') continue;
    const { itemCode, use, label } = x as Record<string, unknown>;
    if (typeof itemCode !== 'string' || typeof use !== 'string' || typeof label !== 'string') continue;
    const code = itemCode.trim().toLowerCase();
    const text = label.trim();
    if (!ITEM_CODE_RE.test(code) || seen.has(code)) continue;
    if (!USE_OPTIONS.some((u) => u.value === use)) continue;
    if (!text || text.length > 40 || FORBIDDEN_LABEL_RE.test(text)) continue;
    seen.add(code);
    out.push({ itemCode: code, use: use as OshiShoppingUse, label: text });
  }
  return out;
}

/** base64 形式の接頭辞（Vercel の画面やシェルで JSON の引用符が崩れないよう、base64 にした値も受け付ける） */
export const GENERAL_ITEMS_BASE64_PREFIX = 'base64:';

/**
 * 環境変数の値を JSON 文字列にする。前後の空白と、値全体を囲む引用符（.env の書き方のまま貼った場合）を除く。
 * `base64:` で始まれば base64 を UTF-8 の JSON として読む。読めなければ null。
 */
export function decodeGeneralItemsValue(raw: string | undefined | null): string | null {
  let v = (raw ?? '').trim();
  // JSON の配列は '[' で始まるため、値全体が引用符で囲まれていればそれは貼り付け時の囲み（.env の書き方）として外す
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) v = v.slice(1, -1).trim();
  if (!v) return null;
  if (v.startsWith(GENERAL_ITEMS_BASE64_PREFIX)) {
    const b64 = v.slice(GENERAL_ITEMS_BASE64_PREFIX.length).trim();
    if (!/^[A-Za-z0-9+/=_-]+$/.test(b64)) return null;
    try {
      return Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return v;
}

let warned = false;

/** サーバー専用：環境変数から選定リストを読む。値はあるのに読めない・一部が不正なら、件数だけをログに出す（値は出さない） */
export function getGeneralItemEntries(): GeneralItemEntry[] {
  const raw = process.env[GENERAL_ITEMS_ENV];
  const entries = parseGeneralItemEntries(raw);
  if (!warned && raw && raw.trim()) {
    let total = -1;
    try { const d = JSON.parse(decodeGeneralItemsValue(raw) ?? ''); total = Array.isArray(d) ? d.length : -1; } catch { /* 読めない */ }
    if (total !== entries.length) {
      warned = true;
      console.warn(`[oshi-shopping] ${GENERAL_ITEMS_ENV} を一部またはすべて読めませんでした（読めた件数 ${entries.length}／値の件数 ${total < 0 ? '不明' : total}）`);
    }
  }
  return entries;
}
