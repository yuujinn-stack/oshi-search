import type { Metadata } from 'next';
import { LogoutButton } from '@/components/admin/LogoutButton';
import {
  listRecentSchedules,
  getScheduleStatusCountsInRange,
  getNextScheduledItem,
  listAttentionNeededSchedules,
  type ScheduleRangeBreakdown,
} from '@/server/instagram-schedule/schedule-store';
import { getStatusLabel, getStatusStyle } from '@/lib/instagram-schedule-status';
import { formatJst, getJstDayRangeUtc } from '@/lib/jst-time';
import { getScheduleTemplateMeta } from '@/lib/instagram-templates';
import { maskSecrets } from '@/lib/mask-secrets';
import { isAutopublishEnabled } from '@/server/instagram-post/config';
import { listUnreadAdminNotifications } from '@/server/instagram-schedule/admin-notifications';
import AdminNotificationsPanel, { type NotificationItem } from './AdminNotificationsPanel';

export const metadata: Metadata = {
  robots: { index: false, follow: false, noarchive: true },
};

// 「最近の投稿結果」が常に最新のDB状態を反映するよう、ビルド時の静的プリレンダーを無効化する
export const dynamic = 'force-dynamic';

/**
 * Instagram関連機能への入口カード一覧。
 *
 * 【将来カードを追加・変更する場合】ここに1件追加するだけでよい。
 * 例: 人物写真専用ページ（/admin/instagram-photos 等）ができたら、
 * personPhoto カードの href をそちらへ差し替える。
 */
interface InstagramHubCard {
  icon: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  note?: string;
}

const CARDS: InstagramHubCard[] = [
  {
    icon: '📸',
    title: 'Instagram投稿を作成',
    description: '人物を選んで投稿画像3枚を作成し、内容を確認してInstagramへ投稿します。',
    href: '/admin/instagram-post',
    cta: '投稿を作成する',
  },
  {
    icon: '📅',
    title: 'Instagram予約投稿',
    description: '投稿内容を事前に作成し、09:00 / 15:00 / 20:00などの時間に予約します。',
    href: '/admin/instagram-schedule',
    cta: '予約投稿へ進む',
  },
  {
    icon: '🖼️',
    title: '人物写真を登録・確認',
    description: '投稿画像の生成に使う人物写真を登録・差し替えできます。',
    href: '/admin/instagram-post',
    cta: '人物写真を登録',
    note: '現在は「Instagram投稿を作成」画面内（人物選択後）から登録します。専用ページは今後追加予定です。',
  },
  {
    icon: '🗂️',
    title: '一括予約',
    description: '複数人物を選んで、1日3投稿ずつまとめて予約します。',
    href: '/admin/instagram-schedule?mode=bulk',
    cta: '一括予約へ進む',
  },
];

/** published / (published + failed + needs_review)。分母が0件なら「—」を返す */
function formatSuccessRate(breakdown: ScheduleRangeBreakdown): string {
  const denom = breakdown.published + breakdown.failed + breakdown.needs_review;
  if (denom === 0) return '—';
  return `${Math.round((breakdown.published / denom) * 100)}%`;
}

export default async function InstagramHubPage() {
  // すべて読み取り専用。DB書き込み・Instagram APIへのアクセスは一切行わない。
  const todayRange = getJstDayRangeUtc(0);
  const sevenDayRange = getJstDayRangeUtc(6);
  const thirtyDayRange = getJstDayRangeUtc(29);

  const [recentSchedules, todayBreakdown, sevenDayBreakdown, thirtyDayBreakdown, nextScheduled, attentionNeeded, unreadNotifications] = await Promise.all([
    listRecentSchedules(5),
    getScheduleStatusCountsInRange(todayRange.from, todayRange.to),
    getScheduleStatusCountsInRange(sevenDayRange.from, sevenDayRange.to),
    getScheduleStatusCountsInRange(thirtyDayRange.from, thirtyDayRange.to),
    getNextScheduledItem(),
    listAttentionNeededSchedules(5),
    listUnreadAdminNotifications(5),
  ]);
  const autopublishOn = isAutopublishEnabled();

  // 表示直前にerrorMessageをマスクし、テンプレートIDを日本語ラベルへ変換してからクライアント側へ渡す
  const notificationItems: NotificationItem[] = unreadNotifications.map((n) => ({
    id: n.id,
    scheduleId: n.scheduleId,
    status: n.status,
    personName: n.schedule.personName,
    scheduledAt: n.schedule.scheduledAt.toISOString(),
    templateLabel: getScheduleTemplateMeta(n.schedule.templateId)?.label ?? n.schedule.templateId,
    attempts: n.schedule.attempts,
    errorMessage: maskSecrets(n.schedule.errorMessage),
    updatedAt: n.schedule.updatedAt.toISOString(),
  }));

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">Instagram管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            投稿の作成・予約・人物写真の登録など、Instagram関連機能の入口です。
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <LogoutButton className="text-gray-400 hover:text-red-500" />
        </div>
      </div>

      {/* Instagram運用状況ダッシュボード（すべて読み取り専用の集計・表示） */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-bold text-slate-700">Instagram運用状況</h2>
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
              autopublishOn ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            自動投稿：{autopublishOn ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* 要対応（failed/needs_reviewの未読通知） */}
        <div className="border border-gray-100 rounded-lg p-3 mb-5">
          <AdminNotificationsPanel initial={notificationItems} />
        </div>

        {/* ①今日 ②直近7日 ③直近30日 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          <div className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">今日</p>
            <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-700">
              <span>予約</span><span className="text-right font-semibold">{todayBreakdown.scheduled}</span>
              <span>投稿済み</span><span className="text-right font-semibold text-emerald-700">{todayBreakdown.published}</span>
              <span>失敗</span><span className="text-right font-semibold text-red-600">{todayBreakdown.failed}</span>
              <span>要確認</span><span className="text-right font-semibold text-orange-600">{todayBreakdown.needs_review}</span>
            </div>
          </div>

          <div className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">直近7日</p>
            <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-700">
              <span>投稿予定数</span><span className="text-right font-semibold">{sevenDayBreakdown.scheduled}</span>
              <span>投稿済み</span><span className="text-right font-semibold text-emerald-700">{sevenDayBreakdown.published}</span>
              <span>失敗</span><span className="text-right font-semibold text-red-600">{sevenDayBreakdown.failed}</span>
              <span>要確認</span><span className="text-right font-semibold text-orange-600">{sevenDayBreakdown.needs_review}</span>
              <span>成功率</span><span className="text-right font-semibold">{formatSuccessRate(sevenDayBreakdown)}</span>
            </div>
          </div>

          <div className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">直近30日</p>
            <div className="grid grid-cols-2 gap-y-1 text-xs text-slate-700">
              <span>投稿済み</span><span className="text-right font-semibold text-emerald-700">{thirtyDayBreakdown.published}</span>
              <span>失敗</span><span className="text-right font-semibold text-red-600">{thirtyDayBreakdown.failed}</span>
              <span>要確認</span><span className="text-right font-semibold text-orange-600">{thirtyDayBreakdown.needs_review}</span>
              <span>成功率</span><span className="text-right font-semibold">{formatSuccessRate(thirtyDayBreakdown)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ④次回投稿 */}
          <div className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">次回投稿</p>
            {nextScheduled ? (
              <div className="text-sm">
                <p className="text-slate-800 font-semibold">{formatJst(nextScheduled.scheduledAt)}</p>
                <p className="text-slate-700">{nextScheduled.personName}</p>
                <p className="text-xs text-gray-500">{getScheduleTemplateMeta(nextScheduled.templateId)?.label ?? nextScheduled.templateId}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-400">現在、次の予約投稿はありません</p>
            )}
          </div>

          {/* ⑤注意が必要な投稿 */}
          <div className="border border-gray-100 rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">注意が必要な投稿</p>
            {attentionNeeded.length === 0 ? (
              <p className="text-xs text-emerald-700">現在、確認が必要な投稿はありません</p>
            ) : (
              <ul className="space-y-2">
                {attentionNeeded.map((s) => (
                  <li key={s.id} className="text-xs border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-800">{s.personName}</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded-full font-semibold ${getStatusStyle(s.status)}`}>
                        {getStatusLabel(s.status)}
                      </span>
                    </div>
                    <p className="text-gray-500">{formatJst(s.scheduledAt)}</p>
                    {s.errorMessage && (
                      <p className="text-red-600 line-clamp-1">{maskSecrets(s.errorMessage)}</p>
                    )}
                    <a href="/admin/instagram-schedule" className="text-violet-600 hover:text-violet-700 font-semibold">
                      確認する →
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {CARDS.map((card) => (
          <a
            key={card.title}
            href={card.href}
            className="flex flex-col bg-white border border-gray-200 rounded-xl p-5 hover:border-violet-300 hover:shadow-md transition-all"
          >
            <div className="text-3xl mb-2">{card.icon}</div>
            <h2 className="text-sm font-bold text-slate-800 mb-1.5">{card.title}</h2>
            <p className="text-xs text-gray-500 leading-relaxed flex-1">{card.description}</p>
            {card.note && (
              <p className="text-[11px] text-amber-600 mt-2 leading-relaxed">{card.note}</p>
            )}
            <span className="mt-4 text-xs font-semibold text-violet-600">{card.cta} →</span>
          </a>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-700">最近の投稿結果</h2>
          <a href="/admin/instagram-schedule" className="text-xs font-semibold text-violet-600 hover:text-violet-700">
            すべて見る →
          </a>
        </div>
        {recentSchedules.length === 0 ? (
          <p className="text-xs text-gray-400">予約はまだありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentSchedules.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 whitespace-nowrap">{formatJst(s.scheduledAt)}</span>
                  <span className="font-medium text-slate-800">{s.personName}</span>
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusStyle(s.status)}`}>
                  {getStatusLabel(s.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
