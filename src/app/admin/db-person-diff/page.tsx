'use client';

import { Suspense, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// ── 型定義（API レスポンスに合わせる） ────────────────────────────────────────

type Classification =
  | 'dup_title_year'
  | 'dup_title_only'
  | 'deleted'
  | 'suspect'
  | 'migrate'
  | 'unknown';

interface WorkSummary {
  workId: string;
  title: string;
  releaseYear: number | null;
  workType: string;
  source: string;
  status: string;
  roleName: string | null;
  deleted: boolean;
}

interface ClassifiedWork extends WorkSummary {
  classification: Classification;
  classificationNote: string;
  dupWorkId?: string;
}

interface PersonResult {
  mode: 'person';
  personName: string;
  redisRawCount: number;
  redisParseOk: number;
  dbTotal: number;
  matchedCount: number;
  redisOnly: ClassifiedWork[];
  dbOnly: WorkSummary[];
  classSummary: Record<string, number>;
  parseErrors: string[];
  error?: string;
}

interface PersonCountRow {
  personName: string;
  redisCount: number;
  dbCount: number;
  diff: number;
}

interface AllResult {
  mode: 'all';
  persons: PersonCountRow[];
  redisMajority: number;
  dbMajority: number;
  error?: string;
}

// ── 分類設定 ──────────────────────────────────────────────────────────────────

const CLASS_CONFIG: Record<Classification, { label: string; chip: string }> = {
  dup_title_year: { label: 'DB重複(title+year+type)', chip: 'bg-amber-100 text-amber-800 border-amber-300' },
  dup_title_only: { label: 'タイトル一致(年違い)',     chip: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  deleted:        { label: '論理削除済み',             chip: 'bg-gray-100 text-gray-600 border-gray-300' },
  suspect:        { label: '誤登録・別人候補',          chip: 'bg-red-100 text-red-800 border-red-300' },
  migrate:        { label: 'DB移行候補',               chip: 'bg-blue-100 text-blue-800 border-blue-300' },
  unknown:        { label: '判定不能',                 chip: 'bg-orange-100 text-orange-800 border-orange-300' },
};

const CLASS_ORDER: Classification[] = [
  'dup_title_year', 'dup_title_only', 'suspect', 'unknown', 'migrate', 'deleted',
];

// ── ステータスバッジ ────────────────────────────────────────────────────────────

function StatusBadge({ status, deleted }: { status: string; deleted: boolean }) {
  if (deleted) return <span className="px-1 py-0.5 rounded text-[10px] bg-red-100 text-red-700 border border-red-200">deleted</span>;
  const cls =
    status === 'auto_published' ? 'bg-green-100 text-green-700 border-green-200' :
    status === 'needs_review'   ? 'bg-amber-100 text-amber-700 border-amber-200' :
    status === 'hidden'         ? 'bg-gray-100 text-gray-500 border-gray-200' :
    'bg-blue-100 text-blue-700 border-blue-200';
  return <span className={`px-1 py-0.5 rounded text-[10px] border ${cls}`}>{status}</span>;
}

function ClassBadge({ c }: { c: Classification }) {
  const cfg = CLASS_CONFIG[c] ?? CLASS_CONFIG['unknown'];
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${cfg.chip}`}>
      {cfg.label}
    </span>
  );
}

// ── Redisのみ テーブル ─────────────────────────────────────────────────────────

function RedisOnlyTable({ entries }: { entries: ClassifiedWork[] }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? entries : entries.slice(0, 50);

  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-gray-500 text-left">
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">判定</th>
              <th className="py-1.5 px-2 font-medium">title</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">workId</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap text-right">year</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">type</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">source</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">status</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">roleName</th>
              <th className="py-1.5 px-2 font-medium">判定理由</th>
              <th className="py-1.5 px-2 font-medium whitespace-nowrap">DB重複ID</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => (
              <tr
                key={i}
                className={`border-b hover:bg-gray-50 ${e.deleted ? 'opacity-40' : ''}`}
              >
                <td className="py-1 px-2 whitespace-nowrap"><ClassBadge c={e.classification} /></td>
                <td className="py-1 px-2 max-w-[200px]">
                  <span className="block truncate" title={e.title}>{e.title}</span>
                </td>
                <td className="py-1 px-2 font-mono text-gray-400 whitespace-nowrap text-[10px]">{e.workId}</td>
                <td className="py-1 px-2 text-right text-gray-500 whitespace-nowrap">{e.releaseYear ?? '-'}</td>
                <td className="py-1 px-2 text-gray-500 whitespace-nowrap">{e.workType}</td>
                <td className="py-1 px-2 font-mono text-gray-500 whitespace-nowrap">{e.source || <span className="text-red-400">（空）</span>}</td>
                <td className="py-1 px-2 whitespace-nowrap">
                  <StatusBadge status={e.status} deleted={e.deleted} />
                </td>
                <td className="py-1 px-2 text-gray-500 max-w-[100px]">
                  <span className="block truncate" title={e.roleName ?? ''}>{e.roleName ?? '-'}</span>
                </td>
                <td className="py-1 px-2 text-gray-500 text-[10px] max-w-[200px]">
                  <span className="block truncate" title={e.classificationNote}>{e.classificationNote}</span>
                </td>
                <td className="py-1 px-2 font-mono text-gray-300 whitespace-nowrap text-[10px]">{e.dupWorkId ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > 50 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          {showAll ? '▲ 折り畳む' : `▼ 残り ${entries.length - 50} 件を表示`}
        </button>
      )}
    </div>
  );
}

// ── DBのみ テーブル ────────────────────────────────────────────────────────────

function DbOnlyTable({ entries }: { entries: WorkSummary[] }) {
  if (entries.length === 0) return <p className="text-xs text-gray-400 py-2">なし</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500 text-left">
            <th className="py-1.5 px-2 font-medium">title</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">workId</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap text-right">year</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">type</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">source</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">status</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">roleName</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={i} className={`border-b hover:bg-gray-50 ${e.deleted ? 'opacity-40' : ''}`}>
              <td className="py-1 px-2 max-w-[200px]">
                <span className="block truncate" title={e.title}>{e.title}</span>
              </td>
              <td className="py-1 px-2 font-mono text-gray-400 whitespace-nowrap text-[10px]">{e.workId}</td>
              <td className="py-1 px-2 text-right text-gray-500 whitespace-nowrap">{e.releaseYear ?? '-'}</td>
              <td className="py-1 px-2 text-gray-500 whitespace-nowrap">{e.workType}</td>
              <td className="py-1 px-2 font-mono text-gray-500 whitespace-nowrap">{e.source}</td>
              <td className="py-1 px-2 whitespace-nowrap">
                <StatusBadge status={e.status} deleted={e.deleted} />
              </td>
              <td className="py-1 px-2 text-gray-500 max-w-[120px]">
                <span className="block truncate">{e.roleName ?? '-'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 全人物サマリー テーブル ────────────────────────────────────────────────────

function AllPersonsTable({
  persons,
  onPersonClick,
}: {
  persons: PersonCountRow[];
  onPersonClick: (name: string) => void;
}) {
  if (persons.length === 0) {
    return <p className="text-xs text-green-600 py-2">✓ 全人物が一致しています</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-gray-500 text-left">
            <th className="py-1.5 px-2 font-medium">人物名</th>
            <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">Redis</th>
            <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">DB</th>
            <th className="py-1.5 px-2 font-medium text-right whitespace-nowrap">差分(DB-Redis)</th>
            <th className="py-1.5 px-2 font-medium whitespace-nowrap">状態</th>
            <th className="py-1.5 px-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {persons.map((p, i) => (
            <tr key={i} className="border-b hover:bg-gray-50">
              <td className="py-1 px-2 font-medium">{p.personName}</td>
              <td className="py-1 px-2 text-right font-mono">{p.redisCount}</td>
              <td className="py-1 px-2 text-right font-mono">{p.dbCount}</td>
              <td className={`py-1 px-2 text-right font-mono font-bold ${p.diff < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                {p.diff > 0 ? `+${p.diff}` : p.diff}
              </td>
              <td className="py-1 px-2 whitespace-nowrap">
                {p.diff < 0
                  ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">Redis &gt; DB（欠落あり）</span>
                  : <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">DB &gt; Redis</span>
                }
              </td>
              <td className="py-1 px-2">
                <button
                  onClick={() => onPersonClick(p.personName)}
                  className="text-[10px] text-blue-600 hover:underline"
                >
                  詳細
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 人物詳細結果 ──────────────────────────────────────────────────────────────

function PersonResultView({ result }: { result: PersonResult }) {
  const missingInDB = result.redisRawCount - result.dbTotal;

  return (
    <div className="space-y-6">
      {/* 集計カード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Redis（hkeys）', val: result.redisRawCount, color: 'text-gray-700' },
          { label: 'Redis（parse OK）', val: result.redisParseOk, color: result.parseErrors.length > 0 ? 'text-amber-600' : 'text-gray-700' },
          { label: 'DB件数', val: result.dbTotal, color: 'text-gray-700' },
          { label: '差分（Redis-DB）', val: missingInDB, color: missingInDB > 0 ? 'text-red-600' : missingInDB < 0 ? 'text-blue-600' : 'text-green-600' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-white border rounded p-3 text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{val}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '完全一致（両側）', val: result.matchedCount, color: 'text-green-600' },
          { label: 'Redisのみ', val: result.redisOnly.length, color: result.redisOnly.length > 0 ? 'text-red-600' : 'text-green-600' },
          { label: 'DBのみ', val: result.dbOnly.length, color: result.dbOnly.length > 0 ? 'text-blue-600' : 'text-green-600' },
          { label: 'JSONパースエラー', val: result.parseErrors.length, color: result.parseErrors.length > 0 ? 'text-red-600' : 'text-gray-400' },
        ].map(({ label, val, color }) => (
          <div key={label} className="bg-white border rounded p-3 text-center">
            <p className="text-[10px] text-gray-400 mb-0.5">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* 分類サマリー */}
      {result.redisOnly.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Redisのみ — 分類内訳</p>
          <div className="flex flex-wrap gap-2">
            {CLASS_ORDER.map((c) => {
              const n = result.classSummary[c] ?? 0;
              if (n === 0) return null;
              const cfg = CLASS_CONFIG[c];
              return (
                <span key={c} className={`px-2.5 py-1 rounded border text-xs font-medium ${cfg.chip}`}>
                  {cfg.label}: <strong>{n}</strong>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* JSONパースエラー */}
      {result.parseErrors.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-red-700 mb-1">
            ⚠ JSONパースエラー ({result.parseErrors.length}件) — 移行不可
          </h3>
          <p className="text-xs text-gray-500 mb-1">
            これらの workId は Redis 上で JSON が壊れており、db-patch-works でも移行されません。
          </p>
          <div className="flex flex-wrap gap-1">
            {result.parseErrors.map((id) => (
              <code key={id} className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 border border-red-200 text-red-700">{id}</code>
            ))}
          </div>
        </section>
      )}

      {/* Redisのみ */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
          Redisのみ（DBに未登録）— {result.redisOnly.length}件
        </h3>
        <RedisOnlyTable entries={result.redisOnly} />
      </section>

      {/* DBのみ */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
          DBのみ（Redisに未登録）— {result.dbOnly.length}件
        </h3>
        <DbOnlyTable entries={result.dbOnly} />
      </section>
    </div>
  );
}

// ── メインコンテンツ（useSearchParams使用） ────────────────────────────────────

function Content() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialPerson = searchParams.get('person') ?? '';
  const [personInput, setPersonInput] = useState(initialPerson);
  const [personResult, setPersonResult] = useState<PersonResult | null>(null);
  const [allResult, setAllResult] = useState<AllResult | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [allLoading, setAllLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [allError, setAllError] = useState<string | null>(null);

  const fetchPerson = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setPersonLoading(true);
    setPersonError(null);
    setPersonResult(null);

    // URL更新
    const params = new URLSearchParams(searchParams.toString());
    params.set('person', name);
    router.replace(`?${params.toString()}`, { scroll: false });

    try {
      const res = await fetch(`/api/admin/db-person-diff?person=${encodeURIComponent(name)}`);
      const text = await res.text();
      if (!text.trim()) throw new Error('空レスポンス（タイムアウトの可能性）');
      const data = JSON.parse(text) as PersonResult;
      if (data.error) throw new Error(data.error);
      setPersonResult(data);
    } catch (e) {
      setPersonError(String(e));
    } finally {
      setPersonLoading(false);
    }
  }, [searchParams, router]);

  const fetchAll = useCallback(async () => {
    setAllLoading(true);
    setAllError(null);
    setAllResult(null);
    try {
      const res = await fetch('/api/admin/db-person-diff');
      const text = await res.text();
      if (!text.trim()) throw new Error('空レスポンス（タイムアウトの可能性）');
      const data = JSON.parse(text) as AllResult;
      if (data.error) throw new Error(data.error);
      setAllResult(data);
    } catch (e) {
      setAllError(String(e));
    } finally {
      setAllLoading(false);
    }
  }, []);

  // 人物詳細を初期パラメータから自動取得
  const [autoFetched, setAutoFetched] = useState(false);
  if (initialPerson && !autoFetched && !personLoading && !personResult) {
    setAutoFetched(true);
    fetchPerson(initialPerson);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-10">
      <div>
        <h1 className="text-xl font-bold mb-1">人物別 Redis ↔ DB 差分調査</h1>
        <p className="text-xs text-gray-500">
          読み取り専用。DB・Redis のデータを変更しません。
          Redisを正本とした場合のDB欠落状況と分類を表示します。
        </p>
      </div>

      {/* ── 人物詳細セクション ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold mb-3 border-b pb-1">人物詳細調査</h2>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={personInput}
            onChange={(e) => setPersonInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchPerson(personInput)}
            placeholder="加藤史帆"
            className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button
            onClick={() => fetchPerson(personInput)}
            disabled={personLoading || !personInput.trim()}
            className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {personLoading ? '取得中...' : '調査'}
          </button>
        </div>

        {personError && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
            <pre className="text-xs text-red-600 whitespace-pre-wrap">{personError}</pre>
          </div>
        )}

        {personResult && (
          <div>
            <p className="text-sm font-bold mb-3 text-gray-700">
              {personResult.personName} の差分
            </p>
            <PersonResultView result={personResult} />
          </div>
        )}
      </section>

      {/* ── 全人物スキャンセクション ───────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold mb-3 border-b pb-1">全人物スキャン</h2>
        <p className="text-xs text-gray-500 mb-3">
          全 works:* キーをスキャンして Redis件数 ≠ DB件数 の人物を一覧表示します。
          数百人分をスキャンするため10〜30秒かかります。
        </p>

        <button
          onClick={fetchAll}
          disabled={allLoading}
          className="px-4 py-1.5 text-sm rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 mb-4"
        >
          {allLoading ? 'スキャン中（しばらくお待ちください）...' : '全人物チェック'}
        </button>

        {allError && (
          <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
            <pre className="text-xs text-red-600 whitespace-pre-wrap">{allError}</pre>
          </div>
        )}

        {allResult && (
          <div>
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="bg-white border rounded p-3 text-center min-w-[120px]">
                <p className="text-[10px] text-gray-400">差分あり人物数</p>
                <p className="text-2xl font-bold text-gray-700">{allResult.persons.length}</p>
              </div>
              <div className="bg-white border rounded p-3 text-center min-w-[140px]">
                <p className="text-[10px] text-gray-400">Redis &gt; DB（欠落あり）</p>
                <p className="text-2xl font-bold text-red-600">{allResult.redisMajority}</p>
              </div>
              <div className="bg-white border rounded p-3 text-center min-w-[120px]">
                <p className="text-[10px] text-gray-400">DB &gt; Redis</p>
                <p className="text-2xl font-bold text-blue-600">{allResult.dbMajority}</p>
              </div>
            </div>

            <AllPersonsTable
              persons={allResult.persons}
              onPersonClick={(name) => {
                setPersonInput(name);
                fetchPerson(name);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

// ── デフォルトエクスポート（Suspenseラッパー） ────────────────────────────────

export default function DbPersonDiffPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">ページ初期化中...</div>}>
      <Content />
    </Suspense>
  );
}
