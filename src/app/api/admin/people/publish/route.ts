// インポート済み人物を公開ページに反映する API
// POST: 指定した人物（または未公開全員）を persons:published ハッシュに書き込む
// 書き込み後 revalidatePath でホームページの ISR キャッシュをバスト
// /search / /group / /person は force-dynamic なので revalidatePath 不要

import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  getAllImportedPersons,
  type ImportedPerson,
} from '@/lib/imported-persons';
import {
  publishPersonsBatch,
  unpublishPerson,
  getPublishedPersonNames,
  type PublishedRecord,
} from '@/lib/published-persons';

export const dynamic = 'force-dynamic';

function toPublishedRecord(p: ImportedPerson): PublishedRecord {
  return {
    name:  p.name,
    group: p.group,
    genre: p.genre,
    config: {
      aliases:      p.aliases.length > 0 ? p.aliases : undefined,
      tmdbPersonId: p.tmdbPersonId,
      checkStatus:  'unchecked',
    },
    publishedAt: Date.now(),
  };
}

// ── GET: 公開済み人物名一覧 ──────────────────────────────────────────────────
export async function GET() {
  try {
    const names = await getPublishedPersonNames();
    return NextResponse.json({ names, total: names.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: 公開反映 ────────────────────────────────────────────────────────────
// body: { names?: string[] }   → 指定人物のみ公開
// body: { publishAll?: true }  → imported:persons の全員を公開
// body: { unpublish?: string } → 指定人物を非公開に戻す
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { names, publishAll, unpublish } = body as {
      names?: string[];
      publishAll?: boolean;
      unpublish?: string;
    };

    // ── 非公開化 ─────────────────────────────────────────────────────────────
    if (unpublish) {
      await unpublishPerson(unpublish);
      revalidatePath('/', 'page');
      return NextResponse.json({ ok: true, unpublished: unpublish });
    }

    // ── 対象リスト決定 ────────────────────────────────────────────────────────
    const imported = await getAllImportedPersons();
    let targets: ImportedPerson[];

    if (publishAll) {
      // 未公開のみ対象（既公開は上書きしない）
      const alreadyPublished = new Set(await getPublishedPersonNames());
      targets = imported.filter((p) => !alreadyPublished.has(p.name));
    } else if (names && names.length > 0) {
      const nameSet = new Set(names);
      targets = imported.filter((p) => nameSet.has(p.name));
    } else {
      return NextResponse.json({ error: 'names または publishAll が必要です' }, { status: 400 });
    }

    if (targets.length === 0) {
      return NextResponse.json({ published: [], total: 0, message: '対象なし（既に全員公開済み）' });
    }

    const records = targets.map(toPublishedRecord);
    await publishPersonsBatch(records);

    // ホームページの ISR キャッシュをバスト（force-dynamic なページは不要）
    revalidatePath('/', 'page');

    return NextResponse.json({
      published: records.map((r) => r.name),
      total:     records.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
