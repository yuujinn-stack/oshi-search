import type { ServiceUsage } from './types';

const TMDB_LICENSE_LABELS: Record<string, string> = {
  non_commercial:       '非商用利用（無料）',
  commercial_pending:   '商用確認中',
  commercial:           '商用契約済み',
  unknown:              '未設定',
};

export async function getTMDbInfo(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();
  const licenseType = process.env.TMDB_LICENSE_TYPE ?? 'unknown';
  const renewalDate = process.env.TMDB_CONTRACT_RENEWAL_DATE ?? null;

  return {
    serviceId: 'tmdb',
    displayName: 'TMDb API',
    purpose: '人物情報・出演作品・VODウォッチプロバイダーのメタデータ取得',
    plan: TMDB_LICENSE_LABELS[licenseType] ?? licenseType,
    planSource: 'unavailable',
    status: 'unknown',
    metrics: [],
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl: 'https://www.themoviedb.org/settings/api',
    fetchedAt,
    fetchError: null,
    details: {
      licenseType,
      contractRenewalDate: renewalDate,
      callTrackingEnabled: false,
      endpoints: [
        '/search/person',
        '/person/{id}/movie_credits',
        '/person/{id}/tv_credits',
        '/movie/{id}/watch/providers',
        '/tv/{id}/watch/providers',
      ],
      usageNote: 'API呼び出し数の計測は未実装。既存の tmdb.ts を共通ラッパー化することで段階的に追加可能。',
      licenseNote: licenseType === 'non_commercial' || licenseType === 'unknown'
        ? '商用利用の場合はTMDbへライセンス確認が必要です。環境変数 TMDB_LICENSE_TYPE で状態を管理してください。'
        : null,
      rateLimitNote: 'TMDb無料APIのレート制限: 毎秒50リクエスト（v3）、認証トークン毎秒10リクエスト',
    },
  };
}

export async function getRakutenInfo(): Promise<ServiceUsage> {
  const fetchedAt = new Date().toISOString();

  return {
    serviceId: 'rakuten',
    displayName: '楽天API',
    purpose: '楽天市場・楽天ブックスの商品検索・商品情報取得',
    plan: null,
    planSource: 'unavailable',
    status: 'unknown',
    metrics: [],
    currentMonthlyCostUsd: null,
    projectedMonthlyCostUsd: null,
    costSource: 'unavailable',
    dashboardUrl: 'https://webservice.rakuten.co.jp/app/list',
    fetchedAt,
    fetchError: null,
    details: {
      callTrackingEnabled: false,
      endpoints: [
        '楽天市場: /IchibaItem/Search/20220601',
        '楽天ブックス: /BooksBook/Search/20170404',
      ],
      usageNote: 'API呼び出し数の計測は未実装。既存の rakuten.ts を共通ラッパー化することで段階的に追加可能。',
      rateLimitNote: '楽天APIのレート制限: 1秒1リクエスト推奨。超過時は429相当のエラー応答あり。',
      billingNote: '楽天APIは無償提供。課金情報は公式APIから取得不可。',
    },
  };
}
