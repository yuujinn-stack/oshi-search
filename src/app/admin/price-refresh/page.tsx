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

// 価格の分割自動更新の状況（読み取りのみ。DB・Redis への書き込み、価格更新の実行・停止の操作はしない）。
// 実行・停止は GitHub Actions（price-refresh）と docs/price-refresh-runbook.md の手順で行う。
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ person?: string }>;
}

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
  const { person } = await searchParams;
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
  const reviewRows = Object.entries(run?.states ?? {})
    .flatMap(([person, st]) => (st.last?.priceReviews ?? []).map((review) => ({ person, at: st.last!.at, review })))
    .sort((a, b) => b.at - a.at);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">価格更新の状況</h1>
          <p className="text-sm text-gray-500 mt-1">
            楽天商品の価格の分割自動更新（GitHub Actions・OpenAI 不使用）の状況です。読み取りのみで、ここから更新・停止の操作はしません。
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

      {/* 価格の確認待ち */}
      {reviewRows.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-bold text-slate-700 mb-1">価格の確認待ち（自動で更新しなかった商品）</h2>
          <p className="text-xs text-gray-500 mb-3">
            前回の価格から30%以上変わる取得価格（または前回の価格が無い商品）は自動で反映していません。保存済みの価格・取得日時はそのままです（直近の実行の結果）。
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs bg-white border border-gray-200">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-2 py-1 text-left">人物</th>
                  <th className="px-2 py-1 text-left">カテゴリ</th>
                  <th className="px-2 py-1 text-left">商品ID</th>
                  <th className="px-2 py-1 text-right">変更前の価格</th>
                  <th className="px-2 py-1 text-right">取得した価格</th>
                  <th className="px-2 py-1 text-right">変動率</th>
                  <th className="px-2 py-1 text-left">理由</th>
                  <th className="px-2 py-1 text-left">日時</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map(({ person: p, at, review: r }) => (
                  <tr key={`${p}|${r.category}|${r.id}`} className="border-t border-gray-100">
                    <td className="px-2 py-1 whitespace-nowrap">{p}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{r.category ?? ''}</td>
                    <td className="px-2 py-1 whitespace-nowrap font-mono">{r.id}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">{r.previousPrice > 0 ? `¥${r.previousPrice.toLocaleString()}` : '—'}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">¥{r.fetchedPrice.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">{r.changeRate == null ? '—' : `${r.changeRate > 0 ? '+' : ''}${(r.changeRate * 100).toFixed(1)}%`}</td>
                    <td className="px-2 py-1">{r.reason === 'price_change_30pct' ? '前回の価格から30%以上の変動' : '前回の価格が無い'}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{fmt(at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
