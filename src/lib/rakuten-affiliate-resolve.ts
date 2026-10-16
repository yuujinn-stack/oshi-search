// 手動登録時の affiliateUrl を、既存DBの正規アフィリエイトURL（楽天APIが発行して保存済みのもの）から決める（サーバー専用）。
// 判定ロジックは src/lib/rakuten-affiliate-link.ts（純粋関数）。ここではDBから候補を読むだけで、DBへの書き込み・楽天APIの呼び出しはしない。
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import {
  classifyRakutenLink,
  decideManualAffiliateUrl,
  parseAffiliateUrl,
  productKeyOfLink,
  productKeyString,
  type AffiliateCandidate,
  type ManualAffiliateDecision,
  type RakutenProductKey,
} from '@/lib/rakuten-affiliate-link';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** affiliateUrl の pc パラメータ（URLエンコード済み）に含まれる商品ページの正規表現 */
function encodedPagePattern(key: RakutenProductKey): string {
  if (key.source === 'books') {
    // 楽天ブックスの商品ページ、または楽天市場上の楽天ブックス店（店舗 book・商品コード＝商品番号）
    return `pc=https?%3A%2F%2F(books\\.rakuten\\.co\\.jp%2Frb|item\\.rakuten\\.co\\.jp%2Fbook)%2F${key.productNumber}(%2F|&|$)`;
  }
  return `pc=https?%3A%2F%2Fitem\\.rakuten\\.co\\.jp%2F${escapeRegex(key.shop)}%2F${escapeRegex(key.itemCode)}(%2F|&|$)`;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

/**
 * 同じ商品の、楽天APIが発行したアフィリエイトURL（手動登録以外の商品）を既存DBから探す（最大50件）。
 * 先に products の行を文字列で絞り込んでから（楽天ブックス＝商品番号を含む行、楽天市場＝商品コードを含む行。
 * どちらも必ず候補を含む上位集合）items を展開するため、全商品の展開より速い。最終的な一致判定は従来どおり正規表現で行う。
 */
export async function findAffiliateCandidates(key: RakutenProductKey): Promise<AffiliateCandidate[]> {
  const rowFilter = key.source === 'books'
    ? sql`strpos(p.items::text, ${key.productNumber}) > 0`
    : sql`p.items::text ILIKE ${`%${escapeLike(key.itemCode)}%`}`;
  const result = await db.execute(sql`
    SELECT DISTINCT item->>'id' AS id, item->>'title' AS title, item->>'affiliateUrl' AS "affiliateUrl"
    FROM products p, jsonb_array_elements(p.items) AS item
    WHERE ${rowFilter}
      AND item->>'id' !~ '^mn-'
      AND item->>'affiliateUrl' ~ '^https?://hb\\.afl\\.rakuten\\.co\\.jp/hgc/'
      AND item->>'affiliateUrl' ~* ${encodedPagePattern(key)}
    LIMIT 50
  `);
  return result.rows as unknown as AffiliateCandidate[];
}

/** 貼り付けられたアフィリエイトURLの識別部分が、楽天APIが発行した既存URL（手動登録以外）にあるか */
async function isKnownIssuerHgc(hgc: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM products, jsonb_array_elements(items) AS item
    WHERE item->>'id' !~ '^mn-'
      AND (starts_with(item->>'affiliateUrl', ${`https://hb.afl.rakuten.co.jp/hgc/${hgc}/`})
           OR starts_with(item->>'affiliateUrl', ${`http://hb.afl.rakuten.co.jp/hgc/${hgc}/`}))
    LIMIT 1
  `);
  return result.rows.length > 0;
}

/**
 * 手動登録・編集時の affiliateUrl を決める。
 * ① 楽天API（管理画面の楽天検索）が返した正規URL → ② 既存DBの同じ商品の正規URL（商品名・盤種表記・遷移先を検証）→
 * ③ 確認できなければ空（要確認）。URLを組み立てたり、短縮URLを展開したりはしない。
 * DBの読み取りに失敗した場合も、推測はせず要確認として返す。
 */
export async function resolveManualAffiliateUrl(input: {
  title: string;
  itemUrl: string;
  apiAffiliateUrl?: string;
}): Promise<ManualAffiliateDecision> {
  const kind = classifyRakutenLink(input.itemUrl);
  const key = productKeyOfLink(input.itemUrl);
  let candidates: AffiliateCandidate[] = [];
  const knownIssuerHgcs = new Set<string>();
  try {
    const api = parseAffiliateUrl(input.apiAffiliateUrl);
    const apiUsable = !!api && !!key && productKeyString(api.key) === productKeyString(key);
    if (!apiUsable && (kind === 'books_plain' || kind === 'ichiba_plain') && key) {
      candidates = await findAffiliateCandidates(key);
    }
    if (kind === 'affiliate') {
      const parsed = parseAffiliateUrl(input.itemUrl)!;
      if (await isKnownIssuerHgc(parsed.hgc)) knownIssuerHgcs.add(parsed.hgc);
    }
  } catch (err) {
    console.error('[rakuten-affiliate] candidate lookup failed:', String(err));
  }
  return decideManualAffiliateUrl({ ...input, candidates, knownIssuerHgcs });
}
