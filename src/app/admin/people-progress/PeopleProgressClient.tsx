'use client';

import { useMemo, useState } from 'react';
import type { PersonProgress } from './page';

const STATUS_LABEL: Record<string, string> = {
  not_started: '未取得',
  queued: '待機中',
  processing: '取得中',
  completed: '完了',
  partial_error: '一部失敗',
  failed: '失敗',
};

const STATUS_COLOR: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  queued: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  partial_error: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
};

function fmtDate(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export default function PeopleProgressClient({ data }: { data: PersonProgress[] }) {
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [sort, setSort] = useState('importedAt_desc');

  const groups = useMemo(
    () => Array.from(new Set(data.map((p) => p.group))).sort(),
    [data],
  );
  const genres = useMemo(
    () => Array.from(new Set(data.map((p) => p.genre))).sort(),
    [data],
  );

  const filtered = useMemo(() => {
    let list = data;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          p.aliases.some((a) => a.toLowerCase().includes(q)),
      );
    }

    if (groupFilter) list = list.filter((p) => p.group === groupFilter);
    if (genreFilter) list = list.filter((p) => p.genre === genreFilter);

    return [...list].sort((a, b) => {
      switch (sort) {
        case 'importedAt_asc':
          return a.importedAt - b.importedAt;
        case 'totalWorks':
          return b.totalWorks - a.totalWorks;
        case 'totalProducts':
          return b.totalProducts - a.totalProducts;
        case 'name':
          return a.name.localeCompare(b.name, 'ja');
        default:
          return b.importedAt - a.importedAt;
      }
    });
  }, [data, search, groupFilter, genreFilter, sort]);

  const totals = useMemo(
    () => ({
      persons: filtered.length,
      works: filtered.reduce((s, p) => s + p.totalWorks, 0),
      published: filtered.reduce((s, p) => s + p.publishedWorks, 0),
      review: filtered.reduce((s, p) => s + p.reviewWorks, 0),
      hidden: filtered.reduce((s, p) => s + p.hiddenWorks, 0),
      vod: filtered.reduce((s, p) => s + p.vodWorks, 0),
      products: filtered.reduce((s, p) => s + p.totalProducts, 0),
      csv: filtered.reduce((s, p) => s + p.csvWorks, 0),
      ai: filtered.reduce((s, p) => s + p.aiWorks, 0),
    }),
    [filtered],
  );

  return (
    <div>
      {/* 検索・フィルター */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前・グループ・別名で検索"
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          <option value="">全グループ</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setGenreFilter('')}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              genreFilter === ''
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            全ジャンル
          </button>
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setGenreFilter(genreFilter === g ? '' : g)}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                genreFilter === g
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 ml-auto"
        >
          <option value="importedAt_desc">追加日（新順）</option>
          <option value="importedAt_asc">追加日（旧順）</option>
          <option value="totalWorks">作品数順</option>
          <option value="totalProducts">商品数順</option>
          <option value="name">名前順</option>
        </select>
      </div>

      {/* 集計サマリー */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-4 bg-gray-50 rounded-lg px-4 py-2.5">
        <span className="font-semibold text-slate-700">{totals.persons}人</span>
        <span>
          作品{totals.works}件{' '}
          <span className="text-green-600">公開{totals.published}</span>{' '}
          <span className="text-yellow-600">確認{totals.review}</span>{' '}
          <span className="text-gray-400">非表示{totals.hidden}</span>
        </span>
        <span>配信あり {totals.vod}件</span>
        <span>商品 {totals.products}件</span>
        {totals.ai > 0 && <span>AI補完 {totals.ai}件</span>}
        {totals.csv > 0 && <span>CSV {totals.csv}件</span>}
      </div>

      {/* テーブル */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 font-semibold">
              <th className="text-left px-4 py-3 whitespace-nowrap">人物名 / グループ</th>
              <th className="text-left px-3 py-3 whitespace-nowrap">ジャンル</th>
              <th className="text-left px-3 py-3 whitespace-nowrap">取得状態</th>
              <th className="text-left px-3 py-3 whitespace-nowrap">追加日</th>
              <th className="text-right px-3 py-3 whitespace-nowrap">作品<br /><span className="font-normal text-gray-400">公/確/非</span></th>
              <th className="text-right px-3 py-3 whitespace-nowrap">配信</th>
              <th className="text-right px-3 py-3 whitespace-nowrap">商品</th>
              <th className="text-right px-3 py-3 whitespace-nowrap">AI補完</th>
              <th className="text-right px-3 py-3 whitespace-nowrap">CSV</th>
              <th className="text-left px-3 py-3 whitespace-nowrap">最終更新</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-12 text-gray-400 text-sm">
                  条件に一致する人物がいません
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.name} className="hover:bg-gray-50 transition-colors">
                {/* 人物名 / グループ */}
                <td className="px-4 py-3">
                  <a
                    href={`/admin/work-check?person=${encodeURIComponent(p.name)}`}
                    className="font-semibold text-slate-800 hover:text-indigo-600 transition-colors"
                  >
                    {p.name}
                  </a>
                  {p.aliases.length > 0 && (
                    <div className="text-xs text-gray-400 mt-0.5 truncate max-w-[160px]">
                      {p.aliases.join(' / ')}
                    </div>
                  )}
                  <div className="text-xs text-gray-500 mt-0.5">{p.group}</div>
                </td>

                {/* ジャンル */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                    {p.genre}
                  </span>
                </td>

                {/* 取得状態 */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      STATUS_COLOR[p.dataFetchStatus] ?? 'bg-gray-100 text-gray-500'
                    }`}
                    title={p.errorMessage ?? undefined}
                  >
                    {STATUS_LABEL[p.dataFetchStatus] ?? p.dataFetchStatus}
                  </span>
                  {p.lastDataFetchedAt && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {fmtDate(p.lastDataFetchedAt)}
                    </div>
                  )}
                </td>

                {/* 追加日 */}
                <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                  {fmtDate(p.importedAt)}
                </td>

                {/* 作品 (合計 / 公開/確認/非表示) */}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <span className="font-semibold text-slate-700">{p.totalWorks}</span>
                  <div className="text-xs mt-0.5 space-x-1">
                    <span className="text-green-600">{p.publishedWorks}</span>
                    <span className="text-gray-300">/</span>
                    <span className="text-yellow-600">{p.reviewWorks}</span>
                    <span className="text-gray-300">/</span>
                    <span className="text-gray-400">{p.hiddenWorks}</span>
                  </div>
                </td>

                {/* 配信あり */}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {p.vodWorks > 0 ? (
                    <span className="text-teal-600 font-medium">{p.vodWorks}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                {/* 商品数 */}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {p.totalProducts > 0 ? (
                    <span className="text-slate-700 font-medium">{p.totalProducts}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                {/* AI補完 */}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {p.aiWorks > 0 ? (
                    <span className="text-purple-600">{p.aiWorks}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                {/* CSV */}
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  {p.csvWorks > 0 ? (
                    <span className="text-blue-600">{p.csvWorks}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>

                {/* 最終更新 */}
                <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-400">
                  {fmtDate(p.lastUpdatedAt)}
                </td>

                {/* リンク */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex gap-2">
                    <a
                      href={`/admin/work-check?person=${encodeURIComponent(p.name)}`}
                      className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline"
                    >
                      作品
                    </a>
                    <a
                      href={`/admin/people/import`}
                      className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
                    >
                      登録
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-gray-400 mt-3 text-right">{filtered.length}件表示</p>
      )}
    </div>
  );
}
