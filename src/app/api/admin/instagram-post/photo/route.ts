import { NextRequest, NextResponse } from 'next/server';
import { findExistingPersonPhoto, uploadPersonPhoto } from '@/server/instagram-post/blob';
import { detectImageMimeType } from '@/server/instagram-post/mime-detect';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('personName')?.trim();
  if (!personName) {
    return NextResponse.json({ error: 'personNameが指定されていません' }, { status: 400 });
  }
  try {
    const photoUrl = await findExistingPersonPhoto(personName);
    return NextResponse.json({ photoUrl });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: '画像アップロードのリクエスト形式が不正です' }, { status: 400 });
  }

  const personName = formData.get('personName');
  const file = formData.get('file');

  if (typeof personName !== 'string' || !personName.trim()) {
    return NextResponse.json({ error: 'personNameが指定されていません' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '画像ファイルが指定されていません' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: '画像ファイルが大きすぎます（10MBまで）' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: '画像ファイルを選択してください' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = detectImageMimeType(buffer);
    const photoUrl = await uploadPersonPhoto(personName.trim(), buffer, contentType);
    return NextResponse.json({ photoUrl });
  } catch (err) {
    return NextResponse.json(
      { error: `人物写真のアップロードに失敗しました: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
