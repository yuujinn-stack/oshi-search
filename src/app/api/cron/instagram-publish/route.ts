// GET /api/cron/instagram-publish
// Vercel Cronから呼び出す、Instagram予約投稿の自動公開API。
// 認証: Authorization: Bearer {CRON_SECRET}（他のcronルートと同じ方式。/api/cron/*はproxy.tsの
// セッション認証をバイパスするため、このBearerチェックが唯一のゲート）。
//
// 安全装置（重要）: 環境変数 INSTAGRAM_AUTOPUBLISH_ENABLED が文字列 "true" でない限り、
// Instagram APIへの書き込み（カルーセル作成・media_publish）は一切行わない。
// 未設定・"false"・その他の値はすべて「無効」として扱う（安全側）。この判定は
// dryRunより先に行い、実publish経路にのみ適用する（dryRunは元々API書き込みをしない）。
//
// 処理内容（ガードが有効な場合）:
//   1. 処理対象（scheduled、または failed かつ attempts<3。media_id保持済みは絶対に除外）を
//      予定日時の古い順に最大5件取得
//   2. 1件ずつ、条件付きUPDATE（claimDueSchedule）で自分だけの処理対象として確保する
//      （同じIDに対して複数回このCronが同時に走っても、UPDATEが成功するのは1回だけ）
//   3. 確保できた予約について、保存済みのimageUrls/captionを使い
//      Instagram APIでカルーセル作成→media_publishを実行する（画像の再生成はしない）
//   4. 成功したら status=published, media_id, published_at を保存
//   5. media_publish以前の失敗は status=failed（attempts+1）。
//      media_publish呼び出し自体の失敗は status=needs_review とし、二重投稿の恐れがあるため
//      自動再試行の対象から完全に除外する（人による手動確認が必要）。
//
// dryRun（?dryRun=1）: 検証専用。claimまでは本番と全く同じ経路を通るが、
// Instagram APIは一切呼び出さず、確保した予約を即座にscheduledへ戻す
// （= 二重実行防止ロジックの動作確認だけを、実際の投稿なしで行える）。
// INSTAGRAM_AUTOPUBLISH_ENABLEDが無効でも常に利用できる（API書き込みをしないため）。
import { NextRequest, NextResponse } from 'next/server';
import {
  listDueScheduleIds,
  claimDueSchedule,
  releaseSchedule,
  markPublished,
  markFailed,
  markNeedsReview,
  CRON_BATCH_LIMIT,
} from '@/server/instagram-schedule/schedule-store';
import { publishScheduleToInstagram, AmbiguousPublishError, GraphApiRequestError } from '@/server/instagram-schedule/publish-schedule';
import { isAutopublishEnabled } from '@/server/instagram-post/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// カルーセル作成〜media_publishまで、予約1件あたり数十秒かかりうる。最大5件まとめて処理するため余裕を持たせる。
export const maxDuration = 280;

interface ScheduleOutcome {
  id: number;
  personName: string;
  result: 'published' | 'failed' | 'needs_review' | 'dry-run-ok' | 'skipped-already-claimed';
  mediaId?: string;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET が設定されていません' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: '認証エラー' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';

  // ハードガード: dryRunでない実publish経路は、INSTAGRAM_AUTOPUBLISH_ENABLED=trueでない限り
  // ここで必ず停止する。DBのclaim（status変更）すら行わない＝副作用ゼロで安全に返す。
  if (!dryRun && !isAutopublishEnabled()) {
    const dueCount = (await listDueScheduleIds(CRON_BATCH_LIMIT)).length;
    return NextResponse.json({
      guarded: true,
      message: 'INSTAGRAM_AUTOPUBLISH_ENABLED が有効("true")でないため、Instagram APIへの書き込みは行いませんでした。',
      dueCount,
    });
  }

  const dueIds = await listDueScheduleIds(CRON_BATCH_LIMIT);
  const outcomes: ScheduleOutcome[] = [];

  for (const id of dueIds) {
    const claimed = await claimDueSchedule(id);
    if (!claimed) {
      // 既に他の実行（別のCron呼び出しなど）が処理済み。二重投稿防止が機能している証拠。
      outcomes.push({ id, personName: '(unknown)', result: 'skipped-already-claimed' });
      continue;
    }

    if (dryRun) {
      await releaseSchedule(claimed.id);
      outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'dry-run-ok' });
      console.log(`[cron/instagram-publish] dry-run: id=${claimed.id} personName=${claimed.personName} を検証し scheduled へ戻しました（実投稿なし）`);
      continue;
    }

    try {
      const published = await publishScheduleToInstagram(claimed);
      await markPublished(claimed.id, { mediaId: published.mediaId, publishedAt: new Date(published.publishedAt) });
      outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'published', mediaId: published.mediaId });
      console.log(`[cron/instagram-publish] published: id=${claimed.id} personName=${claimed.personName} mediaId=${published.mediaId}`);
    } catch (err) {
      // GraphApiRequestErrorのbodyにはMeta側のエラーメッセージのみが含まれ、access_token等の
      // 秘密情報は含まれない（送信時にURLへ載せているだけで、レスポンスにエコーバックされない）。
      // 念のためmessageのみを保存・ログ出力する。
      const message = err instanceof GraphApiRequestError
        ? err.message
        : err instanceof Error ? err.message : String(err);

      if (err instanceof AmbiguousPublishError) {
        await markNeedsReview(claimed.id, { errorMessage: message, attempts: claimed.attempts + 1 });
        outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'needs_review' });
        console.error(`[cron/instagram-publish] needs_review（要手動確認）: id=${claimed.id} personName=${claimed.personName} error=${message}`);
      } else {
        await markFailed(claimed.id, { errorMessage: message, attempts: claimed.attempts + 1 });
        outcomes.push({ id: claimed.id, personName: claimed.personName, result: 'failed' });
        console.error(`[cron/instagram-publish] failed: id=${claimed.id} personName=${claimed.personName} error=${message}`);
      }
    }
  }

  return NextResponse.json({
    dryRun,
    checkedAt: new Date().toISOString(),
    dueCount: dueIds.length,
    outcomes,
  });
}
