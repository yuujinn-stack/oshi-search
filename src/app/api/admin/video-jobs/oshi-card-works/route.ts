import { NextRequest, NextResponse } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { loadOshiCardPerson } from '@/lib/oshi-card/data';

export const dynamic = 'force-dynamic';

/**
 * 動画「推し布教カード紹介」: 人物の作品候補（読み取りのみ）。
 *   ?personName=○○ → 推し布教カード（/oshi-card）と同じ候補（その人物の公開作品・公開日の新しい順）とグループ名
 */
export async function GET(req: NextRequest) {
  const personName = req.nextUrl.searchParams.get('personName')?.trim();
  if (!personName) return NextResponse.json({ error: '人物を指定してください。' }, { status: 400 });
  try {
    const person = await loadOshiCardPerson(personName);
    if (!person) return NextResponse.json({ error: `推し布教カードで選べない人物です: ${personName}` }, { status: 404 });
    return NextResponse.json({
      name: person.name,
      group: person.group,
      works: person.candidates.map((w) => ({ id: w.id, title: w.title, typeLabel: w.typeLabel, year: w.year })),
    });
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
