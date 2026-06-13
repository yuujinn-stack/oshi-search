// OpenAI Responses API + web_search_preview による配信サービス情報補完
// TMDb Watch Providers で JP 情報が取得できなかった場合のみ呼び出す
// 管理画面・Cron のみ使用可。一般ユーザーアクセス時には絶対に呼ばない。
// モデル: gpt-4o（出演作品判定の gpt-4o-mini とは別）

import OpenAI from 'openai';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// 既知の日本向け配信サービスと TMDb provider_id の対応表
const JP_PROVIDER_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Amazon プライムビデオ': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu': { id: 15, logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'フールー': { id: 15, logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'ディズニープラス': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Apple TV+': { id: 350, logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'U-NEXT': { id: 97, logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'UNEXT': { id: 97, logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV': { id: 408, logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi': { id: 258, logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA': { id: 395, logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'テラサ': { id: 395, logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'FODプレミアム': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'レミノ': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'アベマ': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'NHKプラス': { id: -101 },
  'NHK+': { id: -101 },
  'NHKオンデマンド': { id: -107 },
  'NHK on Demand': { id: -107 },
  'TVer': { id: -102 },
  'ティーバー': { id: -102 },
  'YouTube': { id: 192, logoPath: '/oIkQkEkwfmcG7IGpRR1NB8frZZM.jpg' },
  'GyaO!': { id: -103 },
  'RakutenTV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  '楽天TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'DMM TV': { id: -104 },
  'DMMTV': { id: -104 },
  'WOWOWオンデマンド': { id: -105 },
  'WOWOW': { id: -105 },
  'WOWOWプラス': { id: -105 },
  'dアニメストア': { id: -106 },
  'dAnime Store': { id: -106 },
  'バンダイチャンネル': { id: -108 },
  'Bandai Channel': { id: -108 },
};

function syntheticProviderId(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash % 10000) - 200;
}

function lookupProvider(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(JP_PROVIDER_LOOKUP).find(
    (k) => k.toLowerCase() === name.toLowerCase() || name.includes(k) || k.includes(name),
  );
  if (key) return JP_PROVIDER_LOOKUP[key];
  return { id: syntheticProviderId(name) };
}

let client: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

interface AiVodProvider {
  name: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free' | 'ads' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  officialUrl?: string;
  reason?: string;
  note?: string;
}

interface AiVodResult {
  providers: AiVodProvider[];
  note?: string;
}

function extractJson(text: string): AiVodResult {
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = blockMatch ? blockMatch[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonStr) throw new Error('JSONが見つかりません');
  return JSON.parse(jsonStr) as AiVodResult;
}

const BACKTICK3 = '```';

// gpt-4o + web_search_preview で配信情報を検索・補完（作品単位）
// source: openai_web_search, sourceLabel: AI Web検索補完
export async function supplementVodWithAI(
  work: WorkRecord,
): Promise<VodProvider[]> {
  const openai = getOpenAI();
  if (!openai) {
    console.log('[vod-ai] OPENAI_API_KEY 未設定 - スキップ');
    return [];
  }

  const typeLabel = work.type === 'movie' ? '映画' : 'ドラマ・TV';
  const yearStr = work.releaseYear ? `${work.releaseYear}年` : '公開年不明';
  const titleStr = work.originalTitle ? `${work.title}（原題: ${work.originalTitle}）` : work.title;
  const overviewStr = work.overview ? `概要: ${work.overview.slice(0, 150)}` : '';

  const prompt = `あなたは日本の動画配信サービス調査アシスタントです。
以下の作品について、2026年現在、日本国内で視聴可能な配信サービスをWebで検索・調査してください。

タイトル: ${titleStr}
公開年: ${yearStr}
種別: ${typeLabel}
TMDb ID: ${work.tmdbId ?? '不明'}
${overviewStr}

【調査方法】
以下のキーワードでWeb検索して情報を収集してください:
- "${work.title} 配信"
- "${work.title} 見逃し配信"
- "${work.title} どこで見れる"
- "${work.title} Hulu", "${work.title} U-NEXT", "${work.title} ABEMA"
- "${work.title} TVer", "${work.title} Lemino", "${work.title} DMM TV"
- "${work.title} FOD", "${work.title} Prime Video", "${work.title} Netflix"

【日本のバラエティ・アイドル番組の場合の追加考慮】
番組の放送局が判明している場合、以下の傾向を参考にしてください（推測のみで確定せず、検索で確認すること）:
- 日本テレビ系 → Hulu の可能性が高い
- テレビ東京系 → U-NEXT / Lemino / TVer の可能性
- テレビ朝日系 → TELASA / ABEMA の可能性
- フジテレビ系 → FOD の可能性が高い
- TBS系 → U-NEXT / TVer の可能性

【優先的に確認するサービス】
Hulu, U-NEXT, DMM TV, Lemino, Netflix, Prime Video, ABEMA, TVer, FOD, TELASA, Disney+, WOWOWオンデマンド, Paravi系コンテンツ, NHKオンデマンド, バンダイチャンネル, dアニメストア

【ルール】
- 2026年現在、実際に日本で配信中のサービスのみ回答してください
- 過去に配信していたが現在は終了しているものは含めないでください
- 見放題・レンタル・購入・見逃し配信・期間限定配信を含めてください
- Webで実際に確認できた場合: confidence "high" または "medium"
- 可能性が高いが確認できなかった場合: confidence "medium"
- 推測のみで確認できていない場合: confidence "low"（note に不確かである旨を記載）
- 全く確認できない場合は providers: [] を返してください

以下のJSON形式のみで最終回答してください（${BACKTICK3}json ブロックで囲む）:

${BACKTICK3}json
{
  "providers": [
    {
      "name": "サービス名（公式正式名称）",
      "type": "flatrate|rent|buy|free|ads|unknown",
      "confidence": "high|medium|low",
      "officialUrl": "配信を確認したURL（公式または信頼できるページ、不明なら空文字）",
      "reason": "このサービスで配信されている根拠（検索で確認した内容を簡潔に）",
      "note": "補足（見逃し配信・期間限定・不確かな点など）"
    }
  ],
  "note": "全体的な補足（不要なら空文字）"
}
${BACKTICK3}

type の意味:
- flatrate = 月額見放題
- rent = レンタル（個別課金）
- buy = 購入
- free = 無料配信（見逃し・NHKオンデマンド等）
- ads = 広告付き無料配信（ABEMA無料枠・TVer等）
- unknown = 配信あるが視聴方法不明`;

  try {
    console.log(`[vod-ai] Web検索補完開始: "${work.title}" (${typeLabel}, ${yearStr})`);

    // Responses API + web_search_preview（gpt-4o）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (openai as any).responses.create({
      model: 'gpt-4o',
      tools: [{ type: 'web_search_preview' }],
      input: prompt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: string = (response as any).output_text ?? '';
    if (!raw) return [];

    const parsed = extractJson(raw);
    if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
      console.log(`[vod-ai] "${work.title}": Web検索補完結果なし`);
      return [];
    }

    const today = new Date().toISOString().slice(0, 10);
    const providers: VodProvider[] = parsed.providers.map((p) => {
      const meta = lookupProvider(p.name);
      return {
        providerId: meta.id,
        providerName: p.name,
        logoPath: meta.logoPath,
        type: p.type ?? 'unknown',
        countryCode: 'JP',
        source: 'openai_web_search',
        sourceLabel: 'AI Web検索補完',
        confidence: p.confidence ?? 'low',
        officialUrl: p.officialUrl || undefined,
        reason: p.reason || undefined,
        checkedDate: today,
        note: p.note || parsed.note || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });

    console.log(
      `[vod-ai] "${work.title}": ${providers.length}件取得 (${providers.map((p) => p.providerName).join(', ')})`,
    );
    return providers;
  } catch (err) {
    console.error(`[vod-ai] Web検索補完エラー: "${work.title}"`, err);
    return [];
  }
}
