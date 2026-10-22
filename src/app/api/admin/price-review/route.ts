// /api/admin/price-review — 価格の確認待ちの承認・却下（管理画面 /admin/price-refresh）
//
// POST { action: 'sync' }                                                              → Redis の確認待ちを DB に取り込む
// POST { action: 'approve' | 'reject', id, expectedPreviousPrice, expectedFetchedPrice, operator } → 承認・却下（先に取り込みも行う）
//
// 管理画面の表示（GET）は読み取りのみで、DB への書き込みはこの POST だけで行う。
// proxy.ts の認証に加え、この処理でも管理者のセッションと Origin を確認する（権限の確認をサーバー側で二重に行う）。
// 承認は price_reviews の確認待ちと DB の商品を承認直前に再確認し、1つのトランザクションで price・priceFetchedAt だけを更新する
// （src/lib/price-review-store.ts）。他の商品の書き込みは読んだ時点の items と一致する場合だけ保存するため（src/lib/product-write-guard.ts）、
// 承認した価格が価格更新・新商品の発見・管理画面の編集で上書きされることはない。
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { checkCsrfOrigin, SESSION_COOKIE, validateSecretStrength, verifySessionToken } from '@/lib/session';
import {
  decidePriceReview, neonReviewDb, parseDecideInput, syncPriceReviewsFromRedis, type DecideResult,
} from '@/lib/price-review-store';

export const dynamic = 'force-dynamic';

async function isAdmin(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!validateSecretStrength(secret)) return false;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return (await verifySessionToken(token, secret)).valid;
}

const STATUS_OF: Record<DecideResult['code'], number> = {
  approved: 200, rejected: 200, invalid_input: 400, not_found: 404,
  already_decided: 409, price_mismatch: 409, expired: 409, stale: 409, conflict: 409,
};

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '42P01' || /relation .*price_review.* does not exist/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`);
}

export async function POST(req: NextRequest) {
  if (!checkCsrfOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ ok: false, code: 'forbidden', message: '不正なOriginです' }, { status: 403 });
  }
  if (!(await isAdmin(req))) {
    return NextResponse.json({ ok: false, code: 'unauthorized', message: '管理者としてログインしてください' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if ((body as { action?: unknown } | null)?.action === 'sync') {
    try {
      const r = await syncPriceReviewsFromRedis(neonReviewDb());
      if (r.error === 'redis_not_configured') return NextResponse.json({ ok: false, code: 'redis_not_configured', message: 'Redis が設定されていないため取り込めません' }, { status: 503 });
      return NextResponse.json({ ok: true, code: 'synced', message: `価格更新の結果を取り込みました（${r.valid}件を確認）`, result: r });
    } catch (err) {
      return failure(err);
    }
  }
  const input = parseDecideInput(body);
  if (!input) {
    return NextResponse.json({ ok: false, code: 'invalid_input', message: '入力が正しくありません（操作者名は50文字以内で入力してください）' }, { status: 400 });
  }
  try {
    // 先に最新の確認待ちを取り込む（同じ商品の新しい変更案があれば古い確認待ちは置き換わり、承認されない）。失敗しても判定は続ける
    await syncPriceReviewsFromRedis(neonReviewDb()).catch(() => null);
    const result = await decidePriceReview(neonReviewDb(), input);
    if (result.code === 'approved') {
      const person = (await neonReviewDb().query(`SELECT person_name FROM price_reviews WHERE id = $1`, [input.id]))[0]?.person_name;
      if (typeof person === 'string') revalidatePath(`/person/${encodeURIComponent(person)}`);
    }
    return NextResponse.json(result, { status: STATUS_OF[result.code] ?? 500 });
  } catch (err) {
    return failure(err);
  }
}

function failure(err: unknown) {
  if (isMissingTable(err)) {
    return NextResponse.json({ ok: false, code: 'table_missing', message: '確認待ちのテーブルが未作成です。/admin/db-init でスキーマ初期化を実行してください' }, { status: 503 });
  }
  // 秘密情報を含みうるエラー文は返さない・出さない（種類とコードだけ）
  const e = err as { name?: string; code?: string } | null;
  console.error('[price-review] failed:', e?.name ?? 'Error', e?.code ?? '');
  return NextResponse.json({ ok: false, code: 'error', message: '処理に失敗しました（トランザクションのため、途中の変更は残っていません）' }, { status: 500 });
}
