import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getPersonWithConfig } from '@/lib/persons';
import { getProductsByCategory } from '@/lib/rakuten';
import { getAllVerdicts, saveVerdict } from '@/lib/judgment-store';
import { getRedis } from '@/lib/redis';
import { judgeProducts } from '@/lib/ai-judge';
import { isBorderline } from '@/lib/scoring';
import type { ProductCategory } from '@/types/rakuten';

const CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ'];
const RATE_LIMIT_KEY = (name: string) => `rejudge_last:${name}`;
const RATE_LIMIT_SECONDS = 60; // 同一人物の再判定は60秒に1回まで

// POST /api/admin/rejudge
// body: { personName: string, onlyBorderline?: boolean }
// 管理画面からのみ呼び出し（認証はmiddlewareで済み）
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, onlyBorderline = true } = body as {
    personName?: string;
    onlyBorderline?: boolean;
  };

  if (!personName) return NextResponse.json({ error: 'personName が必要です' }, { status: 400 });

  const person = getPersonWithConfig(personName);
  if (!person) return NextResponse.json({ error: '人物が見つかりません' }, { status: 404 });

  // レート制限: 連打防止
  const redis = getRedis();
  if (redis) {
    const lastRun = await redis.get<number>(RATE_LIMIT_KEY(personName));
    if (lastRun && Date.now() - lastRun < RATE_LIMIT_SECONDS * 1000) {
      const wait = Math.ceil((RATE_LIMIT_SECONDS * 1000 - (Date.now() - lastRun)) / 1000);
      return NextResponse.json(
        { error: `再判定は${wait}秒後に実行できます` },
        { status: 429 }
      );
    }
    await redis.set(RATE_LIMIT_KEY(personName), Date.now(), { ex: RATE_LIMIT_SECONDS });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY が設定されていません' }, { status: 500 });
  }

  // 全カテゴリの商品を取得
  const existingVerdicts = await getAllVerdicts(personName);
  const strictMode = person.config.strictMode ?? false;

  let judged = 0;
  let skipped = 0;

  for (const cat of CATEGORIES) {
    const result = await getProductsByCategory(
      person.name, person.group, cat, person.config, 'no-store'
    );
    if (result.status !== 'ok') continue;

    // 判定対象: 既存判定なし & (onlyBorderline=true なら曖昧なもののみ)
    const targets = result.products.filter((p) => {
      if (existingVerdicts[p.id]) return false; // 判定済みはスキップ
      if (onlyBorderline && !isBorderline(p.relevanceScore, strictMode)) return false;
      return true;
    });

    if (targets.length === 0) continue;

    // OpenAI で判定（最大10件まで）
    const toJudge = targets.slice(0, 10);
    const results = await judgeProducts(
      toJudge.map((p) => ({ id: p.id, title: p.title })),
      person.name,
      person.group,
    );

    for (const { id, result: judgeResult } of results) {
      if (!judgeResult) continue;
      const product = toJudge.find((p) => p.id === id);
      if (!product) continue;
      await saveVerdict(
        personName,
        id,
        judgeResult.verdict,
        product.relevanceScore,
        'ai',
        judgeResult.reason,
      );
      judged++;
    }
    skipped += targets.length - toJudge.length;
  }

  // ISRキャッシュを無効化して次回アクセス時に最新データを表示
  revalidatePath(`/person/${encodeURIComponent(personName)}`);

  return NextResponse.json({ ok: true, judged, skipped });
}
