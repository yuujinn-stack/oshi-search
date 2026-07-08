// DB接続先の識別情報を返す（値は非公開、識別のみ）
// Preview vs Production が同じ Neon DB を向いているかを判定するために使う
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

function maskUrl(url: string | undefined): string {
  if (!url) return '(not set)';
  // postgresql://user:pass@host/dbname?options → user@host の形式で返す（認証情報除去）
  try {
    const u = new URL(url);
    return `${u.username ? u.username + '@' : ''}${u.hostname}${u.pathname}`;
  } catch {
    // URL パースに失敗した場合は先頭10文字+末尾4文字のみ
    return url.slice(0, 10) + '...' + url.slice(-4);
  }
}

export async function GET() {
  const urlHint = maskUrl(process.env.DATABASE_URL);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'DATABASE_URL not set', urlHint });
  }

  try {
    const result = await db.execute(sql`SELECT current_database() AS db_name`);
    const rows = result as unknown as Array<{ db_name: string }>;
    const dbName = rows[0]?.db_name ?? '(unknown)';

    const vercelEnv = process.env.VERCEL_ENV ?? 'development';
    return NextResponse.json({ dbName, urlHint, vercelEnv });
  } catch (err) {
    const vercelEnv = process.env.VERCEL_ENV ?? 'development';
    return NextResponse.json({ error: String(err), urlHint, vercelEnv }, { status: 500 });
  }
}
