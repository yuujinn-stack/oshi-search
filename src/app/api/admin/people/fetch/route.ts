// インポート済み人物のデータ取得 API
// 楽天商品（AI判定含む）+ TMDb 出演作品を取得し、status を Redis に書き戻す
// 管理画面 /admin/people/import の「データ取得」ボタンからのみ呼ぶ

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllImportedPersons,
  updateImportedPersonStatus,
  type DataFetchStatus,
} from '@/lib/imported-persons';
import { processPerson } from '@/lib/batch-processor';
import { processPersonWorks } from '@/lib/work-processor';
import type { PersonWithConfig } from '@/types/person';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name } = body as { name?: string };

  if (!name) {
    return NextResponse.json({ error: 'name が必要です' }, { status: 400 });
  }

  const all = await getAllImportedPersons();
  const imported = all.find((p) => p.name === name);
  if (!imported) {
    return NextResponse.json({ error: '登録済み人物が見つかりません' }, { status: 404 });
  }

  // 取得中にステータスを更新（他のリクエストが二重実行しないよう目印）
  await updateImportedPersonStatus(name, 'processing');

  // PersonWithConfig を ImportedPerson から構築
  const personWithConfig: PersonWithConfig = {
    name:  imported.name,
    group: imported.group,
    genre: imported.genre,
    config: {
      aliases:       imported.aliases.length > 0 ? imported.aliases : undefined,
      tmdbPersonId:  imported.tmdbPersonId,
      checkStatus:   'unchecked',
    },
  };

  const errors: string[] = [];
  let successCount = 0;

  // 1. 楽天商品取得 + AI 判定
  try {
    const result = await processPerson(name, false, personWithConfig);
    if (result.error) {
      errors.push(`楽天商品: ${result.error}`);
    } else {
      successCount++;
    }
  } catch (err) {
    errors.push(`楽天商品: ${String(err)}`);
  }

  // 2. TMDb 出演作品取得
  try {
    const result = await processPersonWorks(personWithConfig, { action: 'tmdb', includeVod: false });
    if (result.error) {
      errors.push(`作品情報: ${result.error}`);
    } else {
      successCount++;
    }
  } catch (err) {
    errors.push(`作品情報: ${String(err)}`);
  }

  const finalStatus: DataFetchStatus =
    errors.length === 0 ? 'completed' :
    successCount > 0    ? 'partial_error' :
    'failed';

  const errorMessage = errors.length > 0 ? errors.join(' / ') : undefined;
  await updateImportedPersonStatus(name, finalStatus, errorMessage);

  return NextResponse.json({
    ok:     finalStatus === 'completed',
    status: finalStatus,
    error:  errorMessage,
  });
}
