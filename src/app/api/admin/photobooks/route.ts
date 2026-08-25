import { NextResponse } from 'next/server';
import { getAdminPhotobookRows } from '@/lib/photobook-store';

// GET /api/admin/photobooks — 写真集管理画面の一覧データ（重複統合前・非公開/除外も含む全件）
export async function GET() {
  try {
    const rows = await getAdminPhotobookRows();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
