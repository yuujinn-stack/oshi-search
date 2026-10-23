import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { getFirst3ManualCandidates } from '@/server/video-jobs/first3-source';

export const dynamic = 'force-dynamic';

/**
 * まず見る3作: 「1作品だけ変更 → 候補から手動選択」の候補（読み取りのみ）。
 *   ?personName=○○ → 人物ページの「出演作品」のうちドラマ・映画（作品名・公開年・種別・見放題の配信先）
 */
export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('personName')?.trim();
  if (!personName) return NextResponse.json({ error: '人物を指定してください。' }, { status: 400 });
  try {
    const result = await getFirst3ManualCandidates(personName);
    if (!result) return NextResponse.json({ error: `推しサーチに登録されていない人物です: ${personName}` }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
