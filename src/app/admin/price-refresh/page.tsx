import Link from 'next/link';
import {
  NOT_UPDATED_REASON_LABEL,
  getNotUpdatedItems,
  getPriceFreshnessByPerson,
  getPriceRefreshRunStatus,
  type NotUpdatedItem,
  type PersonPriceFreshness,
} from '@/lib/price-refresh-status';
import { PRICE_FRESH_DAYS } from '@/lib/price-freshness';
import type { PersonLastResult } from '@/lib/price-refresh-runner';
import { LogoutButton } from '@/components/admin/LogoutButton';
import {
  PRICE_REVIEW_MAX_AGE_DAYS, PRICE_REVIEW_PAGE_SIZE, getReviewInboxStatus, listPendingPriceReviews, listPriceReviewLogs, neonReviewDb,
  type PendingPriceReview, type PriceReviewLog, type ReviewInboxStatus,
} from '@/lib/price-review-store';
import { PriceReviewQueue, PriceReviewSyncButton } from './PriceReviewQueue';

// 価格の分割自動更新の状況。価格更新の実行・停止の操作はしない（GitHub Actions〔price-refresh〕と docs/price-refresh-runbook.md の手順で行う）。
// 表示（GET）は読み取りのみ（DB・Redis に書かない）。価格の確認待ちの取り込み・承認・却下は、ボタンから /api/admin/price-review（POST）で行う。
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ person?: string; view?: string; rp?: string; hp?: string }>;
}

const pageOf = (v?: string) => Math.min(Math.max(Math.floor(Number(v) || 1), 1), 10_000);

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  return (e?.code ?? e?.cause?.code) === '42P01' || /relation .*price_review.* does not exist/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`);
}

function Pager({ page, total, param, extra }: { page: number; total: number; param: 'rp' | 'hp'; extra: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / PRICE_REVIEW_PAGE_SIZE));
  if (pages <= 1) return null;
  const href = (n: number) => `/admin/price-refresh?${new URLSearchParams({ ...extra, [param]: String(n) }).toString()}`;
  return (
    <nav className="flex items-center gap-3 mt-3 text-sm" aria-label="ページ">
      {page > 1 ? <Link href={href(page - 1)} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50">← 前へ</Link> : <span className="px-3 py-1.5 text-gray-300">← 前へ</span>}
      <span className="text-gray-600">{page} / {pages}（{total.toLocaleString()} 件）</span>
      {page < pages ? <Link href={href(page + 1)} className="px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50">次へ →</Link> : <span className="px-3 py-1.5 text-gray-300">次へ →</span>}
    </nav>
  );
}

const ACTION_LABEL: Record<PriceReviewLog['action'], { text: string; cls: string }> = {
  approved: { text: '承認', cls: 'bg-emerald-100 text-emerald-800' },
  rejected: { text: '却下', cls: 'bg-red-100 text-red-700' },
  stale: { text: '反映せず', cls: 'bg-amber-100 text-amber-800' },
};

function fmt(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function failedLabel(last?: PersonLastResult): string {
  if (!last?.failedCategories.length) return '';
  return last.failedCategories
    .map((f) => `${f.category}（${f.status === 'db_error' ? '保存失敗' : f.httpStatus ?? '通信エラー'}）`)
    .join('、');
}

export default async function PriceRefreshAdminPage({ searchParams }: Props) {
  const { person, view, rp, hp } = await searchParams;
  const showHistory = view === 'history';
  const reviewPage = pageOf(rp), historyPage = pageOf(hp);
  // 確認待ち（DB が正本。読み取りのみ）と、Redis の受け取り箱にある未取り込みの数（読み取りのみ）
  const reviewDb = neonReviewDb();
  const inbox: ReviewInboxStatus | null = await getReviewInboxStatus().catch(() => null);
  let reviewError: string | null = null;
  let pending: { rows: PendingPriceReview[]; total: number } | null = null;
  let logs: { rows: PriceReviewLog[]; total: number } | null = null;
  try {
    if (showHistory) logs = await listPriceReviewLogs(reviewDb, historyPage);
    else pending = await listPendingPriceReviews(reviewDb, reviewPage);
  } catch (e) {
    reviewError = isMissingTable(e) ? '確認待ちのテーブルが未作成です。/admin/db-init でスキーマ初期化を実行してください。' : '確認待ちを読み取れませんでした。';
  }
  const [run, freshness] = await Promise.all([
    getPriceRefreshRunStatus().catch(() => null),
    getPriceFreshnessByPerson().catch(() => null),
  ]);
  let detail: NotUpdatedItem[] | null = null;
  if (person) detail = await getNotUpdatedItems(person).catch(() => null);

  const rows: (PersonPriceFreshness & { last?: PersonLastResult; completedAt?: number })[] = (freshness ?? [])
    .map((f) => ({ ...f, last: run?.states[f.personName]?.last, completedAt: run?.states[f.personName]?.completedAt }))
    .sort((a, b) => (b.unknown + b.stale) - (a.unknown + a.stale) || a.personName.localeCompare(b.personName, 'ja'));
  const totals = rows.reduce((t, r) => ({ total: t.total + r.total, fresh: t.fresh + r.fresh, stale: t.stale + r.stale, unknown: t.unknown + r.unknown }), { total: 0, fresh: 0, stale: 0, unknown: 0 });
  const withFailures = rows.filter((r) => r.last?.failedCategories.length);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">価格更新の状況</h1>
          <p className="text-sm text-gray-500 mt-1">
            楽天商品の価格の分割自動更新（GitHub Actions・OpenAI 不使用）の状況です。ここから価格更新の実行・停止はしません（価格の確認待ちの承認・却下だけができます）。
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            価格を取得できなかった商品は、保存済みの価格・取得日時をそのまま残します（判定・表示設定・並び順・商品名・アフィリエイトURLは変わりません）。
          </p>
        </div>
        <LogoutButton className="text-gray-400 hover:text-red-500 text-xs mt-1" />
      </div>

      {/* 実行の状態 */}
      <section className="mb-8">
        <h2 className="text-base font-bold text-slate-700 mb-3">実行の状態</h2>
        {!run ? (
          <p className="text-sm text-red-600">実行の状態（Redis）を読み取れませんでした。</p>
        ) : !run.redisAvailable ? (
          <p className="text-sm text-red-600">Redis が設定されていないため、実行の状態を表示できません。</p>
        ) : (
          <div className="space-y-3">
            {run.halt ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-4">
                <p className="font-bold text-red-700">自動停止中（価格以外の変更を検知）：{run.halt.person}（{fmt(run.halt.at)}）</p>
                <ul className="list-disc ml-5 text-sm text-red-700 mt-1">
                  {run.halt.reasons.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <p className="text-xs text-red-600 mt-2">
                  停止の印を消すまで、手動・定期とも実行されません。原因の確認と解除の手順は docs/price-refresh-runbook.md の「7. 緊急停止・再開」を参照してください。
                </p>
              </div>
            ) : (
              <p className="text-sm text-emerald-700">自動停止：なし</p>
            )}
            <p className="text-sm text-slate-700">実行中：{run.running ? 'はい（ロックあり）' : 'いいえ'}</p>
            {run.lastRun ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  ['直近の実行', `${fmt(run.lastRun.startedAt)}〜${fmt(run.lastRun.finishedAt)}${run.lastRun.manualTest ? '（手動テスト）' : ''}`],
                  ['結果', `${run.lastRun.status} / ${run.lastRun.stoppedBy}`],
                  ['処理した人物（完了）', `${run.lastRun.persons}（${run.lastRun.completed}）`],
                  ['価格を更新した商品', `検索 ${run.lastRun.updated} ／ コード指定 ${run.lastRun.lookupApplied}`],
                  ['コード指定の取得', `${run.lastRun.lookedUp} 回`],
                  ['取得できなかったカテゴリ', `${run.lastRun.failedCategories} 件`],
                  ...(run.lastRun.usage
                    ? [['使った量', `楽天API ${run.lastRun.usage.apiCalls} 回 ／ DB ${run.lastRun.usage.dbRowsRead} 行・約${Math.round(run.lastRun.usage.dbBytesRead / 1024)}KB`]]
                    : []),
                  ...(run.lastRun.stopDetail
                    ? [['楽天のエラーで終えた位置', `${run.lastRun.stopDetail.person} / ${run.lastRun.stopDetail.category}（${run.lastRun.stopDetail.reasons.join('、')}）`]]
                    : []),
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded-lg border border-gray-200 p-3">
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="text-sm font-bold text-slate-800 mt-0.5 break-all">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">まだ実行されていません。</p>
            )}
          </div>
        )}
      </section>

      {/* 取得できなかったカテゴリ */}
      {withFailures.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-slate-700 mb-3">直近の実行で楽天から取得できなかったカテゴリ</h2>
          <ul className="text-sm text-slate-700 space-y-1">
            {withFailures.map((r) => (
              <li key={r.personName}>
                <Link href={`/admin/price-refresh?person=${encodeURIComponent(r.personName)}`} className="text-blue-600 hover:underline">{r.personName}</Link>
                ：{failedLabel(r.last)}（{fmt(r.last?.at)}）
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 価格の確認待ち（承認・却下）と履歴 */}
      <section className="mb-8" id="price-reviews">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-base font-bold text-slate-700">価格の確認待ち（自動で更新しなかった商品）</h2>
          <div className="flex rounded-md border border-gray-300 overflow-hidden text-xs ml-auto">
            <Link href="/admin/price-refresh#price-reviews" className={`px-3 py-1.5 ${!showHistory ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-gray-50'}`}>確認待ち{pending ? `（${pending.total}）` : ''}</Link>
            <Link href="/admin/price-refresh?view=history#price-reviews" className={`px-3 py-1.5 border-l border-gray-300 ${showHistory ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-gray-50'}`}>承認・却下の履歴</Link>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          前回の価格から30%以上変わる取得価格（または前回の価格が無い商品）は自動で反映していません。承認すると価格と価格の取得日時だけを更新し、却下すると保存済みの価格はそのままです。
          {PRICE_REVIEW_MAX_AGE_DAYS}日より前に取得した価格は承認できません。
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-slate-600">
          <span>
            価格更新の結果のうち未取り込み：{inbox ? `${inbox.waiting.toLocaleString()} 件` : '不明（Redis を読み取れません）'}
            {inbox && inbox.waiting > 0 ? '（「取り込む」で確認待ちに追加。承認・却下のときも自動で取り込みます）' : ''}
          </span>
          <PriceReviewSyncButton />
        </div>
        {inbox && inbox.waiting >= inbox.capacity * 0.8 && (
          <p className="text-xs text-amber-700 mb-2">未取り込みが上限（{inbox.capacity.toLocaleString()} 件）に近づいています。「取り込む」を押してください。</p>
        )}
        {inbox && inbox.dropped > 0 && (
          <p className="text-xs text-amber-700 mb-2">
            上限のため一時的に保存できなかった確認待ちが累計 {inbox.dropped.toLocaleString()} 件あります。保存済みの価格は変えていないため、次にその人物の価格を更新したときに再び確認待ちになります。
          </p>
        )}
        {reviewError ? (
          <p className="text-sm text-red-600">{reviewError}</p>
        ) : showHistory ? (
          logs && logs.rows.length > 0 ? (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full text-xs bg-white border border-gray-200">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-2 py-1 text-left">操作日時</th>
                      <th className="px-2 py-1 text-left">操作</th>
                      <th className="px-2 py-1 text-left">人物</th>
                      <th className="px-2 py-1 text-left">商品</th>
                      <th className="px-2 py-1 text-right">変更前の価格</th>
                      <th className="px-2 py-1 text-right">取得した価格</th>
                      <th className="px-2 py-1 text-left">操作者</th>
                      <th className="px-2 py-1 text-left">備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.rows.map((l) => (
                      <tr key={l.id} className="border-t border-gray-100 align-top">
                        <td className="px-2 py-1 whitespace-nowrap">{fmt(new Date(l.createdAt).getTime())}</td>
                        <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded font-bold ${ACTION_LABEL[l.action]?.cls ?? ''}`}>{ACTION_LABEL[l.action]?.text ?? l.action}</span></td>
                        <td className="px-2 py-1 whitespace-nowrap">{l.personName}<div className="text-gray-400">{l.category}</div></td>
                        <td className="px-2 py-1 max-w-xs"><div className="line-clamp-2">{l.itemTitle ?? '—'}</div><div className="font-mono text-[10px] text-gray-400 break-all">{l.itemId}</div></td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">{l.previousPrice > 0 ? `¥${l.previousPrice.toLocaleString()}` : '—'}</td>
                        <td className="px-2 py-1 text-right whitespace-nowrap">¥{l.fetchedPrice.toLocaleString()}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{l.performedBy}</td>
                        <td className="px-2 py-1">{l.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden space-y-2">
                {logs.rows.map((l) => (
                  <li key={l.id} className="bg-white rounded-lg border border-gray-200 p-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${ACTION_LABEL[l.action]?.cls ?? ''}`}>{ACTION_LABEL[l.action]?.text ?? l.action}</span>
                      <span className="text-gray-500">{fmt(new Date(l.createdAt).getTime())} ／ {l.performedBy}</span>
                    </div>
                    <div className="mt-1 text-gray-500">{l.personName} ／ {l.category}</div>
                    <div className="text-sm text-slate-800 line-clamp-2">{l.itemTitle ?? l.itemId}</div>
                    <div className="mt-1">{l.previousPrice > 0 ? `¥${l.previousPrice.toLocaleString()}` : '—'} → ¥{l.fetchedPrice.toLocaleString()}</div>
                    {l.note && <div className="text-amber-700 mt-1">{l.note}</div>}
                  </li>
                ))}
              </ul>
              <Pager page={historyPage} total={logs.total} param="hp" extra={{ view: 'history' }} />
            </>
          ) : (
            <p className="text-sm text-gray-500">まだ履歴はありません。</p>
          )
        ) : pending && pending.rows.length > 0 ? (
          <>
            <PriceReviewQueue rows={pending.rows} />
            <Pager page={reviewPage} total={pending.total} param="rp" extra={{}} />
          </>
        ) : (
          <p className="text-sm text-emerald-700">確認待ちの商品はありません。</p>
        )}
      </section>

      {/* 人物の詳細 */}
      {person && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-slate-700 mb-1">{person}：価格を更新できていない公開中の商品</h2>
          <p className="text-xs text-gray-500 mb-3">価格の取得日時が {PRICE_FRESH_DAYS} 日より古い、または無い商品。理由は目安です。</p>
          {detail === null ? (
            <p className="text-sm text-red-600">読み取れませんでした。</p>
          ) : detail.length === 0 ? (
            <p className="text-sm text-emerald-700">すべて {PRICE_FRESH_DAYS} 日以内に取得済みです。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs bg-white border border-gray-200">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-1 text-left">カテゴリ</th>
                    <th className="px-2 py-1 text-left">商品名</th>
                    <th className="px-2 py-1 text-right">保存中の価格</th>
                    <th className="px-2 py-1 text-left">取得日時</th>
                    <th className="px-2 py-1 text-left">理由の目安</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((d) => (
                    <tr key={`${d.category}|${d.id}`} className="border-t border-gray-100">
                      <td className="px-2 py-1 whitespace-nowrap">{d.category}</td>
                      <td className="px-2 py-1">{d.title}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{d.price > 0 ? `¥${d.price.toLocaleString()}` : '—'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{d.priceFetchedAt ? fmt(d.priceFetchedAt) : '不明'}</td>
                      <td className="px-2 py-1">{NOT_UPDATED_REASON_LABEL[d.reason]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 人物ごとの取得状況 */}
      <section>
        <h2 className="text-base font-bold text-slate-700 mb-1">公開中の商品の価格の取得状況</h2>
        {freshness === null ? (
          <p className="text-sm text-red-600">DB を読み取れませんでした。</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              全体：{totals.total.toLocaleString()} 件中、{PRICE_FRESH_DAYS} 日以内 {totals.fresh.toLocaleString()} ／ 古い {totals.stale.toLocaleString()} ／ 不明 {totals.unknown.toLocaleString()}（更新できていない商品の多い順）
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs bg-white border border-gray-200">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-2 py-1 text-left">人物</th>
                    <th className="px-2 py-1 text-right">公開中</th>
                    <th className="px-2 py-1 text-right">{PRICE_FRESH_DAYS}日以内</th>
                    <th className="px-2 py-1 text-right">古い</th>
                    <th className="px-2 py-1 text-right">不明</th>
                    <th className="px-2 py-1 text-left">最後に完了</th>
                    <th className="px-2 py-1 text-left">直近の結果</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.personName} className="border-t border-gray-100">
                      <td className="px-2 py-1 whitespace-nowrap">
                        <Link href={`/admin/price-refresh?person=${encodeURIComponent(r.personName)}`} className="text-blue-600 hover:underline">{r.personName}</Link>
                      </td>
                      <td className="px-2 py-1 text-right">{r.total}</td>
                      <td className="px-2 py-1 text-right">{r.fresh}</td>
                      <td className="px-2 py-1 text-right">{r.stale}</td>
                      <td className="px-2 py-1 text-right">{r.unknown}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{fmt(r.completedAt)}</td>
                      <td className="px-2 py-1">
                        {r.last
                          ? `${fmt(r.last.at)} 更新 ${r.last.updated}${r.last.lookup ? ` ／ コード指定 ${r.last.lookup.applied}` : ''}${r.last.halted ? ' ／ 自動停止' : ''}${r.last.stop ? ` ／ ${r.last.stop.category}で終了` : ''}${r.last.priceReviews?.length ? ` ／ 確認待ち ${r.last.priceReviews.length}` : ''}${r.last.usage ? ` ／ API ${r.last.usage.apiCalls}回・DB 約${Math.round(r.last.usage.dbBytesRead / 1024)}KB` : ''}${failedLabel(r.last) ? ` ／ 取得できず：${failedLabel(r.last)}` : ''}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
