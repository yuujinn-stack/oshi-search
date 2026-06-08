import { getAllPersonsWithConfig } from '@/lib/persons';
import PersonProducts from './PersonProducts';

export const dynamic = 'force-dynamic'; // 常に最新の人物リストを表示

const STATUS_BADGE: Record<string, string> = {
  ok: 'bg-green-100 text-green-700',
  needs_fix: 'bg-red-100 text-red-700',
  unchecked: 'bg-gray-100 text-gray-500',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  needs_fix: '要修正',
  unchecked: '未確認',
};

export default function AdminProductCheckPage() {
  const persons = getAllPersonsWithConfig();

  // checkStatus でグループ分け（needs_fix → unchecked → ok の順）
  const sorted = [...persons].sort((a, b) => {
    const order: Record<string, number> = { needs_fix: 0, unchecked: 1, ok: 2 };
    const sa = order[a.config.checkStatus ?? 'unchecked'] ?? 1;
    const sb = order[b.config.checkStatus ?? 'unchecked'] ?? 1;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, 'ja');
  });

  const groups = {
    needs_fix: sorted.filter((p) => p.config.checkStatus === 'needs_fix'),
    unchecked: sorted.filter((p) => !p.config.checkStatus || p.config.checkStatus === 'unchecked'),
    ok: sorted.filter((p) => p.config.checkStatus === 'ok'),
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-slate-800">商品確認 管理画面</h1>
          <p className="text-sm text-gray-500 mt-1">
            全{persons.length}件 — 人物名をクリックして商品を確認
          </p>
        </div>
        <a
          href="/api/admin/logout"
          className="text-sm text-gray-500 hover:text-red-500 transition-colors"
        >
          ログアウト
        </a>
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-3 mb-6 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
          スコア≥閾値 → 表示（ルールベース）
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          スコア0〜閾値 → AI判定推奨
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
          スコア＜0 → 除外キーワード一致
        </div>
      </div>

      {/* 要修正 */}
      {groups.needs_fix.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-red-700 mb-3 flex items-center gap-2">
            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full">要修正</span>
            {groups.needs_fix.length}件
          </h2>
          <div className="space-y-2">
            {groups.needs_fix.map((p) => (
              <PersonRow key={p.name} person={p} />
            ))}
          </div>
        </section>
      )}

      {/* 未確認 */}
      {groups.unchecked.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-gray-600 mb-3 flex items-center gap-2">
            <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">未確認</span>
            {groups.unchecked.length}件
          </h2>
          <div className="space-y-2">
            {groups.unchecked.map((p) => (
              <PersonRow key={p.name} person={p} />
            ))}
          </div>
        </section>
      )}

      {/* 確認済み */}
      {groups.ok.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-bold text-green-700 mb-3 flex items-center gap-2">
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">確認済み</span>
            {groups.ok.length}件
          </h2>
          <div className="space-y-2">
            {groups.ok.map((p) => (
              <PersonRow key={p.name} person={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PersonRow({
  person,
}: {
  person: ReturnType<typeof getAllPersonsWithConfig>[number];
}) {
  const status = person.config.checkStatus ?? 'unchecked';
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-t-xl border border-b-0 border-gray-200">
        <span className="font-medium text-slate-800 text-sm">{person.name}</span>
        {person.group && <span className="text-xs text-gray-500">{person.group}</span>}
        <span className={`text-xs px-2 py-0.5 rounded-full ml-auto ${STATUS_BADGE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        {person.config.strictMode && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            strictMode
          </span>
        )}
        {person.config.customKeywords && person.config.customKeywords.length > 0 && (
          <span className="text-xs text-indigo-500">
            +{person.config.customKeywords.join(', ')}
          </span>
        )}
      </div>
      <PersonProducts personName={person.name} />
    </div>
  );
}
