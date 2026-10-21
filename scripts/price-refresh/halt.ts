// 価格の分割自動更新の自動停止の印（Redis price-refresh:halt）を確認・解除する。
//   確認（読み取りのみ）: npx dotenv -e <Upstash の環境変数を含むファイル> -- npx tsx scripts/price-refresh/halt.ts status
//   解除（書き込み）    : PRICE_REFRESH_HALT_CLEAR_CONFIRM=yes ... halt.ts clear
// 解除の前に、scripts/price-refresh/snapshot.ts compare・backup.ts restore（dry-run）で原因を確認すること。
import { getRedis } from '@/lib/redis';
import { HALT_KEY } from '@/lib/price-refresh-runner';

(async () => {
  const redis = getRedis();
  if (!redis) { console.error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定です'); process.exit(1); }
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const v = await redis.get(HALT_KEY);
    console.log(JSON.stringify({ halted: !!v, info: v ?? null }));
  } else if (cmd === 'clear') {
    if (process.env.PRICE_REFRESH_HALT_CLEAR_CONFIRM !== 'yes') { console.error('解除するには PRICE_REFRESH_HALT_CLEAR_CONFIRM=yes が必要です'); process.exit(1); }
    await redis.del(HALT_KEY);
    console.log(JSON.stringify({ cleared: true }));
  } else {
    console.error('使い方: status | clear');
    process.exit(1);
  }
})();
