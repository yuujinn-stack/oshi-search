import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import RakutenSearchClient from './RakutenSearchClient';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { createGroupList } from './group-utils';

export const dynamic = 'force-dynamic';

export default async function RakutenSearchPage() {
  const [persons, metas] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
  ]);

  // ── [DIAG-1] getAllPersonsMerged の生データ確認 ───────────────────────────
  console.log('[DIAG-1] getAllPersonsMerged 件数:', persons.length);
  console.log('[DIAG-1] 日向坂46 raw (group フィールド):', persons.filter(p => p.group === '日向坂46').map(p => p.name));
  console.log('[DIAG-1] 櫻坂46 raw (group フィールド):', persons.filter(p => p.group === '櫻坂46').map(p => p.name));
  console.log('[DIAG-1] 全 group 値一覧:', [...new Set(persons.map(p => p.group))].sort());

  // ── [DIAG-2] Redis PersonMeta の currentGroupName 確認 ─────────────────
  const hinaMembers = persons.filter(p => p.group === '日向坂46').map(p => p.name);
  const sakuraMembers = persons.filter(p => p.group === '櫻坂46').map(p => p.name);
  console.log('[DIAG-2] 日向坂46メンバーのmeta:', hinaMembers.map(n => ({
    name: n,
    meta_currentGroupName: metas[n]?.currentGroupName ?? '(未設定)',
    meta_activityStatus: metas[n]?.activityStatus ?? '(未設定)',
  })));
  console.log('[DIAG-2] 櫻坂46メンバーのmeta:', sakuraMembers.map(n => ({
    name: n,
    meta_currentGroupName: metas[n]?.currentGroupName ?? '(未設定)',
    meta_activityStatus: metas[n]?.activityStatus ?? '(未設定)',
  })));

  const personOptions: PersonOption[] = persons.map((p) => ({
    name: p.name,
    group: p.group || undefined,
    currentGroupName: metas[p.name]?.currentGroupName || undefined,
    activityStatus: metas[p.name]?.activityStatus,
    generation: metas[p.name]?.generation,
  }));

  // ── [DIAG-3] PersonOption マッピング後の値確認 ──────────────────────────
  console.log('[DIAG-3] personOptions 件数:', personOptions.length);
  console.log('[DIAG-3] 日向坂46 PersonOption サンプル (group/currentGroupName):',
    personOptions.filter(p => p.group === '日向坂46').map(p => ({
      name: p.name, group: p.group, currentGroupName: p.currentGroupName,
    }))
  );
  console.log('[DIAG-3] 櫻坂46 PersonOption サンプル (group/currentGroupName):',
    personOptions.filter(p => p.group === '櫻坂46').map(p => ({
      name: p.name, group: p.group, currentGroupName: p.currentGroupName,
    }))
  );
  console.log('[DIAG-3] 先頭5件の PersonOption (全フィールド):',
    personOptions.slice(0, 5).map(p => ({ name: p.name, group: p.group, currentGroupName: p.currentGroupName }))
  );

  // ── [DIAG-4] createGroupList の戻り値 ────────────────────────────────────
  const groups = createGroupList(personOptions);
  console.log('[DIAG-4] createGroupList 戻り値:', groups);
  console.log('[DIAG-4] getEffectiveGroup で group が空になる人物:',
    personOptions.filter(p => !(p.currentGroupName ?? p.group)).map(p => ({ name: p.name, group: p.group, currentGroupName: p.currentGroupName }))
  );

  const metaMap: Record<string, { joinedAt?: string; leftAt?: string; activityStatus?: string }> = {};
  for (const [name, meta] of Object.entries(metas)) {
    metaMap[name] = { joinedAt: meta.joinedAt, leftAt: meta.leftAt, activityStatus: meta.activityStatus };
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800">楽天商品検索</h1>
          <p className="text-sm text-gray-500 mt-1">キーワード検索して複数人物に商品を一括追加</p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/product-check" className="text-indigo-600 hover:underline">商品確認 →</a>
          <a href="/admin/work-check" className="text-gray-400 hover:underline">作品管理</a>
          <a href="/admin/people-progress" className="text-gray-400 hover:underline">人物進捗</a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">ログアウト</a>
        </div>
      </div>
      <RakutenSearchClient persons={personOptions} groups={groups} metaMap={metaMap} />
    </div>
  );
}
