import { NextRequest, NextResponse } from 'next/server';
import { getPersonWithConfig } from '@/lib/persons';
import { judgeWork } from '@/lib/work-processor';
import type { TmdbWorkCandidate } from '@/lib/tmdb';

// POST /api/admin/work-test
// body: { personName, work: TmdbWorkCandidate }
// 単一作品に対してAI判定テストを実行し、入力・出力を詳細に返す（保存なし）
// 管理画面のデバッグ用途のみ
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, work } = body as {
    personName?: string;
    work?: TmdbWorkCandidate;
  };

  if (!personName || !work) {
    return NextResponse.json({ error: 'personName, work が必要です' }, { status: 400 });
  }

  const person = getPersonWithConfig(personName);
  if (!person) {
    return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });
  }

  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const result = await judgeWork(work, person);

  return NextResponse.json({
    personName,
    work: {
      title: work.title,
      type: work.type,
      tmdbId: work.tmdbId,
      releaseYear: work.releaseYear,
      roleName: work.roleName,
      voteCount: work.voteCount,
    },
    openAiConfigured: hasOpenAI,
    judgment: {
      usedAi: result.usedAi,
      confidenceScore: result.score,
      status: result.score >= 90 ? 'auto_published' : result.score >= 70 ? 'needs_review' : 'hidden',
      relation: result.relation,
      statusRecommendation: result.statusRecommendation,
      reason: result.reason,
      needsHumanReview: result.needsHumanReview,
    },
  });
}
