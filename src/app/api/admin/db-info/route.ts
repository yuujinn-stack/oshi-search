// DB接続確認（認証済み管理者専用）
// 接続先を区別するための最小限の情報のみ返す。接続文字列・ユーザー名・ホスト名は返さない。
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL が未設定です' }, { status: 500 });
  }

  try {
    await db.execute(sql`SELECT 1`);
    const vercelEnv = process.env.VERCEL_ENV ?? 'development';
    return NextResponse.json({ connected: true, vercelEnv });
  } catch {
    return NextResponse.json({ error: 'データベース接続に失敗しました' }, { status: 500 });
  }
}
