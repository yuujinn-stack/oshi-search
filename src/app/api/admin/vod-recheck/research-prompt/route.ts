// POST /api/admin/vod-recheck/research-prompt
// /admin/vod-recheck で選択した作品から、ChatGPTへ配信状況調査を依頼するプロンプト全文を生成する。
//
// データ解決は /api/admin/vod-recheck/csv-export と全く同じ resolveVodRecheckExportData() を
// 再利用する（canonical workId解決・非活性化作品の除外・unknown/終了済みサービス[dTV等]の除外は共通）。
// プロンプトのテンプレート（調査依頼文・調査条件・対象サービス一覧・availabilityType一覧・出力形式・
// 「作品CSVここから/ここまで」区切り）自体も src/lib/vod-research-prompt.ts を再利用し、
// work-check の ChatGPT調査プロンプト生成と二重実装しない。
//
// body: { items: Array<{ personName: string; workId: string }> }  最大 MAX_ITEMS 件
// （/admin/vod-recheck の選択上限50件と一致させる）
import { NextRequest, NextResponse } from 'next/server';
import { resolveVodRecheckExportData, type VodRecheckExportItem } from '@/lib/vod-recheck-export-data';
import { buildChatgptFullSyncCsvRow, buildChatgptFullSyncPrompt, CHATGPT_FULL_SYNC_CSV_HEADER } from '@/lib/vod-research-prompt';
import { getAllPersonsMerged } from '@/lib/persons';

export const dynamic = 'force-dynamic';

// /admin/vod-recheck の運用方針（ChatGPT完全調査 → 完全同期）に合わせ、1回のプロンプトに
// 含める作品数の上限を14サービス完全調査を前提とした40件に統一する。
const MAX_ITEMS = 40;

function isExportItem(v: unknown): v is VodRecheckExportItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.personName === 'string' && typeof o.workId === 'string' && o.workId.trim() !== '';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { items?: unknown };
  const { items } = body;

  if (!Array.isArray(items) || items.length === 0 || !items.every(isExportItem)) {
    return NextResponse.json({ error: 'items は { personName, workId } の配列である必要があります' }, { status: 400 });
  }
  if (items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `一度にプロンプト生成できるのは最大 ${MAX_ITEMS} 件です` }, { status: 400 });
  }

  try {
    const { rows, unresolvedWorkIds } = await resolveVodRecheckExportData(items as VodRecheckExportItem[]);

    if (rows.length === 0) {
      return NextResponse.json({
        error: '対象の作品が見つかりません（非公開・削除済み、または存在しないworkIdです）',
        unresolvedWorkIds,
      }, { status: 400 });
    }

    // groupNameは同名人物・同名作品の判別を助ける補助情報としてのみプロンプトへ渡す
    // （グループ一致だけで作品を確定させる目的ではない。既存の安全策と同じ考え方）。
    const persons = await getAllPersonsMerged();
    const groupByName = new Map(persons.map((p) => [p.name, p.group]));

    const csvBody = [
      CHATGPT_FULL_SYNC_CSV_HEADER,
      ...rows.map((r) => buildChatgptFullSyncCsvRow({ ...r, groupName: groupByName.get(r.personName) ?? '' })),
    ].join('\n');
    const workCount = new Set(rows.map((r) => r.workId)).size;
    const workIds = [...new Set(rows.map((r) => r.workId))];
    const prompt = buildChatgptFullSyncPrompt(csvBody, 'vod-recheck');

    return NextResponse.json({ prompt, workCount, workIds, unresolvedWorkIds });
  } catch (err) {
    console.error('[vod-recheck/research-prompt] error:', err);
    return NextResponse.json({ error: 'プロンプト生成に失敗しました' }, { status: 500 });
  }
}
