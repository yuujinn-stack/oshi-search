import { getAllPersonsMerged } from '@/lib/persons';
import { getAllPersonMetas } from '@/lib/person-meta';
import RakutenSearchClient from './RakutenSearchClient';
import type { PersonOption } from '@/components/admin/PersonCombobox';

export const dynamic = 'force-dynamic';

export default async function RakutenSearchPage() {
  const [persons, metas] = await Promise.all([
    getAllPersonsMerged(),
    getAllPersonMetas(),
  ]);

  const personOptions: PersonOption[] = persons.map((p) => ({
    name: p.name,
    group: p.group || undefined,
    activityStatus: metas[p.name]?.activityStatus,
    generation: metas[p.name]?.generation,
  }));

  // ── DEBUG: generation データの分布をサーバーログに出力 ────────────────────
  const debugGroups = ['乃木坂46', '櫻坂46', '日向坂46'];
  for (const g of debugGroups) {
    const gPersons = personOptions.filter((p) => p.group === g);
    const withGen = gPersons.filter((p) => p.generation);
    const genValues = [...new Set(withGen.map((p) => p.generation))];
    console.log(`[DEBUG generation] ${g}: 人数=${gPersons.length}, generation有=${withGen.length}, 値=[${genValues.join(', ')}]`);
    if (gPersons.length > 0 && withGen.length === 0) {
      // generation がない先頭5人のメタを確認
      for (const p of gPersons.slice(0, 5)) {
        const meta = metas[p.name];
        console.log(`  [DEBUG] ${p.name}: meta=${JSON.stringify(meta ?? null)}`);
      }
    }
  }
  // ── END DEBUG ──────────────────────────────────────────────────────────────

  const groups = [...new Set(persons.map((p) => p.group).filter(Boolean))].sort() as string[];

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
