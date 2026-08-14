import { describe, it, expect } from 'vitest';
import { getLocalLogoUrl } from '../ProviderLogo';

// 本番で発見された不整合（/work/tmdb-tv-228620 で /providers/disney-plus.png への
// 不要な404が発生していた）の再発防止テスト。
// public/providers/ には現時点で実ファイルが1件も存在しない（.gitkeepのみ）ため、
// getLocalLogoUrl はどのproviderNameを渡しても存在しないURLを生成してはいけない。
describe('getLocalLogoUrl（存在しないローカルロゴ画像への404防止）', () => {
  it('Disney+ は存在しないURLを生成しない（nullを返す）', () => {
    expect(getLocalLogoUrl('Disney+')).toBeNull();
    expect(getLocalLogoUrl('Disney+ (ディズニープラス)')).toBeNull();
  });

  it('対象14サービスすべてで、実ファイルが存在しない現状ではnullを返す', () => {
    const names = [
      'Hulu', 'U-NEXT', 'Netflix', 'Prime Video', 'DMM TV', 'Lemino', 'FOD',
      'TELASA', 'ABEMA', 'TVer', 'YouTube', 'NHKオンデマンド', 'のぎ動画',
    ];
    for (const name of names) {
      expect(getLocalLogoUrl(name)).toBeNull();
    }
  });

  it('未知のサービス名でもnullを返す（クラッシュしない）', () => {
    expect(getLocalLogoUrl('未知の配信サービス')).toBeNull();
    expect(getLocalLogoUrl('')).toBeNull();
  });
});
