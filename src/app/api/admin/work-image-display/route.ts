// 作品画像の表示方式（D-1共通デザイン／従来画像表示）の取得・保存。管理者専用。
// 認証・CSRF（Origin）チェックは src/proxy.ts が /api/admin/* に対して行う（未ログインは 401、
// 書き込みメソッドで Origin が違えば 403）。ここでは値の検証と保存だけを行う。
import { NextResponse } from 'next/server';
import { getWorkImageDisplaySetting, saveWorkImageDisplayMode } from '@/lib/site-settings';
import { isWorkImageDisplayMode, WORK_IMAGE_DISPLAY_MODE_LABEL } from '@/lib/work-image-display';

export const dynamic = 'force-dynamic';

export async function GET() {
  const setting = await getWorkImageDisplaySetting();
  return NextResponse.json(setting);
}

export async function PUT(req: Request) {
  let body: { mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が正しくありません' }, { status: 400 });
  }
  if (!isWorkImageDisplayMode(body.mode)) {
    return NextResponse.json(
      { error: `表示方式は「${WORK_IMAGE_DISPLAY_MODE_LABEL.d1}」「${WORK_IMAGE_DISPLAY_MODE_LABEL.legacy}」のどちらかを選んでください` },
      { status: 400 },
    );
  }
  try {
    const setting = await saveWorkImageDisplayMode(body.mode);
    return NextResponse.json({ ok: true, setting });
  } catch (err) {
    return NextResponse.json({ error: `保存に失敗しました: ${String(err)}` }, { status: 500 });
  }
}
