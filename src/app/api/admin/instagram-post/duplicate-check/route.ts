import { NextRequest, NextResponse } from 'next/server';
import { getInstagramPostHistory } from '@/lib/instagram-post-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('personName')?.trim();
  if (!personName) {
    return NextResponse.json({ error: 'personNameが指定されていません' }, { status: 400 });
  }
  try {
    const history = await getInstagramPostHistory(personName);
    return NextResponse.json({
      alreadyPosted: history.length > 0,
      records: history.map((h) => ({ mediaId: h.mediaId, publishedAt: h.publishedAt })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
