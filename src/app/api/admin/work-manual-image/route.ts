import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getWork, setManualImageUrl } from '@/lib/work-store';
import { isValidImageUrl, isPlausibleImageUrl } from '@/lib/work-image';

// PATCH /api/admin/work-manual-image
// body: { personName, workId, imageUrl }
//
// 管理者が作品に直接「この画像を使う」と指定する機能。既存のOG自動取得（サイトを
// 再クロールしてog:image等を探す）とは異なり、入力されたURLをそのまま manualImageUrl
// として保存し、表示優先順位1位（TMDb画像・自動取得OG画像より常に優先）で使用する。
//
// imageUrl が空文字/未指定の場合は手動画像を解除し、TMDb画像・自動取得OG画像へ戻す。
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, imageUrl } = body as {
    personName?: string;
    workId?: string;
    imageUrl?: string;
  };

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName, workId が必要です' }, { status: 400 });
  }

  const trimmed = (imageUrl ?? '').trim();

  if (trimmed && !isValidImageUrl(trimmed)) {
    return NextResponse.json(
      { error: '画像URLの形式が正しくありません（http:// または https:// で始まるURLを入力してください）' },
      { status: 400 },
    );
  }

  // Google/Bing の検索結果ページURL（例: 画像検索結果を右クリック→「画像アドレスをコピー」で
  // 誤ってコピーされがちな /imgres?... 形式）は画像そのものではないため保存前に弾く。
  if (trimmed && !isPlausibleImageUrl(trimmed)) {
    return NextResponse.json(
      { error: 'これは画像ページ（検索結果ページなど）のURLで、画像そのものではありません。画像を右クリックして「画像アドレスをコピー」で取得した直接のURLを入力してください。' },
      { status: 400 },
    );
  }

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

  const ok = await setManualImageUrl(personName, workId, trimmed || null);
  if (!ok) {
    return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 });
  }

  revalidatePath(`/work/${encodeURIComponent(workId)}`);
  revalidatePath(`/person/${encodeURIComponent(personName)}`);

  const updated = await getWork(personName, workId);
  return NextResponse.json({ ok: true, manualImageUrl: updated?.manualImageUrl ?? null, work: updated });
}
