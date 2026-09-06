import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { processPersonCategory } from '@/lib/batch-processor';
import { getAllPersonsMerged } from '@/lib/persons';
import { getRedis } from '@/lib/redis';
import { RANKING_DATA_CACHE_TAG } from '@/lib/ranking';
import { CATEGORIES } from '@/lib/product-store';
import type { ProductCategory } from '@/types/person';
import { acquireBatchLock, releaseBatchLock, personRakutenFetchLockKey } from '@/lib/batch-lock';

// 1カテゴリの想定最大処理時間は写真集（最重量カテゴリ）でも数十秒〜長くて数分程度
// （429多発時含む）で収まる想定だが、他ルートと足並みを揃えて300秒を明示する。
export const maxDuration = 300;

// POST /api/admin/rakuten-refetch
// body: { personName: "..." , category: "写真集"|"本・雑誌"|"Blu-ray・DVD"|"グッズ"|"CD"|"中古" , forceRejudge?: boolean }
// 1人・1カテゴリ分の楽天商品取得のみを行うエンドポイント（「楽天再取得」ボタン専用）。
//
// 以前はこのエンドポイントが1回の呼び出しで6カテゴリ全件の取得+AI判定まで行っていたが、
// 商品数の多い人物（例: 別名の多いアイドル）ではVercelの実行時間上限（300秒）を超え、
// FUNCTION_INVOCATION_TIMEOUT（504）になる事象が確認されたため、カテゴリ単位に分割した。
// フロント（PersonRakutenFetchButton.tsx）が6カテゴリを順番に呼び、全カテゴリ完了後は
// 既存の /api/admin/ai-judge を繰り返し呼んでAI判定を行う（AI判定ロジック自体は無変更）。
//
// 検索条件・ページング・DB保存仕様・判定ルールは processPersonCategory() 側で
// 元のprocessPerson()と全く同じロジックを使用しており、本ファイルでは変更していない。
export async function POST(req: NextRequest) {
  const startMs = Date.now();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { ok: false, status: 'server_error', error: 'Redis が設定されていません。UPSTASH_REDIS_REST_URL / TOKEN を確認してください。' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({})) as {
    personName?: string;
    category?: string;
    forceRejudge?: boolean;
  };

  if (!body.personName) {
    return NextResponse.json({ ok: false, status: 'bad_request', error: 'personName が必要です' }, { status: 400 });
  }
  if (!body.category || !CATEGORIES.includes(body.category as ProductCategory)) {
    return NextResponse.json(
      { ok: false, status: 'bad_request', error: `category が不正です（有効値: ${CATEGORIES.join(', ')}）` },
      { status: 400 },
    );
  }
  const category = body.category as ProductCategory;

  // getAllPersonsMerged() で検索することで CSVインポート人物も configOverride で渡せる
  const persons = await getAllPersonsMerged();
  const personConfig = persons.find((p) => p.name === body.personName);
  if (!personConfig) {
    return NextResponse.json(
      { ok: false, status: 'not_found', error: `人物が見つかりません: ${body.personName}` },
      { status: 404 },
    );
  }

  // ── 人物単位の二重実行防止（同じ人物のカテゴリ取得を同時に複数走らせない） ──────
  // AI判定用ロック（personAiJudgeLockKey）とは別の名前空間のため、互いに干渉しない。
  // カテゴリ呼び出し1回ごとに取得・解放するため、フロントの6カテゴリ順次呼び出し自体は
  // 妨げない（前のカテゴリのロックは既に解放済みの状態で次のカテゴリが呼ばれる）。
  const lockKey = personRakutenFetchLockKey(body.personName);
  const ownerId = `rakuten-refetch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await acquireBatchLock(ownerId, lockKey);
  if (!acquired) {
    return NextResponse.json(
      { ok: false, status: 'locked', error: 'この人物の楽天再取得はすでに実行中です' },
      { status: 409 },
    );
  }

  try {
    let result;
    try {
      result = await processPersonCategory(body.personName, category, body.forceRejudge ?? false, personConfig);
    } catch (err) {
      const durationMs = Date.now() - startMs;
      console.error(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:server_error durationMs:${durationMs} error:${String(err)}`);
      return NextResponse.json(
        { ok: false, status: 'server_error', error: '処理中にエラーが発生しました', category },
        { status: 500 },
      );
    }

    const durationMs = Date.now() - startMs;

    // ── RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY 未設定 ────────────────────────────
    if (result.rakutenConfigMissing) {
      console.log(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:config_missing durationMs:${durationMs} envVarsMissing:RAKUTEN_APP_ID,RAKUTEN_ACCESS_KEY`);
      return NextResponse.json(
        { ok: false, status: 'config_missing', error: '楽天APIの設定が不足しています（RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY）', category },
        { status: 503 },
      );
    }

    // ── DB保存失敗 ────────────────────────────────────────────────────────────
    if (result.dbError) {
      console.error(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:db_error durationMs:${durationMs} error:${result.dbError}`);
      return NextResponse.json(
        { ok: false, status: 'db_error', error: 'データベースへの保存に失敗しました', category },
        { status: 500 },
      );
    }

    // ── 楽天APIエラー（このカテゴリは0件） ────────────────────────────────────
    if (result.fetchFailed) {
      if (result.upstreamHttpStatus === 429) {
        console.log(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:rate_limited durationMs:${durationMs}`);
        return NextResponse.json(
          { ok: false, status: 'rate_limited', error: `楽天APIが一時的な利用制限中です（${category}）。しばらく待ってからこのカテゴリを再実行してください。`, httpStatus: 429, category },
          { status: 429 },
        );
      }
      if (result.upstreamHttpStatus !== undefined) {
        console.log(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:upstream_error upstreamHttpStatus:${result.upstreamHttpStatus} durationMs:${durationMs}`);
        return NextResponse.json(
          { ok: false, status: 'upstream_error', error: `楽天APIが ${result.upstreamHttpStatus} を返しました（${category}）`, httpStatus: result.upstreamHttpStatus, category },
          { status: 502 },
        );
      }
      console.log(`[rakuten-refetch] operation:rakuten_refetch_category personName:${body.personName} category:${category} status:network_error durationMs:${durationMs}`);
      return NextResponse.json(
        { ok: false, status: 'network_error', error: `楽天APIへの接続に失敗しました（タイムアウトまたはネットワーク障害、${category}）`, category },
        { status: 500 },
      );
    }

    revalidatePath(`/person/${encodeURIComponent(body.personName)}`);
    // 楽天再取得は既存商品の画像URLも更新しうるため、実際に商品が保存された場合のみ
    // 「人気商品」のホーム表示キャッシュを再検証する（取得0件の場合は呼ばない）
    if (result.stored > 0) {
      revalidateTag(RANKING_DATA_CACHE_TAG, { expire: 0 });
    }

    console.log([
      `[rakuten-refetch] operation:rakuten_refetch_category`,
      `personName:${body.personName}`,
      `category:${category}`,
      `status:success`,
      `fetched:${result.stored}`,
      `skipped:${result.skipped}`,
      `excluded:${result.excluded}`,
      `autoApproved:${result.autoApproved}`,
      `usedSuppressed:${result.usedSuppressed}`,
      `membershipFiltered:${result.membershipFiltered}`,
      `pendingAiJudge:${result.toJudge.length}`,
      `durationMs:${durationMs}`,
    ].join(' '));

    return NextResponse.json({
      ok: true,
      status: 'success',
      category,
      person: {
        category,
        stored: result.stored,
        autoApproved: result.autoApproved,
        skipped: result.skipped,
        excluded: result.excluded,
        usedSuppressed: result.usedSuppressed,
        membershipFiltered: result.membershipFiltered,
        pendingAiJudge: result.toJudge.length,
      },
    });
  } finally {
    // 正常終了・異常終了問わず必ず解放する（TTL 10分もあるため異常終了時も永久ロックしない）
    await releaseBatchLock(ownerId, 'completed', lockKey);
  }
}
