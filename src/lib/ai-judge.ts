// OpenAI API による商品関連性判定
// 呼び出し可能なタイミング:
//   - 管理画面からの再判定実行時（バッチ処理）
// 禁止: ユーザーのページアクセス時に直接呼び出すこと

import OpenAI from 'openai';
import type { Verdict } from './judgment-store';
import type { PersonWithConfig } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export interface JudgeResult {
  verdict: Verdict;
  score: number;
  reason: string;
}

function buildPersonText(person: PersonWithConfig): string {
  const parts: string[] = [];
  parts.push(`芸名: ${person.name}`);
  if (person.config.realName) parts.push(`本名: ${person.config.realName}`);
  if (person.config.reading) parts.push(`読み: ${person.config.reading}`);
  if (person.group) parts.push(`グループ名: ${person.group}`);
  if (person.config.aliases?.length) parts.push(`旧芸名・愛称: ${person.config.aliases.join('、')}`);
  if (person.config.customKeywords?.length) parts.push(`関連キーワード: ${person.config.customKeywords.join('、')}`);
  return parts.join('\n');
}

function buildProductText(product: RakutenItem): string {
  const parts: string[] = [];
  parts.push(`商品名: ${product.title}`);
  if (product.author) parts.push(`著者: ${product.author}`);
  if (product.artistName) parts.push(`アーティスト: ${product.artistName}`);
  if (product.shopName) parts.push(`ショップ名: ${product.shopName}`);
  if (product.catchcopy) parts.push(`キャッチコピー: ${product.catchcopy}`);
  if (product.description) parts.push(`商品説明: ${product.description}`);
  return parts.join('\n');
}

export async function judgeProduct(
  product: RakutenItem,
  person: PersonWithConfig,
): Promise<JudgeResult | null> {
  const openai = getClient();
  if (!openai) {
    console.log('[ai-judge] SKIP: OPENAI_API_KEY が未設定のため AI 判定をスキップ');
    return null;
  }

  const personText = buildPersonText(person);
  const productText = buildProductText(product);

  const prompt = `あなたは芸能人関連商品の判定AIです。

人物情報:
${personText}

商品情報:
${productText}

以下の基準で判定してください。

【related】
本人出演作品 本人掲載雑誌 本人写真集 本人グッズ 本人監修商品 本人関連書籍

【uncertain】
関連している可能性はあるが確信できない
例: 名前のみ一致 / 説明文不足 / 別人の可能性あり / 判定材料不足

【unrelated】
関連性が確認できない 別人 一般商品 偶然一致

以下のJSONのみ返してください。
{ "label":"related|uncertain|unrelated", "score":0-100, "reason":"50文字以内" }`;

  console.log(`[ai-judge] リクエスト: ${person.name} | 「${product.title.slice(0, 50)}」`);

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 100,
      temperature: 0,
    });

    const content = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { label?: string; score?: number; reason?: string };
    const validVerdicts: Verdict[] = ['related', 'uncertain', 'unrelated'];
    const verdict: Verdict = validVerdicts.includes(parsed.label as Verdict)
      ? (parsed.label as Verdict)
      : 'uncertain';
    const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50;

    console.log(`[ai-judge] 結果: ${verdict} (${score}) | 理由: ${parsed.reason ?? '(なし)'} | 「${product.title.slice(0, 40)}」`);
    return { verdict, score, reason: parsed.reason ?? '' };
  } catch (err) {
    console.error(`[ai-judge] エラー: ${person.name} | 「${product.title.slice(0, 40)}」 |`, err);
    return null;
  }
}

// 複数商品をバッチ判定（順次処理）
export async function judgeProducts(
  products: RakutenItem[],
  person: PersonWithConfig,
): Promise<Array<{ id: string; result: JudgeResult | null }>> {
  const results: Array<{ id: string; result: JudgeResult | null }> = [];
  for (const p of products) {
    const result = await judgeProduct(p, person);
    results.push({ id: p.id, result });
  }
  return results;
}
