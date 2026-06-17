import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getAllWorks, saveWork } from '@/lib/work-store';
import { deduplicateProviders, hasDuplicateProviders } from '@/lib/vod-dedup';

// POST /api/admin/vod-dedup
// body: { personName?: string }  personName 省略 = 全人物対象
// 管理画面からのみ呼び出し可（proxy.ts で認証済み）
//
// 同じ workId + providerName（正規化後）が複数存在する場合、
// 優先順位（TMDb > AI Web検索 > AI補完 > 手動 > CSV）の高いものを1件残し、
// 残りを削除して保存する。

export async function POST(req: NextRequest) {
  const { personName: filterPerson = '' } = await req.json().catch(() => ({}));

  const allPersons = getAllPersonsWithConfig();
  const targets = filterPerson
    ? allPersons.filter((p) => p.name === filterPerson)
    : allPersons;

  let checkedWorks = 0;
  let deduplicatedWorks = 0;
  let removedCount = 0;

  for (const person of targets) {
    const works = await getAllWorks(person.name);
    for (const work of works) {
      const providers = work.vodProviders ?? [];
      if (providers.length === 0) continue;
      if (!hasDuplicateProviders(providers)) {
        checkedWorks++;
        continue;
      }

      const deduped = deduplicateProviders(providers);
      const removed = providers.length - deduped.length;
      checkedWorks++;

      if (removed > 0) {
        await saveWork({
          ...work,
          vodProviders: deduped,
          updatedAt: Date.now(),
        });
        deduplicatedWorks++;
        removedCount += removed;
      }
    }
  }

  console.log('[vod-dedup]', {
    targetPerson: filterPerson || '全人物',
    checkedWorks,
    deduplicatedWorks,
    removedCount,
  });

  return NextResponse.json({ checkedWorks, deduplicatedWorks, removedCount });
}
