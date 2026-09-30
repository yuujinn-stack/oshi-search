'use client';

import { HOURLY_TIME_OPTIONS, MAX_POSTS_PER_DAY, defaultPostTimes } from '@/lib/instagram-post-times';

interface Props {
  count: number;
  times: string[];
  onChange: (count: number, times: string[]) => void;
  /** 入力チェックの結果（validatePostTimes）。null=問題なし */
  error: string | null;
}

/**
 * 一括予約の「1日あたり投稿数（1〜10件）」と「投稿時刻（1時間単位・JST）」の入力欄。
 * 投稿数を変えると、その件数の初期時刻（09:00 / 15:00 / 20:00 を含むプリセット）に置き換わる。時刻は1つずつ変更できる。
 */
export default function PostTimesEditor({ count, times, onChange, error }: Props) {
  const duplicates = new Set(times.filter((t, i) => t && times.indexOf(t) !== i));
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1">1日あたり投稿数</label>
          <select
            value={count}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(n, defaultPostTimes(n));
            }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2"
          >
            {Array.from({ length: MAX_POSTS_PER_DAY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}件</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => onChange(count, defaultPostTimes(count))}
          className="text-xs px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
        >
          初期時刻に戻す
        </button>
      </div>

      <p className="text-xs font-semibold text-gray-500 mt-3 mb-1">投稿時刻（JST・1時間単位。昇順で割り当てます）</p>
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {times.map((t, i) => (
          <label key={i} className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-5 text-right shrink-0">{i + 1}.</span>
            <select
              aria-label={`投稿時刻${i + 1}`}
              value={t}
              onChange={(e) => onChange(count, times.map((x, k) => (k === i ? e.target.value : x)))}
              className={`flex-1 min-w-0 text-sm border rounded-lg px-2 py-1.5 ${
                !t ? 'border-amber-400 bg-amber-50' : duplicates.has(t) ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-300 text-slate-700'
              }`}
            >
              <option value="">--:--</option>
              {HOURLY_TIME_OPTIONS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <p className="text-[11px] text-gray-400 mt-2">
        ※ 自動投稿は毎時0分に1回動くCronで処理します。Vercel Hobbyプランの仕様上、実際の投稿は指定時刻から最大約1時間遅れる場合があります。
      </p>
    </div>
  );
}
