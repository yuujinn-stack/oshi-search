import 'server-only';
import { getRedis } from '@/lib/redis';
import { DEFAULT_SNS_CTA, parseSnsCtaSettings, type SnsCtaSettings } from '@/lib/video-sns-output';

/**
 * 動画生成の SNS別CTA設定（/admin/video-maker の「SNS別CTA設定」）。
 * 動画生成の補助設定のため Redis に1件だけ保存する（DBの列・テーブルは増やさない）。未保存・Redis 未設定なら既定値
 * （TikTok=検索窓CTA「気になったら、推しサーチで検索！」、Instagram=テンプレートのCTAのまま）。
 * 生成に使った設定はジョブごとに template_input.snsOutput に残るため、ここを変えても作成済みのジョブは変わらない。
 */
const BASE_KEY = 'video-maker:sns-cta-settings:v1';

/**
 * 保存するキー。Vercel の Preview は Production と同じ Redis（UPSTASH_REDIS_REST_URL / TOKEN）を使う設定のため、
 * 本番（VERCEL_ENV=production）だけが従来のキーを使い、Preview・ローカル等は環境ごとの別のキーに保存する
 * （Preview の管理画面で保存しても本番の設定は変わらない）。
 */
export function snsCtaSettingsKey(vercelEnv: string | undefined = process.env.VERCEL_ENV): string {
  return vercelEnv === 'production' ? BASE_KEY : `${BASE_KEY}:${vercelEnv || 'local'}`;
}

/** この環境の設定が本番の設定か（管理画面に「本番とは別の設定」と表示するため） */
export function snsCtaSettingsScope(vercelEnv: string | undefined = process.env.VERCEL_ENV): 'production' | 'preview' | 'local' {
  return vercelEnv === 'production' ? 'production' : vercelEnv === 'preview' ? 'preview' : 'local';
}

export async function getSnsCtaSettings(): Promise<{ settings: SnsCtaSettings; saved: boolean; storage: boolean }> {
  const redis = getRedis();
  if (!redis) return { settings: structuredClone(DEFAULT_SNS_CTA), saved: false, storage: false };
  try {
    const raw = await redis.get<unknown>(snsCtaSettingsKey());
    if (!raw) return { settings: structuredClone(DEFAULT_SNS_CTA), saved: false, storage: true };
    return { settings: parseSnsCtaSettings(typeof raw === 'string' ? JSON.parse(raw) : raw), saved: true, storage: true };
  } catch (err) {
    console.warn(`[sns-cta-settings] 読み込めなかったため既定値を使います: ${String(err)}`);
    return { settings: structuredClone(DEFAULT_SNS_CTA), saved: false, storage: true };
  }
}

/** 検証してから保存する（不正な値は SnsOutputError） */
export async function saveSnsCtaSettings(raw: unknown): Promise<SnsCtaSettings> {
  const settings = parseSnsCtaSettings(raw);
  const redis = getRedis();
  if (!redis) throw new Error('設定の保存先（Redis）が設定されていません。');
  await redis.set(snsCtaSettingsKey(), JSON.stringify(settings));
  return settings;
}

/** 保存した設定を消して既定値に戻す */
export async function resetSnsCtaSettings(): Promise<SnsCtaSettings> {
  const redis = getRedis();
  if (redis) await redis.del(snsCtaSettingsKey());
  return structuredClone(DEFAULT_SNS_CTA);
}
