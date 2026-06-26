'use client';

import { useState, useMemo } from 'react';
import type {
  AnalyticsData, PersonViewData, GroupViewData,
  SearchRankData, ProductClickData, WorkClickData, VodClickData,
} from '@/app/api/admin/analytics/route';

// ─── 定数 ──────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

type Tab = '概要' | '人気人物' | '人気グループ' | '人気検索' | '人気商品' | '人気作品' | '人気VOD';
const TABS: Tab[] = ['概要', '人気人物', '人気グループ', '人気検索', '人気商品', '人気作品', '人気VOD'];

// ─── フォーマット ──────────────────────────────────────────────────────────────
function fmtNum(n: number) { return n.toLocaleString('ja-JP'); }
function fmtDate(ts: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
function pct(n: number, total: number) {
  if (!total) return '0.0%';
  return (n / total * 100).toFixed(1) + '%';
}

// ─── 共通テーブルラッパー ──────────────────────────────────────────────────────
function TableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 shadow-sm">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap border-b border-gray-200 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
function Td({ children, right, muted }: { children: React.ReactNode; right?: boolean; muted?: boolean }) {
  return (
    <td className={`px-4 py-2.5 border-b border-gray-100 align-middle ${right ? 'text-right' : ''} ${muted ? 'text-gray-400' : 'text-slate-700'}`}>
      {children}
    </td>
  );
}

// ─── ページネーション ──────────────────────────────────────────────────────────
function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-3 px-1">
      <span className="text-xs text-gray-400">{total.toLocaleString()} 件中 {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} 件</span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="px-2.5 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
        >
          ←
        </button>
        {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
          const p = i + Math.max(1, page - 3);
          if (p > pages) return null;
          return (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${p === page ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              {p}
            </button>
          );
        })}
        <button
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          className="px-2.5 py-1 text-xs rounded border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
        >
          →
        </button>
      </div>
    </div>
  );
}

// ─── タブ別テーブル ────────────────────────────────────────────────────────────
function PersonTable({ data }: { data: PersonViewData[] }) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr>
            <Th>順位</Th><Th>人物名</Th><Th>グループ</Th>
            <Th right>閲覧数</Th><Th right>商品クリック</Th><Th>最終閲覧</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.name} className="hover:bg-gray-50 transition-colors">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td>
                <a href={`/person/${encodeURIComponent(p.name)}`} target="_blank" rel="noreferrer"
                  className="text-indigo-600 hover:underline font-medium">
                  {p.name}
                </a>
              </Td>
              <Td muted>{p.group || '—'}</Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(p.count)}</span></Td>
              <Td right>{p.productClicks > 0 ? fmtNum(p.productClicks) : <span className="text-gray-300">0</span>}</Td>
              <Td muted>{fmtDate(p.lastViewedAt)}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

function GroupTable({ data }: { data: GroupViewData[] }) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr><Th>順位</Th><Th>グループ名</Th><Th right>閲覧数</Th><Th>最終閲覧</Th></tr>
        </thead>
        <tbody>
          {rows.map((g, i) => (
            <tr key={g.groupName} className="hover:bg-gray-50">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td>
                <a href={`/group/${encodeURIComponent(g.groupName)}`} target="_blank" rel="noreferrer"
                  className="text-indigo-600 hover:underline font-medium">
                  {g.groupName}
                </a>
              </Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(g.count)}</span></Td>
              <Td muted>{fmtDate(g.lastViewedAt)}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

function SearchTable({ data }: { data: SearchRankData[] }) {
  const [page, setPage] = useState(1);
  const total = useMemo(() => data.reduce((s, r) => s + r.count, 0), [data]);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr><Th>順位</Th><Th>検索ワード</Th><Th right>検索回数</Th><Th right>検索率</Th></tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={s.keyword} className="hover:bg-gray-50">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td>
                <a href={`/search?q=${encodeURIComponent(s.keyword)}`} target="_blank" rel="noreferrer"
                  className="text-indigo-600 hover:underline font-medium">
                  {s.keyword}
                </a>
              </Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(s.count)}</span></Td>
              <Td right muted>{pct(s.count, total)}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

function ProductTable({ data }: { data: ProductClickData[] }) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr><Th>順位</Th><Th>商品名</Th><Th>人物</Th><Th>カテゴリ</Th><Th right>クリック数</Th></tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.productId} className="hover:bg-gray-50">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td>
                <span className="text-xs text-slate-700 line-clamp-2">{p.title}</span>
              </Td>
              <Td muted>
                {p.personSlug ? (
                  <a href={`/person/${encodeURIComponent(p.personSlug)}`} target="_blank" rel="noreferrer"
                    className="text-indigo-600 hover:underline">
                    {p.personSlug}
                  </a>
                ) : '—'}
              </Td>
              <Td muted>{p.category || '—'}</Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(p.count)}</span></Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

function WorkTable({ data }: { data: WorkClickData[] }) {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr><Th>順位</Th><Th>作品名</Th><Th>人物</Th><Th>種別</Th><Th right>クリック数</Th></tr>
        </thead>
        <tbody>
          {rows.map((w, i) => (
            <tr key={w.workId} className="hover:bg-gray-50">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td><span className="text-xs text-slate-700 line-clamp-2">{w.title}</span></Td>
              <Td muted>
                {w.personName ? (
                  <a href={`/person/${encodeURIComponent(w.personName)}`} target="_blank" rel="noreferrer"
                    className="text-indigo-600 hover:underline">
                    {w.personName}
                  </a>
                ) : '—'}
              </Td>
              <Td muted>{w.workType || '—'}</Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(w.count)}</span></Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

function VodTable({ data }: { data: VodClickData[] }) {
  const [page, setPage] = useState(1);
  const total = useMemo(() => data.reduce((s, v) => s + v.count, 0), [data]);
  const rows = useMemo(() => data.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [data, page]);
  return (
    <>
      <TableWrapper>
        <thead>
          <tr><Th>順位</Th><Th>サービス名</Th><Th right>クリック数</Th><Th right>利用率</Th></tr>
        </thead>
        <tbody>
          {rows.map((v, i) => (
            <tr key={v.service} className="hover:bg-gray-50">
              <Td muted>{(page - 1) * PAGE_SIZE + i + 1}</Td>
              <Td><span className="font-medium text-slate-700">{v.service}</span></Td>
              <Td right><span className="font-bold text-slate-800">{fmtNum(v.count)}</span></Td>
              <Td right muted>{pct(v.count, total)}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">データなし</td></tr>
          )}
        </tbody>
      </TableWrapper>
      <Pagination page={page} total={data.length} onChange={setPage} />
    </>
  );
}

// ─── サマリーカード ────────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-1 shadow-sm ${color}`}>
      <span className="text-xl">{icon}</span>
      <p className="text-xs font-semibold text-gray-500 mt-1">{label}</p>
      <p className="text-3xl font-black text-slate-800 tabular-nums">{fmtNum(value)}</p>
    </div>
  );
}

// ─── 概要タブ ──────────────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: AnalyticsData }) {
  const { summary, persons, groups, searches, products, works, vods } = data;
  return (
    <div className="space-y-8">
      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <SummaryCard icon="👤" label="人物閲覧" value={summary.totalPersonViews} color="bg-indigo-50 border-indigo-100" />
        <SummaryCard icon="🏷" label="グループ閲覧" value={summary.totalGroupViews} color="bg-purple-50 border-purple-100" />
        <SummaryCard icon="🔍" label="検索数（ユニーク）" value={searches.length} color="bg-emerald-50 border-emerald-100" />
        <SummaryCard icon="🔍" label="検索総数" value={summary.totalSearches} color="bg-teal-50 border-teal-100" />
        <SummaryCard icon="🛍" label="商品クリック" value={summary.totalProductClicks} color="bg-orange-50 border-orange-100" />
        <SummaryCard icon="🎬" label="作品クリック" value={summary.totalWorkClicks} color="bg-yellow-50 border-yellow-100" />
        <SummaryCard icon="▶" label="VODクリック" value={summary.totalVodClicks} color="bg-green-50 border-green-100" />
      </div>

      {/* 各ランキングのTOP5 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 人気人物 TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">👤 人気人物 TOP5</h3>
          <TableWrapper>
            <tbody>
              {persons.slice(0, 5).map((p, i) => (
                <tr key={p.name} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td>
                    <a href={`/person/${encodeURIComponent(p.name)}`} target="_blank" rel="noreferrer"
                      className="text-indigo-600 hover:underline text-xs">{p.name}</a>
                  </Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(p.count)}</span></Td>
                </tr>
              ))}
              {persons.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 人気検索 TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">🔍 人気検索 TOP5</h3>
          <TableWrapper>
            <tbody>
              {searches.slice(0, 5).map((s, i) => (
                <tr key={s.keyword} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td>
                    <a href={`/search?q=${encodeURIComponent(s.keyword)}`} target="_blank" rel="noreferrer"
                      className="text-indigo-600 hover:underline text-xs">{s.keyword}</a>
                  </Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(s.count)}</span></Td>
                </tr>
              ))}
              {searches.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 人気グループ TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">🏷 人気グループ TOP5</h3>
          <TableWrapper>
            <tbody>
              {groups.slice(0, 5).map((g, i) => (
                <tr key={g.groupName} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td>
                    <a href={`/group/${encodeURIComponent(g.groupName)}`} target="_blank" rel="noreferrer"
                      className="text-indigo-600 hover:underline text-xs">{g.groupName}</a>
                  </Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(g.count)}</span></Td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 人気VOD TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">▶ 人気VOD TOP5</h3>
          <TableWrapper>
            <tbody>
              {vods.slice(0, 5).map((v, i) => (
                <tr key={v.service} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td><span className="text-xs font-medium">{v.service}</span></Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(v.count)}</span></Td>
                </tr>
              ))}
              {vods.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 人気商品 TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">🛍 人気商品 TOP5</h3>
          <TableWrapper>
            <tbody>
              {products.slice(0, 5).map((p, i) => (
                <tr key={p.productId} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td><span className="text-[11px] text-slate-700 line-clamp-1">{p.title}</span></Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(p.count)}</span></Td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>

        {/* 人気作品 TOP5 */}
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-2">🎬 人気作品 TOP5</h3>
          <TableWrapper>
            <tbody>
              {works.slice(0, 5).map((w, i) => (
                <tr key={w.workId} className="hover:bg-gray-50">
                  <Td muted>{i + 1}</Td>
                  <Td><span className="text-[11px] text-slate-700 line-clamp-1">{w.title}</span></Td>
                  <Td right><span className="font-bold text-xs">{fmtNum(w.count)}</span></Td>
                </tr>
              ))}
              {works.length === 0 && (
                <tr><td colSpan={3} className="text-center py-4 text-gray-400 text-xs">データなし</td></tr>
              )}
            </tbody>
          </TableWrapper>
        </div>
      </div>
    </div>
  );
}

// ─── メインコンポーネント ──────────────────────────────────────────────────────
export default function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const [activeTab, setActiveTab] = useState<Tab>('概要');

  return (
    <div className="space-y-6">
      {/* タブ */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-slate-700 hover:border-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* タブコンテンツ */}
      <div>
        {activeTab === '概要'       && <OverviewTab data={data} />}
        {activeTab === '人気人物'   && <PersonTable data={data.persons} />}
        {activeTab === '人気グループ' && <GroupTable data={data.groups} />}
        {activeTab === '人気検索'   && <SearchTable data={data.searches} />}
        {activeTab === '人気商品'   && <ProductTable data={data.products} />}
        {activeTab === '人気作品'   && <WorkTable data={data.works} />}
        {activeTab === '人気VOD'    && <VodTable data={data.vods} />}
      </div>
    </div>
  );
}
