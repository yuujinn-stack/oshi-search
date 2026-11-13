import { beforeEach, describe, expect, it, vi } from 'vitest';

// SNS別CTA設定の保存先: Preview は本番と同じ Redis を使うため、本番以外は別のキーに保存する（本番の設定を変えない）
const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: unknown) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  }),
}));

beforeEach(() => {
  store.clear();
  vi.unstubAllEnvs();
});

describe('sns-cta-settings', () => {
  it('キー: 本番だけ従来のキー、Preview・ローカルは別のキー', async () => {
    const { snsCtaSettingsKey, snsCtaSettingsScope } = await import('../sns-cta-settings');
    expect(snsCtaSettingsKey('production')).toBe('video-maker:sns-cta-settings:v1');
    expect(snsCtaSettingsKey('preview')).toBe('video-maker:sns-cta-settings:v1:preview');
    expect(snsCtaSettingsKey('development')).toBe('video-maker:sns-cta-settings:v1:development');
    expect(snsCtaSettingsKey(undefined)).toBe('video-maker:sns-cta-settings:v1:local');
    expect(snsCtaSettingsScope('production')).toBe('production');
    expect(snsCtaSettingsScope('preview')).toBe('preview');
    expect(snsCtaSettingsScope(undefined)).toBe('local');
  });

  it('Preview で保存・既定に戻すをしても、本番のキーの値は変わらない', async () => {
    const prod = JSON.stringify({ tiktok: { narration: '本番の文言です' } });
    store.set('video-maker:sns-cta-settings:v1', prod);
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { saveSnsCtaSettings, resetSnsCtaSettings, getSnsCtaSettings } = await import('../sns-cta-settings');
    expect((await getSnsCtaSettings()).saved).toBe(false); // Preview は本番の設定を読まない
    await saveSnsCtaSettings({ tiktok: { narration: 'プレビューの文言' } });
    expect(store.get('video-maker:sns-cta-settings:v1')).toBe(prod);
    expect(String(store.get('video-maker:sns-cta-settings:v1:preview'))).toContain('プレビューの文言');
    await resetSnsCtaSettings();
    expect(store.get('video-maker:sns-cta-settings:v1')).toBe(prod);
  });

  it('本番は従来のキーを読み書きする', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const { saveSnsCtaSettings, getSnsCtaSettings } = await import('../sns-cta-settings');
    await saveSnsCtaSettings({ tiktok: { narration: '本番で保存' } });
    expect(String(store.get('video-maker:sns-cta-settings:v1'))).toContain('本番で保存');
    expect((await getSnsCtaSettings()).settings.tiktok.narration).toBe('本番で保存');
  });
});
