// 価格更新専用ユーザーの保護トリガーの関数を、販売状況の項目（stockStatus・stockCheckedAt）も変更できるように更新する。
// 変えるのは関数 products_price_refresher_guard() の中身だけ（テーブル・列・トリガー・権限・ロールは変えない。サイトの接続には影響なし）。
// SQL の内容: src/lib/price-refresh-stock-guard-sql.ts
//
//   確認（読み取りのみ）: npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts check
//   SQL の表示           : npx tsx scripts/price-refresh/stock-guard.ts show
//   適用（書き込み）     : PRICE_REFRESH_STOCK_GUARD_CONFIRM=APPLY npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts apply
//   取り消し（書き込み） : PRICE_REFRESH_STOCK_GUARD_CONFIRM=UNDO  npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts undo
// 適用・取り消しはオーナー（.env.local の DATABASE_URL＝neondb_owner）で行う。price_refresher の接続では実行しない。
// 取り消す前に、定期実行の変数 PRICE_REFRESH_STOCK_FIELDS を 1 以外に戻すこと（戻さないと価格更新の保存がトリガーに拒否される）。
import { neon } from '@neondatabase/serverless';
import { STOCK_GUARD_FUNCTION_SQL, STOCK_GUARD_UNDO_SQL, stockGuardApplied } from '@/lib/price-refresh-stock-guard-sql';

async function currentDef(sql: ReturnType<typeof neon<false, false>>): Promise<string | null> {
  const rows = (await sql`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'products_price_refresher_guard'`) as { d: string }[];
  return rows[0]?.d ?? null;
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'show') {
    console.log('-- 適用する SQL\n' + STOCK_GUARD_FUNCTION_SQL + '\n\n-- 取り消しの SQL\n' + STOCK_GUARD_UNDO_SQL);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL が未設定です（オーナーの接続で実行）'); process.exit(1); }
  const sql = neon(url);
  const [who] = (await sql`SELECT current_user AS u`) as { u: string }[];
  if (who?.u === 'price_refresher') { console.error('price_refresher の接続では実行できません（オーナーの接続で実行）'); process.exit(1); }
  const def = await currentDef(sql);
  const trig = (await sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'products'::regclass AND tgname = 'products_price_refresher_guard' AND NOT tgisinternal`) as { n: number }[];
  const state = { user: who?.u, functionExists: !!def, triggerExists: (trig[0]?.n ?? 0) === 1, stockFieldsAllowed: def ? stockGuardApplied(def) : false };
  if (cmd === 'check') {
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (!state.functionExists || !state.triggerExists) {
    console.error('保護トリガー・関数がありません。先に docs/price-refresh-runbook.md の「最小権限の DB ユーザー」を適用してください。', JSON.stringify(state));
    process.exit(1);
  }
  if (cmd === 'apply') {
    if (process.env.PRICE_REFRESH_STOCK_GUARD_CONFIRM !== 'APPLY') { console.error('適用するには PRICE_REFRESH_STOCK_GUARD_CONFIRM=APPLY が必要です'); process.exit(1); }
    if (state.stockFieldsAllowed) { console.log(JSON.stringify({ applied: false, reason: '適用済み' })); return; }
    await sql.query(STOCK_GUARD_FUNCTION_SQL);
    const after = await currentDef(sql);
    console.log(JSON.stringify({ applied: true, stockFieldsAllowed: after ? stockGuardApplied(after) : false }));
  } else if (cmd === 'undo') {
    if (process.env.PRICE_REFRESH_STOCK_GUARD_CONFIRM !== 'UNDO') { console.error('取り消すには PRICE_REFRESH_STOCK_GUARD_CONFIRM=UNDO が必要です'); process.exit(1); }
    await sql.query(STOCK_GUARD_UNDO_SQL);
    const after = await currentDef(sql);
    console.log(JSON.stringify({ undone: true, stockFieldsAllowed: after ? stockGuardApplied(after) : false }));
  } else {
    console.error('使い方: check | show | apply | undo');
    process.exit(1);
  }
})().catch((e) => { console.error('ERROR', e instanceof Error ? e.message : String(e)); process.exit(1); });
