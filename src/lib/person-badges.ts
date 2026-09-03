// 人物ページのバッジ表示定義。PersonHero（ファーストビュー）と
// プロフィールセクション（活動状況ラベル）の両方から参照するため共有する。
// 値自体は元々 src/app/person/[slug]/page.tsx にあったものと同一（変更なし）。
import type { ActivityStatus } from '@/types/person';

export const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  active: '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus: '活動休止',
  retired: '引退',
  unknown: '不明',
};

export const ACTIVITY_BADGE_CLS: Record<ActivityStatus, string> = {
  active:    'bg-green-100 text-green-700',
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus:    'bg-amber-100 text-amber-700',
  retired:   'bg-gray-200 text-gray-500',
  unknown:   'bg-gray-100 text-gray-400',
};

export const GENRE_BADGE: Record<string, string> = {
  '坂道':        'bg-pink-100 text-pink-700',
  '芸人':        'bg-yellow-100 text-yellow-700',
  'テレビ':      'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優':        'bg-green-100 text-green-700',
};
