// OpenAI API による商品関連性判定
// 呼び出し可能なタイミング:
//   - 管理画面からの再判定実行時
//   - 管理者による商品確認時
// 禁止: ユーザーのページアクセス時に直接呼び出すこと

import OpenAI from 'openai';
import type { Verdict } from './judgment-store';

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export interface JudgeResult {
  verdict: Verdict;
  reason: string;
}

export async function judgeProduct(
  productTitle: string,
  personName: string,
  group: string,
): Promise<JudgeResult | null> {
  const openai = getClient();
  if (!openai) return null;

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // 安価なモデル（関連性判定は高精度モデル不要）
      messages: [{
        role: 'user',
        content: `日本の芸能人・有名人と商品の関連性を判定してください。

人物: ${personName}${group ? `（${group}）` : ''}
商品名: 「${productTitle}」

JSON形式のみで回答してください:
{"verdict":"relevant"|"maybe"|"unrelated","reason":"判定理由（20文字以内）"}

判定基準:
- relevant: その人物の写真集・著書・出演作・グッズ等、明らかに関連している
- maybe: グループ関連・共著・関連の可能性がある（要確認）
- unrelated: 無関係、または別の同名人物の商品`,
      }],
      response_format: { type: 'json_object' },
      max_tokens: 80,
      temperature: 0,
    });

    const content = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(content) as { verdict?: string; reason?: string };
    const validVerdicts: Verdict[] = ['relevant', 'maybe', 'unrelated'];
    const verdict: Verdict = validVerdicts.includes(parsed.verdict as Verdict)
      ? (parsed.verdict as Verdict)
      : 'maybe';

    return { verdict, reason: parsed.reason ?? '' };
  } catch {
    return null;
  }
}

// 複数商品をバッチ判定（順次処理、並列化しすぎるとOpenAI APIが詰まる）
export async function judgeProducts(
  products: Array<{ id: string; title: string }>,
  personName: string,
  group: string,
): Promise<Array<{ id: string; result: JudgeResult | null }>> {
  const results: Array<{ id: string; result: JudgeResult | null }> = [];
  for (const p of products) {
    const result = await judgeProduct(p.title, personName, group);
    results.push({ id: p.id, result });
  }
  return results;
}
