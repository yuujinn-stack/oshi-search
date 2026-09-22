import type { Metadata } from 'next';
import { LogoutButton } from '@/components/admin/LogoutButton';
import { listRecentSchedules } from '@/server/instagram-schedule/schedule-store';
import { getStatusLabel, getStatusStyle } from '@/lib/instagram-schedule-status';
import { formatJst } from '@/lib/jst-time';

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

export default async function InstagramHubPage() {
  // 読み取り専用（直近の予定日時順、最大5件）。DB書き込み・Instagram APIへのアクセスは一切行わない。
  const recentSchedules = await listRecentSchedules(5);

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
