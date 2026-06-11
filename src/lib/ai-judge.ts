// OpenAI API による商品関連性判定
// 呼び出し可能なタイミング:
//   - 管理画面からの再判定実行時（バッチ処理）
// 禁止: ユーザーのページアクセス時に直接呼び出すこと

import OpenAI from 'openai';
import type { Verdict } from './judgment-store';
import type { PersonWithConfig } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';

// プロンプトバージョン: このバージョンと異なる ai 判定済み商品は自動再判定される
// プロンプトを修正したらこの値をインクリメントすること
export const PROMPT_VERSION = 'v3';

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

// タイトルに人物名＋写真集、またはアーティスト名が自分のグループと一致するCDの場合は
// AI 呼び出しなしで related 確定（OpenAI コスト削減 + 判定精度向上）
// 中古商品（【中古】プレフィックス）も同じルールを適用する
export function shouldAutoApprove(product: RakutenItem, person: PersonWithConfig): boolean {
  // 【中古】プレフィックスを除いた実タイトルで判定
  const title = product.title.replace(/^【中古】\s*/, '').replace(/^\[中古\]\s*/, '');
  const candidateNames = [
    person.name,
    person.config.realName ?? '',
    ...(person.config.aliases ?? []),
  ].filter(Boolean);
  const nameInTitle = candidateNames.some((n) => n && title.includes(n));

  // ケース1: タイトルに人物名＋写真集 → related（新品・中古どちらも）
  if (nameInTitle && title.includes('写真集')) return true;

  // ケース2: CDカテゴリ または 中古CD でアーティストが自分のグループ → related
  const isGroupCd =
    product.category === 'CD' ||
    (product.isUsed && /CD|シングル|アルバム/.test(title));
  if (
    isGroupCd &&
    person.group &&
    product.artistName &&
    product.artistName.includes(person.group)
  ) return true;

  return false;
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

  const prompt = `あなたは芸能人関連商品の関連性を判定するAIです。

対象人物:
${personText}

対象商品:
${productText}

【判定基準】

■ related（確実に関連あり）— 以下のいずれかに該当する場合
- 商品タイトルに人物の芸名・本名・旧芸名のいずれかが含まれ、かつ「写真集」「ムック」が含まれる（score: 90以上）
- 商品タイトルにグループ名と人物名の両方が含まれる書籍・DVD・Blu-ray・CD（score: 85以上）
- 著者・出演者・アーティスト欄に人物名が記載されている（score: 80以上）
- 商品名・説明に人物名が明確に含まれ、本人出演・掲載が確認できる（score: 75以上）
- 本人掲載雑誌・本人出演DVD・本人関連グッズ
- アーティスト欄またはタイトルに人物の所属グループ名が含まれるCD・シングル・アルバム（score: 80）
  ※ グループのCDにはメンバー全員が関与しているため、所属が確認できれば related とする
- タイトルに人物名が含まれるCD・シングル・アルバム（score: 90以上）

■ uncertain（判断困難）
- 名前が一致するが別人の可能性がある
- 説明が不足して判断できない
- グループ関連だが本人が特定できない

■ unrelated（無関係）
- 完全に別人・別グループの商品
- 名前の偶然一致（同名の一般人など）
- 人物と無関係な一般商品

【重要ルール】
商品タイトルに人物の芸名が明確に含まれる写真集・書籍は、別人を示す根拠がない限り必ず related と判定すること。

【中古商品の取り扱い】
商品名の先頭に「【中古】」が含まれる場合は、その部分を除いて関連性を判定してください。
中古品であることは関連性の判断に影響しません。
例: 「【中古】乃木坂46 筒井あやめ1st写真集 感情の隙間」→ 人物名を含む写真集として related (score: 95) と判定。

【判定例】
人物: 筒井あやめ（グループ: 乃木坂46）
商品名: 乃木坂46 筒井あやめ1st写真集 感情の隙間
→ { "label": "related", "score": 95, "reason": "本人の1st写真集" }

以下のJSONのみ返してください（他のテキスト不要）:
{ "label":"related|uncertain|unrelated", "score":0-100, "reason":"50文字以内" }`;

  console.log(`[AI_INPUT] personName:${person.name} groupName:${person.group ?? ''} productTitle:"${product.title}" category:${product.category} author:${product.author ?? ''} artistName:${product.artistName ?? ''} promptVersion:${PROMPT_VERSION}`);

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

    console.log(`[AI_OUTPUT] label:${verdict} score:${score} reason:"${parsed.reason ?? ''}" title:"${product.title.slice(0, 50)}"`);
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
