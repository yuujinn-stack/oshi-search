// OpenAI による配信サービス情報補完
// TMDb Watch Providers で JP 情報が取得できなかった場合のみ呼び出す
// 管理画面・Cron のみ使用可。一般ユーザーアクセス時には絶対に呼ばない。

import OpenAI from 'openai';
import type { VodProvider } from '@/types/vod';
import type { WorkRecord } from '@/types/work';

// 既知の日本向け配信サービスと TMDb provider_id の対応表
// ロゴパスは TMDb API の /watch/providers/movie?language=ja で確認できる値
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
  'TVer': { id: -102 },
  'YouTube': { id: 192, logoPath: '/oIkQkEkwfmcG7IGpRR1NB8frZZM.jpg' },
  'GyaO!': { id: -103 },
  'RakutenTV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  '楽天TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
};

// 未知サービス名から合成 providerId を生成（負の値で TMDb と衝突しない）
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

// OpenAI クライアント（lazy init）
let client: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

interface AiVodResult {
  providers: AiVodProvider[];
  sourceUrl?: string;
  checkedDate?: string;
  note?: string;
}

interface AiVodProvider {
  name: string;
  type: 'flatrate' | 'rent' | 'buy' | 'free' | 'ads' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

// OpenAI に配信情報を問い合わせる（作品単位）
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

  const overviewStr = work.overview ? `概要: ${work.overview.slice(0, 120)}` : '';

  const prompt = `あなたは日本の映像コンテンツ配信サービスの専門家です。
2026年現在、以下の作品が日本で視聴できる配信サービスを教えてください。

タイトル: ${titleStr}
公開年: ${yearStr}
種別: ${typeLabel}
TMDb ID: ${work.tmdbId ?? '不明'}
${overviewStr}

【重要な注意】
・2026年現在、実際に日本で配信中のサービスのみ回答してください
・過去に配信していたが現在は終了しているものは含めないでください
・確信が持てない場合は必ず confidence: "low" を返してください
・情報源が不明な場合も confidence: "low" にしてください
・作品が日本で配信されていない、または不明な場合は providers: [] を返してください

以下のJSON形式のみで回答してください（コメント・説明文は一切不要）:
{
  "providers": [
    {
      "name": "サービス名（例: Netflix, Amazon Prime Video, Hulu, Disney+, U-NEXT, ABEMA等）",
      "type": "flatrate|rent|buy|free|ads|unknown",
      "confidence": "high|medium|low",
      "note": "補足（任意）"
    }
  ],
  "sourceUrl": "参照URL（わかる場合のみ、不明なら空文字）",
  "checkedDate": "2026年",
  "note": "全体的な補足（不要なら空文字）"
}

type の意味: flatrate=見放題, rent=レンタル, buy=購入, free=無料, ads=広告付き無料, unknown=視聴方法不明`;

  try {
    console.log(`[vod-ai] OpenAI補完開始: "${work.title}" (${typeLabel}, ${yearStr})`);
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 500,
      temperature: 0,
    });

    const raw = res.choices[0]?.message?.content;
    if (!raw) return [];

    const parsed = JSON.parse(raw) as AiVodResult;
    if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
      console.log(`[vod-ai] "${work.title}": AI補完結果なし`);
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
        source: 'openai_supplement',
        sourceLabel: 'AI補完',
        confidence: p.confidence ?? 'low',
        sourceUrl: parsed.sourceUrl || undefined,
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
    console.error(`[vod-ai] OpenAI補完エラー: "${work.title}"`, err);
    return [];
  }
}
