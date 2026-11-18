// 閲覧数・クリック数・検索ランキング等の計測を Redis に記録してよい環境か（純粋関数）。
//
// 背景: Vercel の Preview は Production と同じ Upstash Redis（UPSTASH_REDIS_REST_*）を使う設定のため、
// Preview で商品をクリックすると Preview 自身の /api/track が本番 Redis のクリック数・商品メタデータを更新してしまう
// （src/server/story-maker/post-store.ts の注記と同じ事情）。
// Preview（VERCEL_ENV=preview）だけ記録しない。本番（production）とローカル（未設定）は従来どおり記録する。
// 判定はサーバー側だけで行い、クライアントの送信・リンクの遷移・GA4 送信には影響しない。

export function shouldRecordTracking(vercelEnv: string | undefined = process.env.VERCEL_ENV): boolean {
  return vercelEnv !== 'preview';
}
