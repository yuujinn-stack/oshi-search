'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { jstWallClockToUtcDate, nowJstParts, formatJst } from '@/lib/jst-time';

interface HCandidate {
  personName: string;
  group: string | null;
  streamingWorkCount: number;
  streamingWorkCountExcludingYouTubeOnly: number;
  serviceCount: number;
  serviceCountExcludingYouTube: number;
  productCount: number;
  workCount: number;
  lastPostedAt: string | null;
  eligible: boolean;
  ineligibleReason: string | null;
  score: number;
  scoreBreakdown: { streaming: number; services: number; products: number; recency: number };
}

interface HCandidateList {
  generatedAt: string;
  total: number;
  eligibleCount: number;
  candidates: HCandidate[];
}

interface GeneratedPost {
  personName: string;
  templateId: string;
  images: { order: 1 | 2 | 3; url: string; fileName: string }[];
  caption: string;
  hashtags: string;
}

interface CreatedSchedule {
  id: number;
  personName: string;
  scheduledAt: string;
}

// 既存の予約画面（/admin/instagram-schedule）と同じ、1日3枠運用（09:00 / 15:00 / 20:00 JST）のおすすめ投稿時間
const RECOMMENDED_TIMES = ['09:00', '15:00', '20:00'] as const;
const CAPTION_MAX = 2200;

async function readJson<T>(res: Response): Promise<T> {
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error(`サーバーエラー（HTTP ${res.status}）`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '未投稿';
}

export default function InstagramHClient() {
  const [list, setList] = useState<HCandidateList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIneligible, setShowIneligible] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedPost | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [caption, setCaption] = useState('');
  const [scheduleDate, setScheduleDate] = useState(() => nowJstParts().date);
  const [scheduleTime, setScheduleTime] = useState('20:00');
  const [occupied, setOccupied] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedSchedule | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/instagram-h/candidates${refresh ? '?refresh=1' : ''}`);
      setList(await readJson<HCandidateList>(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  async function generate(personName: string) {
    setSelected(personName);
    setGenerating(true);
    setGenerated(null);
    setGenerateError(null);
    setCreated(null);
    setCreateError(null);
    try {
      const res = await fetch('/api/admin/instagram-h/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName }),
      });
      const data = await readJson<GeneratedPost>(res);
      setGenerated(data);
      setCaption(data.caption);
      // 既存予約と同じ日時にならないよう、埋まっている枠を取得して警告に使う（読み取りのみ）
      const occ = await readJson<{ occupied: string[] }>(await fetch('/api/admin/instagram-schedule/occupied-slots?days=120'));
      setOccupied(new Set(occ.occupied.map((iso) => new Date(iso).toISOString())));
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  const scheduledAt = useMemo(() => {
    try {
      return jstWallClockToUtcDate(scheduleDate, scheduleTime);
    } catch {
      return null;
    }
  }, [scheduleDate, scheduleTime]);
  const isPast = !scheduledAt || scheduledAt.getTime() <= Date.now();
  const slotTaken = !!scheduledAt && occupied.has(scheduledAt.toISOString());
  const selectedCandidate = list?.candidates.find((c) => c.personName === selected) ?? null;

  async function reserve() {
    if (!generated || !scheduledAt) return;
    const ok = window.confirm(
      `${generated.personName} のH投稿を ${formatJst(scheduledAt)}（JST）に予約します。\n` +
        '指定日時になると、既存の自動投稿（Cron）がこの3枚とキャプションでInstagramへ投稿します。よろしいですか？',
    );
    if (!ok) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/admin/instagram-h/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: generated.personName,
          imageUrls: [...generated.images].sort((a, b) => a.order - b.order).map((i) => i.url),
          caption,
          hashtags: generated.hashtags,
          scheduledAtIso: scheduledAt.toISOString(),
        }),
      });
      const data = await readJson<{ schedule: CreatedSchedule }>(res);
      setCreated(data.schedule);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const rows = (list?.candidates ?? []).filter((c) => showIneligible || c.eligible);

  return (
    <div className="space-y-6">
      {/* 1. 人物を選ぶ */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-700">1. 投稿する人物を選ぶ（H適性度順）</h2>
            {list && (
              <p className="text-xs text-gray-500 mt-1">
                生成可能 {list.eligibleCount}人 ／ 登録 {list.total}人（集計：{new Date(list.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST）
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-gray-600">
              <input type="checkbox" checked={showIneligible} onChange={(e) => setShowIneligible(e.target.checked)} />
              生成できない人物も表示
            </label>
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              再集計
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">
          H適性度（100点）＝ 配信中の作品数 30点（150件で満点）＋ 配信サービス数 20点（16社で満点）＋ 関連商品数 30点（400件で満点）＋ 前回投稿からの経過 20点（未投稿・60日以上で満点）。
          並べ替えの参考値で、人物は自動では選ばれません。作品・サービスはYouTube系のみの作品／YouTube系サービスを除いて算出。表の「配信中」「サービス」は人物ページと同じ数字（括弧内がYouTube系を除いた数）。
        </p>
        {loading && <p className="text-sm text-gray-500">全人物を集計しています（初回は1分ほどかかります）…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-2">順位</th>
                  <th className="py-2 pr-2">人物名</th>
                  <th className="py-2 pr-2">グループ</th>
                  <th className="py-2 pr-2 text-right">配信中</th>
                  <th className="py-2 pr-2 text-right">サービス</th>
                  <th className="py-2 pr-2 text-right">商品</th>
                  <th className="py-2 pr-2 text-right">登録作品</th>
                  <th className="py-2 pr-2">前回投稿</th>
                  <th className="py-2 pr-2">生成可否</th>
                  <th className="py-2 pr-2 text-right">H適性度</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.personName} className={`border-b border-gray-100 ${selected === c.personName ? 'bg-violet-50' : ''}`}>
                    <td className="py-2 pr-2 text-gray-500">{c.eligible ? i + 1 : '-'}</td>
                    <td className="py-2 pr-2 font-semibold text-slate-800 whitespace-nowrap">{c.personName}</td>
                    <td className="py-2 pr-2 text-gray-500 whitespace-nowrap">{c.group ?? '-'}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {c.streamingWorkCount}
                      <span className="text-gray-400">（{c.streamingWorkCountExcludingYouTubeOnly}）</span>
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {c.serviceCount}
                      <span className="text-gray-400">（{c.serviceCountExcludingYouTube}）</span>
                    </td>
                    <td className="py-2 pr-2 text-right">{c.productCount}</td>
                    <td className="py-2 pr-2 text-right">{c.workCount}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">{formatDate(c.lastPostedAt)}</td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {c.eligible ? <span className="text-emerald-600">生成可</span> : <span className="text-gray-400" title={c.ineligibleReason ?? ''}>不可</span>}
                    </td>
                    <td className="py-2 pr-2 text-right font-semibold" title={`配信中${c.scoreBreakdown.streaming} / サービス${c.scoreBreakdown.services} / 商品${c.scoreBreakdown.products} / 経過${c.scoreBreakdown.recency}`}>
                      {c.score}
                    </td>
                    <td className="py-2 text-right">
                      {c.eligible && (
                        <button
                          onClick={() => generate(c.personName)}
                          disabled={generating || creating}
                          className="px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold disabled:opacity-40 whitespace-nowrap"
                        >
                          Hを生成
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2〜4. 生成・確認・予約 */}
      {(generating || generated || generateError) && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-700">2. 生成した3枚を確認：{selected}</h2>
          {generating && <p className="text-sm text-gray-500">3枚を生成しています…（数秒〜十数秒）</p>}
          {generateError && <p className="text-sm text-red-600">{generateError}</p>}
          {generated && (
            <>
              {selectedCandidate?.lastPostedAt && (
                <p className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  ⚠️ この人物は {formatDate(selectedCandidate.lastPostedAt)} にInstagramへ投稿済みです。再投稿する場合はこのまま進めてください。
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[...generated.images].sort((a, b) => a.order - b.order).map((img) => (
                  <div key={img.order} className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500">{img.order}枚目</p>
                    {/* 予約時はこの同じURLの画像を保存し、投稿時もこの画像を使う */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`H ${img.order}枚目`} className="w-full aspect-square rounded-lg border border-gray-200" />
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold text-gray-500">3. キャプション（編集できます）</p>
                  <span className={`text-[11px] ${caption.length > CAPTION_MAX ? 'text-red-600' : 'text-gray-400'}`}>
                    {caption.length} / {CAPTION_MAX}
                  </span>
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={14}
                  className="w-full text-sm border border-gray-300 rounded-lg p-3 font-sans"
                />
                <button type="button" onClick={() => setCaption(generated.caption)} className="text-xs text-gray-500 hover:text-violet-600 mt-1">
                  生成時のキャプションに戻す
                </button>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 mb-2">4. 投稿予定日時（Asia/Tokyo）</p>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-xs text-gray-400 mr-1">おすすめ投稿時間:</span>
                  {RECOMMENDED_TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setScheduleTime(t)}
                      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                        scheduleTime === t ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2" />
                  <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-3 py-2" />
                  <span className="text-xs text-gray-400">JST</span>
                </div>
                {!(RECOMMENDED_TIMES as readonly string[]).includes(scheduleTime) && (
                  <p className="text-xs text-amber-600 mt-2">
                    ⚠️ おすすめ時間（09:00 / 15:00 / 20:00）以外の時刻です。HobbyプランではCronが1日3回のため、
                    自由時刻を指定すると次回のCron実行時に投稿されます。
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">※ Vercel Hobbyプランの制約上、実際の投稿時刻は指定時刻から最大約1時間ずれる場合があります。</p>
                {isPast && <p className="text-xs text-red-600 mt-2">過去の日時は予約できません。未来の日時を指定してください。</p>}
                {slotTaken && <p className="text-xs text-amber-700 mt-2">⚠️ この日時には既に別の予約があります。</p>}
              </div>

              {createError && <p className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{createError}</p>}
              {created ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-emerald-800 space-y-2">
                  <p className="font-semibold">
                    予約しました（予約ID {created.id}：{created.personName}、{formatJst(created.scheduledAt)} JST）。
                  </p>
                  <p className="text-xs">指定日時になると、既存の自動投稿（Cron）がこの3枚とキャプションでInstagramへ投稿します。</p>
                  <div className="flex gap-4 text-xs">
                    <a href="/admin/instagram-schedule" className="text-violet-700 font-semibold hover:underline">予約一覧を見る →</a>
                    <a href="/admin/instagram" className="text-violet-700 font-semibold hover:underline">Instagram管理へ →</a>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end pt-2 border-t border-gray-100">
                  <button
                    onClick={reserve}
                    disabled={creating || isPast || !caption.trim() || caption.length > CAPTION_MAX}
                    className="text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-40"
                  >
                    {creating ? '予約しています…' : '予約する'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
