// READ_FROM_DB_ENABLED=true のときだけ DB 読み取りを使う
// 未設定・false のときは従来通り Redis 読み取り
export function isDbReadEnabled(): boolean {
  return process.env.READ_FROM_DB_ENABLED === 'true';
}
