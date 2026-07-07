import { NextResponse } from 'next/server';
import { compareRedisAndDB } from '@/lib/db-compare';

export const dynamic = 'force-dynamic';

export async function GET() {
  const result = await compareRedisAndDB();
  return NextResponse.json(result);
}
