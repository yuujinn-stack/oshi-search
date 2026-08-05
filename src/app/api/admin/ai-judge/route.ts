import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { judgeStoredProducts } from '@/lib/batch-processor';
import { MAX_EXCLUDE_PRODUCT_IDS } from '@/lib/ai-judge-constants';
import { getAllPersonsMerged } from '@/lib/persons';
import { getRedis } from '@/lib/redis';
import { acquireBatchLock, releaseBatchLock, personAiJudgeLockKey } from '@/lib/batch-lock';

// POST /api/admin/ai-judge
// body: { personName: "..." , forceRejudge?: boolean, limit?: number, excludeProductIds?: string[] }
// 個人単位の「AI判定」ボタン（1バッチ最大10件）と「全件AI判定」（クライアント側が
// このエンドポイントを繰り返し呼ぶことで未判定を最後まで処理する）の両方から使う、
// 単一バッチ処理エンドポイント。
//
// 重要: このエンドポイントは楽天APIを一切呼ばない。対象は Neon の products.items に
// 既に保存されている商品のみで、verdicts への書き込みだけを行う。楽天商品の再取得は
// 別エンドポイント /api/admin/rakuten-refetch （「楽天再取得」ボタン専用）で行う。
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
    forceRejudge?: boolean;
    limit?: number;
    excludeProductIds?: string[];
  };

  if (!body.personName) {
    return NextResponse.json({ ok: false, status: 'bad_request', error: 'personName が必要です' }, { status: 400 });
  }

  // excludeProductIdsは受け取った時点でも上限を掛ける（judgeStoredProducts側でも再度検証する）
  const excludeProductIds = Array.isArray(body.excludeProductIds)
    ? body.excludeProductIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_EXCLUDE_PRODUCT_IDS)
    : undefined;

  // getAllPersonsMerged() で検索することで CSVインポート人物も configOverride で渡せる
  const persons = await getAllPersonsMerged();
  const personConfig = persons.find((p) => p.name === body.personName);
  if (!personConfig) {
    return NextResponse.json(
      { ok: false, status: 'not_found', error: `人物が見つかりません: ${body.personName}` },
      { status: 404 },
    );
  }

  // ── 人物単位の二重実行防止（クライアント側のdisabledだけに依存しない） ──────
  // 「全件AI判定」は複数リクエストに分かれるが、1バッチ処理中に必ずロックを解放してから
  // 次のバッチが送信される直列設計のため、このロックはバッチ単位のままで正しく機能する。
  const lockKey = personAiJudgeLockKey(body.personName);
  const ownerId = `ai-judge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await acquireBatchLock(ownerId, lockKey);
  if (!acquired) {
    return NextResponse.json(
      { ok: false, status: 'locked', error: 'この人物のAI判定はすでに実行中です' },
      { status: 409 },
    );
  }

  try {
    let result;
    try {
      result = await judgeStoredProducts(body.personName, body.forceRejudge ?? false, personConfig, {
        limit: body.limit,
        excludeProductIds,
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      console.error(`[ai-judge] operation:judge_stored personName:${body.personName} status:server_error durationMs:${durationMs} error:${String(err)}`);
      return NextResponse.json(
        { ok: false, status: 'server_error', error: '処理中にエラーが発生しました' },
        { status: 500 },
      );
    }

    const durationMs = Date.now() - startMs;

    // ── 保存済み商品が0件（先に楽天再取得が必要） ─────────────────────────────
    if (result.noStoredProducts) {
      console.log(`[ai-judge] operation:judge_stored personName:${body.personName} status:no_stored_products durationMs:${durationMs}`);
      return NextResponse.json({
        ok: true,
        status: 'no_stored_products',
        person: { ...result, message: '保存済みの商品がありません。先に楽天再取得を実行してください' },
      });
    }

    if (result.error) {
      console.error(`[ai-judge] operation:judge_stored personName:${body.personName} status:error durationMs:${durationMs} error:${result.error}`);
      return NextResponse.json({ ok: false, status: 'server_error', error: result.error }, { status: 500 });
    }

    revalidatePath(`/person/${encodeURIComponent(body.personName)}`);

    // ── ステータス判定 ────────────────────────────────────────────────────────
    const apiStatus: 'success' | 'complete' | 'no_targets' =
      result.totalUnclassifiedBefore === 0
        ? 'no_targets'
        : result.stopReason === 'COMPLETED'
          ? 'complete'
          : 'success';

    // ── メッセージ生成 ────────────────────────────────────────────────────────
    // 失敗理由が単一種類（レート制限 or 残高/上限）に偏っている場合は、その専用文言を優先する
    let dominantFailureMessage: string | null = null;
    if (result.failedCount > 0 && result.aiFailures.length > 0) {
      const codes = new Set(result.aiFailures.map((f) => f.code));
      if (codes.size === 1) {
        const code = result.aiFailures[0].code;
        if (code === 'RATE_LIMIT') dominantFailureMessage = 'OpenAI APIが一時的な利用制限中です。しばらく待ってから再実行してください';
        else if (code === 'INSUFFICIENT_QUOTA') dominantFailureMessage = 'OpenAI APIの残高または利用上限を確認してください';
      }
    }

    let message = '';
    if (result.aiKeyMissing) {
      message = 'OPENAI_API_KEY 未設定: AI判定をスキップしました';
    } else if (apiStatus === 'no_targets') {
      message = '未判定の商品はありません';
    } else if (result.stopReason === 'INSUFFICIENT_QUOTA') {
      message = 'OpenAI APIの残高または利用上限を確認してください';
    } else if (dominantFailureMessage) {
      message = dominantFailureMessage;
    } else if (apiStatus === 'complete') {
      message = 'すべての商品を判定しました';
    } else if (result.stopReason === 'FAILED_ITEMS_REMAIN') {
      message = `${result.successCount}件を判定しました。${result.failedInThisRunCount}件は失敗したため未判定のままです`;
    } else if (result.attemptedCount > 0 && result.successCount === 0 && result.failedCount > 0) {
      message = '今回の判定は保存されませんでした';
    } else if (result.failedCount > 0) {
      message = `${result.successCount}件を判定しました。${result.failedCount}件失敗、残り${result.remainingCount}件`;
    } else {
      message = `${result.successCount}件を判定しました。残り${result.remainingCount}件`;
    }

    console.log([
      `[ai-judge] operation:judge_stored`,
      `personName:${body.personName}`,
      `status:${apiStatus}`,
      `totalUnclassifiedBefore:${result.totalUnclassifiedBefore}`,
      `attempted:${result.attemptedCount}`,
      `success:${result.successCount}`,
      `failed:${result.failedCount}`,
      `remaining:${result.remainingCount}`,
      `runnableRemaining:${result.runnableRemainingCount}`,
      `failedInThisRun:${result.failedInThisRunCount}`,
      `stopProcessing:${result.stopProcessing}`,
      `stopReason:${result.stopReason ?? '-'}`,
      `autoApproved:${result.autoApproved}`,
      `excluded:${result.excluded}`,
      `membershipFiltered:${result.membershipFiltered}`,
      `related:${result.relatedCount}`,
      `unrelated:${result.unrelatedCount}`,
      `uncertain:${result.uncertainCount}`,
      `aiKeyMissing:${result.aiKeyMissing}`,
      `durationMs:${durationMs}`,
    ].join(' '));

    return NextResponse.json({ ok: true, status: apiStatus, person: { ...result, message } });
  } finally {
    // 正常終了・異常終了問わず必ず解放する。TTL（10分）もあるため異常終了時に永久ロックしない。
    await releaseBatchLock(ownerId, 'completed', lockKey);
  }
}
