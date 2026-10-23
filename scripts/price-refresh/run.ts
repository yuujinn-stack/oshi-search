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
//   PRICE_REFRESH_MAX_PERSONS        … 1回に処理する人物の上限（既定 30。limited-full は既定 3・最大 10。続きは次回）
//   PRICE_REFRESH_MAX_API_CALLS      … 1回に使う楽天APIの回数の上限（既定 400・最大 800。limited-full は最大 400。続きは次回）
//   PRICE_REFRESH_MAX_CATEGORIES     … 1回に楽天を検索するカテゴリ数の上限（既定 200。続きは次回）
//   PRICE_REFRESH_MIN_INTERVAL_DAYS  … 人物ごとの最短更新間隔（日。既定 3）
//   PRICE_REFRESH_LIMITED=1          … 少人数の通常実行（limited-full。人物の指定なしで、定期実行と同じ順番の先頭から上限まで）
//   （上限の決め方は scripts/price-refresh/limits.ts。dry-run で人物を指定しなければ、次の実行で処理する人物・順番・見込みを表示）
//   PRICE_REFRESH_VERBOSE=1          … 詳細ログも表示（ローカル専用。公開リポジトリの Actions では使わない）
//
// ログ：公開リポジトリの Actions ログは誰でも見られるため、既定ではこのスクリプトの件数の要約だけを出し、
// ライブラリが出す詳細ログ（商品ID・店舗コード等を含みうる）は出さない（件数だけ数える）。
// 認証情報・商品名・価格・URL は出力しない。
//
// 実行例（ローカル・dry-run）:
//   PRICE_REFRESH_DRY_RUN=1 PRICE_REFRESH_PERSONS="賀喜遥香" npx dotenv -e .env.local -- npx tsx scripts/price-refresh/run.ts
// 本体（DB 接続を含む）は、環境変数・人物の指定を確認してから読み込む（未設定時に接続エラーの詳細を出さないため）

import { checkRedisEnv, checkRedisRead, describeError, redisEnvProblems } from './diagnostics';
import { resolveRunLimits } from './limits';

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
  const limitedRun = process.env.PRICE_REFRESH_LIMITED === '1';
  // 少人数の通常実行は人物を指定しない（定期実行と同じ順番で先頭から処理する）
  if (limitedRun && onlyPersons.length) {
    out({ error: 'persons_not_allowed', message: 'limited-full では persons を指定しません（定期実行と同じ順番で、先頭から max_persons 人まで処理します）' });
    process.exit(1);
  }
  const missing = required.filter((k) => !(process.env[k] ?? '').trim());
  if (missing.length) { out({ error: 'missing_env', missing }); process.exit(1); }
  if (process.env.OPENAI_API_KEY) out({ warning: 'OPENAI_API_KEY は不要です（この処理は OpenAI を使いません）' });

  const { planPriceRefresh, runPriceRefreshBatch, selectRunOrder, HALT_KEY, LOCK_KEY, STATE_KEY, CATEGORIES_ORDER } = await import('@/lib/price-refresh-runner');
  const { getRedis } = await import('@/lib/redis');
  const { snapshotIo } = await import('@/lib/price-refresh-io');
  const { rakutenApiCallCount } = await import('@/lib/rakuten-api-gate');
  const budgetMin = Math.min(Math.max(Number(process.env.PRICE_REFRESH_BUDGET_MIN ?? 20), 1), 300);
  // 1回の上限と人物ごとの最短更新間隔（安全のため上限・下限を設ける。続きは次回、進み具合は Redis に保存済み）
  const runLimits = resolveRunLimits(process.env);
  const limits = { maxPersons: runLimits.maxPersons, maxApiCalls: runLimits.maxApiCalls, maxCategories: runLimits.maxCategories };
  out({ limits: { budgetMin, lookupPerPerson, ...limits, minIntervalDays: runLimits.minIntervalDays, limited: runLimits.limited } });
  const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
  // Redis（Upstash）への読み取りだけの接続確認。設定の形（値は出さない）と、読み取れるかを出す
  const redisConfigured = !!(process.env.UPSTASH_REDIS_REST_URL ?? '').trim() && !!(process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();
  const checkRedis = async (): Promise<boolean> => {
    const shape = checkRedisEnv(process.env);
    const problems = redisEnvProblems(shape);
    const redis = getRedis();
    const read = redis ? await checkRedisRead(redis, { halt: HALT_KEY, lock: LOCK_KEY }, process.env) : { ok: false };
    out({ redisCheck: read.ok ? 'ok' : 'failed', readOnly: true, ...(read.ok ? { halt: read.halt, locked: read.locked } : { error: read.error }), envShape: shape, ...(problems.length ? { envProblems: problems } : {}) });
    if (!read.ok) out({ alert: 'Redis（Upstash）に接続できません。GitHub の Secrets「UPSTASH_REDIS_REST_URL」「UPSTASH_REDIS_REST_TOKEN」が Vercel の同じ名前の値と一致しているか確認してください（KV_REST_API_READ_ONLY_TOKEN・REDIS_URL・KV_URL ではない）' });
    return read.ok;
  };

  if (dryRun) {
    const io0 = snapshotIo(), calls0 = rakutenApiCallCount();
    type StateLite = { completedAt?: number; startedAt?: number; nextCategory?: number; last?: { at?: number; completed?: boolean; halted?: boolean; failedCategories?: unknown[]; usage?: unknown; priceReviews?: unknown[]; stop?: unknown } };
    let states: Record<string, StateLite> = {};
    // Redis の設定・読み取りを確認し、人物ごとの進み具合を読む（読み取りのみ。書き込みはしない）
    if (redisConfigured) {
      if (!(await checkRedis())) { process.exitCode = 1; return; }
      const raw = (await getRedis()!.hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
      for (const [k, v] of Object.entries(raw)) {
        try { states[k] = (typeof v === 'string' ? JSON.parse(v) : v) as StateLite; } catch { /* 壊れた値は無視 */ }
      }
    } else {
      out({ redisCheck: 'not_configured', note: 'Redis が無いため、進み具合は「すべて未実行」として順番を出します（manual-test・定期実行では必須）' });
    }

    // 対象：人物を指定したらその人物。指定しなければ、次の実行で処理する人物（定期実行・limited-full と同じ選び方・順番の先頭から上限まで）
    let targets = onlyPersons;
    if (!onlyPersons.length) {
      const { getAllPersonsMerged } = await import('@/lib/persons');
      const { listPersonsWithProducts } = await import('@/lib/product-store');
      const [persons, withProducts] = await Promise.all([getAllPersonsMerged(), listPersonsWithProducts()]);
      const names = persons.map((p) => p.name).filter((n) => new Set(withProducts).has(n));
      const order = selectRunOrder(names, states as never, Date.now(), runLimits.minIntervalMs);
      targets = order.slice(0, limits.maxPersons);
      out({ schedulePreview: {
        mode: runLimits.limited ? 'limited-full' : 'scheduled',
        personsWithProducts: names.length,
        eligibleNow: order.length,
        skippedByMinInterval: names.length - order.length,
        minIntervalDays: runLimits.minIntervalDays,
        nextRunPersons: targets.length,
        note: '途中で止まった人物 → 未完了 → 完了が古い順。最短更新間隔より前に完了した人物は除く',
      } });
    }
    const plan = await planPriceRefresh({ onlyPersons: targets, lookupPerPerson });
    const io1 = snapshotIo();
    const byName = new Map(plan.persons.map((p) => [p.name, p]));
    out({ mode: 'dry-run', onlyPersons: onlyPersons.length ? onlyPersons : 'next-run', totals: plan.totals, dbRowsToUpdate: plan.dbRowsToUpdate, note: plan.note });
    // 順番どおりに、人物ごとの見込みと進み具合（人物名は公開情報。商品の情報は出さない）。1回の楽天APIの上限に対して、どこまで処理できる見込みか
    let cumMin = 0, cumMax = 0;
    targets.forEach((name, i) => {
      const p = byName.get(name);
      const st = states[name];
      const inProgress = !!st?.startedAt && (!st.completedAt || st.startedAt > st.completedAt);
      const estMin = p ? p.searchCallsMin + p.lookupUniqueCodes : 0;
      const estMax = p ? p.searchCallsMax + p.lookupUniqueCodes : 0;
      cumMin += estMin; cumMax += estMax;
      out({ next: {
        order: i + 1,
        person: name,
        state: !st ? 'never_run' : inProgress ? 'in_progress' : st.completedAt ? 'completed' : 'never_completed',
        nextCategory: inProgress ? (CATEGORIES_ORDER[st!.nextCategory ?? 0] ?? 'コード指定') : null,
        completedAt: st?.completedAt ? new Date(st.completedAt).toISOString() : null,
        categories: p?.categories ?? 0,
        apiCallsEstimate: { min: estMin, max: estMax },
        cumulativeEstimate: { min: cumMin, max: cumMax },
        withinApiLimit: cumMax <= limits.maxApiCalls ? 'yes' : cumMin <= limits.maxApiCalls ? 'maybe' : 'next_run',
        lastStop: st?.last?.stop ?? null,
        lastHalted: !!st?.last?.halted,
        noProducts: !p,
      } });
    });
    if (onlyPersons.length && plan.persons.length < onlyPersons.length) {
      out({ warning: '指定した人物の一部に商品が無い、または名前が一致しません', found: plan.persons.map((p) => p.name) });
    }
    // dry-run で使った量（楽天APIは呼ばないので0回）と、この人物たちを更新するときの楽天APIの回数の見込み
    out({ usage: { apiCalls: rakutenApiCallCount() - calls0, dbRowsRead: io1.dbRowsRead - io0.dbRowsRead, dbReadKB: kb(io1.dbBytesRead - io0.dbBytesRead) } });
    const t = plan.totals;
    const callsMin = t.searchCallsMin + t.lookupUniqueCodesAll, callsMax = t.searchCallsMax + t.lookupUniqueCodesAll;
    out({ estimate: {
      apiCalls: { min: callsMin, max: callsMax, limit: limits.maxApiCalls, note: 'カテゴリ検索の見込み（1カテゴリ3〜12回）＋コード指定の候補。related の無いカテゴリ・共有キャッシュにある商品は呼ばないため実際はこれ以下' },
      runsNeeded: { min: Math.max(1, Math.ceil(callsMin / limits.maxApiCalls)), max: Math.max(1, Math.ceil(callsMax / limits.maxApiCalls)) },
    } });
    return;
  }

  // 価格の更新を始める前に Redis を読み取りだけで確認する（失敗したら DB・楽天API・Redis に何もせず終了）
  if (!(await checkRedis())) process.exit(1);

  const t0 = Date.now();
  const s = await runPriceRefreshBatch({ budgetMs: budgetMin * 60_000, lookupPerPerson, onlyPersons, ...limits, minIntervalMs: runLimits.minIntervalMs });
  // 楽天から取得できなかったカテゴリ（保存済みの商品は変更していない）を、HTTP ステータスごとに数える（503 等の確認用）
  const failedByStatus: Record<string, number> = {};
  for (const p of s.persons) for (const f of p.failedCategories) {
    const k = f.status === 'db_error' ? 'db_error' : String(f.httpStatus ?? 'network');
    failedByStatus[k] = (failedByStatus[k] ?? 0) + 1;
  }
  out({
    mode: limitedRun ? 'limited-full' : onlyPersons.length ? 'manual-test' : 'scheduled',
    status: s.status,
    stoppedBy: s.stoppedBy,
    persons: s.persons.length,
    completed: s.persons.filter((p) => p.completed).length,
    updatedBySearch: s.updated,
    lookupApiCalls: s.lookedUp,
    lookupApplied: s.lookupApplied,
    failedCategories: failedByStatus,
    // 前回の価格から30%以上の変動などで反映せず確認対象にした商品の数（保存済みの商品は変更していない）
    priceReviews: s.persons.reduce((n, p) => n + p.priceReviews.length, 0),
    // 使った量：楽天APIの呼び出し回数・DB から読んだ行数と量の目安（KB）
    usage: s.usage ? { apiCalls: s.usage.apiCalls, dbRowsRead: s.usage.dbRowsRead, dbReadKB: Math.round(s.usage.dbBytesRead / 102.4) / 10 } : null,
    minutes: Math.round((Date.now() - t0) / 6000) / 10,
    suppressedLogs: suppressed,
    // 自動停止（価格以外の変更を検知）したときの人物と理由（カテゴリ名と種類だけ。商品の情報は含まない）
    halt: s.halt ?? null,
    // 楽天のエラー（429、または 503 等の連続）でその回を終えたときの原因と位置（人物・カテゴリ・HTTP ステータス）
    stopDetail: s.stopDetail ?? null,
  });
  if (s.stoppedBy === 'upstream_errors') out({ alert: '楽天のエラーが続いたため、この回の処理を終えました（取得できなかった商品は変更していません）。原因を確認してください', stopDetail: s.stopDetail });
  if (s.stoppedBy === 'rate_limited') out({ alert: '楽天APIの 429（呼び出しの制限）でこの回を終えました（取得できなかった商品は変更していません）。原因を確認するまで1回の上限を引き上げないでください', stopDetail: s.stopDetail });
  if (s.status === 'halted') out({ alert: '自動停止しました。原因を確認するまで定期実行は何もしません（docs/price-refresh-runbook.md の「自動停止したとき」）' });
  if (onlyPersons.length || limitedRun) {
    for (const p of s.persons) out({ person: p.name, categories: p.categories, updated: p.updated, lookup: p.lookup, completed: p.completed, failedCategories: p.failedCategories, usage: p.usage ? { apiCalls: p.usage.apiCalls, dbRowsRead: p.usage.dbRowsRead, dbReadKB: Math.round(p.usage.dbBytesRead / 102.4) / 10 } : null });
    // 確認対象（商品ID・変更前の価格・取得した価格・変動率・理由。価格と商品IDは公開情報で、認証情報は含まない）
    for (const p of s.persons) for (const r of p.priceReviews) {
      out({ priceReview: { person: p.name, category: r.category, id: r.id, previousPrice: r.previousPrice, fetchedPrice: r.fetchedPrice, changePercent: r.changeRate == null ? null : Math.round(r.changeRate * 1000) / 10, reason: r.reason } });
    }
  }
  if (Object.keys(failedByStatus).length) {
    out({ warning: '楽天から取得できなかったカテゴリがあります（保存済みの商品は変更していません）。手動テスト中は先に進まず原因を確認してください', failedCategories: failedByStatus });
  }
  // 自動停止・楽天のエラーの連続・429 で終えた回は、Actions を失敗として通知する
  if ((s.status !== 'ok' && s.status !== 'locked') || s.stoppedBy === 'upstream_errors' || s.stoppedBy === 'rate_limited') process.exit(1);
}

main().catch((e) => {
  // 原因（Upstash のエラー文・失敗したコマンド名・原因のコード）だけを出す。秘密の値・URL・接続文字列は伏せる
  out({ error: 'failed', ...describeError(e, process.env), suppressedLogs: suppressed });
  if (verbose) original.error(e);
  process.exit(1);
});
