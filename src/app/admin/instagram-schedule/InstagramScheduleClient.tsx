'use client';

import { useState, useEffect, useCallback } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import { safeFetchJson } from './safe-fetch-json';
import ScheduleList from './ScheduleList';
import BulkScheduleClient from './BulkScheduleClient';
import { SCHEDULE_TEMPLATE_OPTIONS, DEFAULT_INSTAGRAM_TEMPLATE_ID, getScheduleTemplateMeta } from '@/lib/instagram-templates';
import { jstWallClockToUtcDate, nowJstParts } from '@/lib/jst-time';

interface PostImage {
  order: 1 | 2 | 3;
  url: string;
  fileName: string;
}

interface PostWork {
  title: string;
  vod: string;
}

interface PrepareResult {
  personName: string;
  personPhotoUrl: string;
  images: [PostImage, PostImage, PostImage];
  works: PostWork[];
  caption: string;
  hashtags: string;
  templateId: string;
}

interface Props {
  persons: PersonOption[];
}

// 1日3枠運用（09:00 / 15:00 / 20:00 JST）のおすすめ投稿時間。
// Vercel Hobbyプランのcron 1日1回制限に合わせて、この3時刻それぞれに専用のCron Jobを
// 割り当てる想定（vercel.jsonへの反映は別途）。
const RECOMMENDED_TIMES = ['09:00', '15:00', '20:00'] as const;

export default function InstagramScheduleClient({ persons }: Props) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');

  // ?mode=bulk が付いていれば一括予約タブを直接開く（Instagram管理ハブからの導線用）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'bulk') setMode('bulk');
  }, []);

  const [personName, setPersonName] = useState('');
  const [templateId, setTemplateId] = useState(DEFAULT_INSTAGRAM_TEMPLATE_ID);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoChecking, setPhotoChecking] = useState(false);

  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PrepareResult | null>(null);

  const initialJst = nowJstParts();
  const [scheduleDate, setScheduleDate] = useState(initialJst.date);
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdOk, setCreatedOk] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);

  const selectedTemplate = getScheduleTemplateMeta(templateId);

  // 人物 or テンプレートを変えたら、それまでの写真確認・生成結果はリセットする
  useEffect(() => {
    setPrepared(null);
    setPrepareError(null);
    setCreateError(null);
    setCreatedOk(false);
    setPhotoUrl(null);

    if (!personName || !selectedTemplate?.requiresPersonPhoto) return;

    setPhotoChecking(true);
    safeFetchJson<{ photoUrl: string | null }>(`/api/admin/instagram-post/photo?personName=${encodeURIComponent(personName)}`)
      .then((data) => setPhotoUrl(data.photoUrl ?? null))
      .catch(() => setPhotoUrl(null))
      .finally(() => setPhotoChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personName, templateId]);

  const handlePrepare = useCallback(async () => {
    if (!personName) return;
    setPreparing(true);
    setPrepareError(null);
    setPrepared(null);
    setCreatedOk(false);
    try {
      const data = await safeFetchJson<PrepareResult>('/api/admin/instagram-schedule/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName, templateId }),
      });
      setPrepared(data);
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreparing(false);
    }
  }, [personName, templateId]);

  const nowParts = nowJstParts();
  const isPastSelection =
    scheduleDate < nowParts.date || (scheduleDate === nowParts.date && scheduleTime <= nowParts.time);

  async function handleCreateSchedule() {
    if (!prepared) return;
    setCreating(true);
    setCreateError(null);
    try {
      const scheduledAtUtc = jstWallClockToUtcDate(scheduleDate, scheduleTime);
      await safeFetchJson('/api/admin/instagram-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: prepared.personName,
          templateId: prepared.templateId,
          scheduledAtIso: scheduledAtUtc.toISOString(),
          caption: prepared.caption,
          hashtags: prepared.hashtags,
          imageUrls: prepared.images.map((img) => img.url),
        }),
      });
      setCreatedOk(true);
      setPrepared(null);
      setPersonName('');
      setReloadToken((v) => v + 1);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  const photoBlocking = !!selectedTemplate?.requiresPersonPhoto && !photoChecking && !photoUrl && !!personName;
  const canPrepare = !!personName && !preparing && (!selectedTemplate?.requiresPersonPhoto || (!photoChecking && !!photoUrl));

  return (
    <div className="space-y-6">
      {/* モード切替: 通常予約 / 一括予約 */}
      <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
            mode === 'single' ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
          }`}
        >
          通常予約
        </button>
        <button
          type="button"
          onClick={() => setMode('bulk')}
          className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
            mode === 'bulk' ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
          }`}
        >
          一括予約
        </button>
      </div>

      {mode === 'bulk' && (
        <BulkScheduleClient persons={persons} onBulkCreated={() => setReloadToken((v) => v + 1)} />
      )}

      {mode === 'single' && (
      <>
      {/* 1. 人物・テンプレート選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">1. 人物・テンプレートを選択</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">人物</label>
            <PersonCombobox persons={persons} value={personName} onChange={setPersonName} placeholder="人物名で検索..." />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">投稿テンプレート</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              {SCHEDULE_TEMPLATE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {personName && selectedTemplate?.requiresPersonPhoto && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-2">人物写真</p>
            {photoChecking ? (
              <p className="text-xs text-gray-400">確認中...</p>
            ) : photoUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="人物写真" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                <p className="text-xs text-emerald-600">登録済み</p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                人物写真が未登録です。/admin/instagram-post で先に人物写真をアップロードしてください（このテンプレートは人物写真が必須です）。
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. 投稿内容を作成 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">2. 投稿画像・キャプションを作成</h2>
        <p className="text-xs text-gray-500 mb-3">
          作品・配信先の取得、投稿画像3枚の生成、Vercel Blobへのアップロード、キャプション生成までを行います。
          <strong>この段階ではまだ予約されません（Instagramへの投稿も行いません）。</strong>
        </p>
        <button
          onClick={handlePrepare}
          disabled={!canPrepare}
          className="text-sm px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {preparing ? '生成中...（数十秒かかります）' : prepared ? '🔄 画像を再生成' : '投稿画像を生成'}
        </button>
        {photoBlocking && (
          <p className="text-xs text-red-600 mt-2">人物写真が未登録のため生成できません。</p>
        )}
        {prepareError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            <p className="font-semibold mb-1">生成に失敗しました</p>
            <p className="text-xs">{prepareError}</p>
          </div>
        )}
      </section>

      {/* 3. プレビュー・日時指定・予約 */}
      {prepared && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-700">3. プレビュー確認・予約日時の指定</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {prepared.images.map((img) => (
              <div key={img.order} className="space-y-1">
                <p className="text-xs font-semibold text-gray-500">{img.order}枚目</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={`投稿画像${img.order}枚目`} className="w-full rounded-lg border border-gray-200 object-cover aspect-[4/5]" />
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">使用している作品・配信サービス</p>
            <ul className="text-sm text-slate-700 space-y-1">
              {prepared.works.map((w) => (
                <li key={w.title}>・{w.title}（<span className="text-gray-500">{w.vod}</span>）</li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">キャプション</p>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap">{prepared.caption}</div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">ハッシュタグ</p>
            <p className="text-sm text-indigo-600">{prepared.hashtags}</p>
          </div>

          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-2">投稿予定日時（Asia/Tokyo）</p>

            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-400 mr-1">おすすめ投稿時間:</span>
              {RECOMMENDED_TIMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setScheduleTime(t)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    scheduleTime === t
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2"
              />
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2"
              />
              <span className="text-xs text-gray-400">JST</span>
            </div>

            {!(RECOMMENDED_TIMES as readonly string[]).includes(scheduleTime) && (
              <p className="text-xs text-amber-600 mt-2">
                ⚠️ おすすめ時間（09:00 / 15:00 / 20:00）以外の時刻です。HobbyプランではCronが1日3回のため、
                自由時刻を指定すると次回のCron実行時（最大約1時間の誤差あり）に投稿されます。
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              ※ Vercel Hobbyプランの制約上、実際の投稿時刻は指定時刻から最大約1時間ずれる場合があります。
            </p>

            {isPastSelection && (
              <p className="text-xs text-red-600 mt-2">過去の日時は予約できません。未来の日時を指定してください。</p>
            )}
          </div>

          {createError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{createError}</div>
          )}

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              onClick={handleCreateSchedule}
              disabled={creating || isPastSelection}
              className="text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? '予約登録中...' : '📅 この内容で予約する'}
            </button>
          </div>
        </section>
      )}

      {createdOk && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
          ✅ 予約を登録しました。下の一覧に反映されています。
        </div>
      )}
      </>
      )}

      {/* 4. 予約一覧（通常予約・一括予約どちらのモードでも表示） */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">予約一覧</h2>
        <ScheduleList reloadToken={reloadToken} />
      </section>
    </div>
  );
}
