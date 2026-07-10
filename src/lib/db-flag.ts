// READ_FROM_DB_ENABLED=true のときだけ DB 読み取りを使う
// 未設定・false のときは従来通り Redis 読み取り
export function isDbReadEnabled(): boolean {
  return process.env.READ_FROM_DB_ENABLED === 'true';
}

// DB_ONLY_READ_ENABLED=true のとき、通常表示の読み込みはDBのみ
// Redisへのフォールバックは行わない / 書き込みは Redis・DB 両方に引き続き行う
export function isDbOnlyReadEnabled(): boolean {
  return process.env.DB_ONLY_READ_ENABLED === 'true';
}
