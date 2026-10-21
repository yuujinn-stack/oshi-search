// 価格の分割自動更新をコマンドラインから実行する（GitHub Actions・手動用）。
// OpenAI は使わない（OPENAI_API_KEY は不要。渡さないこと）。判定・掲載状態は変えない。新しい商品は追加しない。
//
// 必要な環境変数: DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
//                 RAKUTEN_APP_ID, RAKUTEN_ACCESS_KEY, RAKUTEN_AFFILIATE_ID, NEXT_PUBLIC_SITE_URL
//   （dry-run は DATABASE_URL だけで動く。楽天API・Redis は使わない）
// 任意:
//   PRICE_REFRESH_DRY_RUN=1          … 読み取りだけで、対象人物・商品件数・推定API回数・DB更新対象を表示（書き込みなし）
//   PRICE_REFRESH_PERSONS="名前,名前" … この人物だけ処理する（手動テスト用。カンマ区切り・完全一致）
//   PRICE_REFRESH_REQUIRE_PERSONS=1  … 人物の指定を必須にし、2人までに限る（GitHub Actions の manual-test）
//   PRICE_REFRESH_BUDGET_MIN         … 1回の実行で作業を始めてよい時間（既定 20 分）
//   PRICE_REFRESH_LOOKUP_PER_PERSON  … 1人あたりのコード指定の取得の上限（既定 60）
//   PRICE_REFRESH_VERBOSE=1          … 詳細ログも表示（ローカル専用。公開リポジトリの Actions では使わない）
//
// ログ：公開リポジトリの Actions ログは誰でも見られるため、既定ではこのスクリプトの件数の要約だけを出し、
// ライブラリが出す詳細ログ（商品ID・店舗コード等を含みうる）は出さない（件数だけ数える）。
// 認証情報・商品名・価格・URL は出力しない。
//
// 実行例（ローカル・dry-run）:
//   PRICE_REFRESH_DRY_RUN=1 PRICE_REFRESH_PERSONS="賀喜遥香" npx dotenv -e .env.local -- npx tsx scripts/price-refresh/run.ts
// 本体（DB 接続を含む）は、環境変数・人物の指定を確認してから読み込む（未設定時に接続エラーの詳細を出さないため）

const TAG = '[price-refresh-run]';
const MAX_TEST_PERSONS = 2;
const verbose = process.env.PRICE_REFRESH_VERBOSE === '1';
const original = { log: console.log, error: console.error };
const suppressed = { log: 0, warn: 0, error: 0 };
function out(obj: unknown) { original.log(`${TAG} ${JSON.stringify(obj)}`); }
if (!verbose) {
  console.log = () => { suppressed.log++; };
  console.info = () => { suppressed.log++; };
  console.debug = () => { suppressed.log++; };
  console.warn = () => { suppressed.warn++; };
  console.error = () => { suppressed.error++; };
}

async function main() {
  const dryRun = process.env.PRICE_REFRESH_DRY_RUN === '1';
  const onlyPersons = (process.env.PRICE_REFRESH_PERSONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const lookupPerPerson = Math.max(0, Number(process.env.PRICE_REFRESH_LOOKUP_PER_PERSON ?? 60));
  const required = dryRun
    ? ['DATABASE_URL']
    : ['DATABASE_URL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RAKUTEN_APP_ID', 'RAKUTEN_ACCESS_KEY'];
  // 手動テスト（manual-test）では人物の指定を必須にする（指定し忘れて全員を更新しないため）
  if (process.env.PRICE_REFRESH_REQUIRE_PERSONS === '1' && onlyPersons.length === 0) {
    out({ error: 'persons_required', message: 'manual-test では persons（人物名）を指定してください' });
    process.exit(1);
  }
  // 小規模テストは1人ずつ（多くても2人）。それ以上は定期実行・full で行う
  if (process.env.PRICE_REFRESH_REQUIRE_PERSONS === '1' && onlyPersons.length > MAX_TEST_PERSONS) {
    out({ error: 'too_many_persons', message: `manual-test で指定できる人物は${MAX_TEST_PERSONS}人までです`, given: onlyPersons.length });
    process.exit(1);
  }
  const missing = required.filter((k) => !(process.env[k] ?? '').trim());
  if (missing.length) { out({ error: 'missing_env', missing }); process.exit(1); }
  if (process.env.OPENAI_API_KEY) out({ warning: 'OPENAI_API_KEY は不要です（この処理は OpenAI を使いません）' });

  const { planPriceRefresh, runPriceRefreshBatch } = await import('@/lib/price-refresh-runner');

  if (dryRun) {
    const plan = await planPriceRefresh({ onlyPersons, lookupPerPerson });
    out({ mode: 'dry-run', onlyPersons: onlyPersons.length ? onlyPersons : 'all', totals: plan.totals, dbRowsToUpdate: plan.dbRowsToUpdate, note: plan.note });
    // 人物ごとの件数（人物名は公開情報。商品の情報は出さない）
    const shown = onlyPersons.length ? plan.persons : plan.persons.slice(0, 20);
    for (const p of shown) out({ ...p });
    if (shown.length < plan.persons.length) out({ more_persons: plan.persons.length - shown.length });
    if (onlyPersons.length && plan.persons.length < onlyPersons.length) {
      out({ warning: '指定した人物の一部に商品が無い、または名前が一致しません', found: plan.persons.map((p) => p.name) });
    }
    return;
  }

  const budgetMin = Math.min(Math.max(Number(process.env.PRICE_REFRESH_BUDGET_MIN ?? 20), 1), 300);
  const t0 = Date.now();
  const s = await runPriceRefreshBatch({ budgetMs: budgetMin * 60_000, lookupPerPerson, onlyPersons });
  // 楽天から取得できなかったカテゴリ（保存済みの商品は変更していない）を、HTTP ステータスごとに数える（503 等の確認用）
  const failedByStatus: Record<string, number> = {};
  for (const p of s.persons) for (const f of p.failedCategories) {
    const k = f.status === 'db_error' ? 'db_error' : String(f.httpStatus ?? 'network');
    failedByStatus[k] = (failedByStatus[k] ?? 0) + 1;
  }
  out({
    mode: onlyPersons.length ? 'manual-test' : 'scheduled',
    status: s.status,
    stoppedBy: s.stoppedBy,
    persons: s.persons.length,
    completed: s.persons.filter((p) => p.completed).length,
    updatedBySearch: s.updated,
    lookupApiCalls: s.lookedUp,
    lookupApplied: s.lookupApplied,
    failedCategories: failedByStatus,
    minutes: Math.round((Date.now() - t0) / 6000) / 10,
    suppressedLogs: suppressed,
    // 自動停止（価格以外の変更を検知）したときの人物と理由（カテゴリ名と種類だけ。商品の情報は含まない）
    halt: s.halt ?? null,
  });
  if (s.status === 'halted') out({ alert: '自動停止しました。原因を確認するまで定期実行は何もしません（docs/price-refresh-runbook.md の「自動停止したとき」）' });
  if (onlyPersons.length) {
    for (const p of s.persons) out({ person: p.name, categories: p.categories, updated: p.updated, lookup: p.lookup, completed: p.completed, failedCategories: p.failedCategories });
  }
  if (Object.keys(failedByStatus).length) {
    out({ warning: '楽天から取得できなかったカテゴリがあります（保存済みの商品は変更していません）。手動テスト中は先に進まず原因を確認してください', failedCategories: failedByStatus });
  }
  if (s.status !== 'ok' && s.status !== 'locked') process.exit(1);
}

main().catch((e) => {
  // 例外の内容は出さない（DB 接続文字列等を含みうる）。種類だけ
  out({ error: 'failed', kind: e instanceof Error ? e.name : typeof e, suppressedLogs: suppressed });
  if (verbose) original.error(e);
  process.exit(1);
});
