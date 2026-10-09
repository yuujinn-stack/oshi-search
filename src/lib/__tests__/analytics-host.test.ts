import { describe, it, expect } from 'vitest';
import { GA_ALLOWED_HOSTS, isGaAllowedHost } from '../analytics-host';

describe('isGaAllowedHost', () => {
  it('本番ホスト（oshi-search.jp）だけ GA4 を送信する', () => {
    expect(GA_ALLOWED_HOSTS).toEqual(['oshi-search.jp']);
    expect(isGaAllowedHost('oshi-search.jp')).toBe(true);
    expect(isGaAllowedHost('OSHI-SEARCH.JP')).toBe(true);
  });

  it('ローカル・Preview・その他のホストでは送信しない', () => {
    for (const h of [
      'localhost', '127.0.0.1', '::1', '[::1]', 'app.localhost',
      'oshi-search-tjju.vercel.app', 'oshi-search-git-feature-oshi-vod-diagnosis-xxx.vercel.app',
      '192.168.11.15', 'www.oshi-search.jp', 'oshi-search.jp.evil.example', 'evil-oshi-search.jp',
      '', null, undefined,
    ]) {
      expect(isGaAllowedHost(h)).toBe(false);
    }
  });
});
