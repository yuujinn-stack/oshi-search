'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { safeFetchJson } from './safe-fetch-json';
import PersonMultiSelect from './PersonMultiSelect';
import { SCHEDULE_TEMPLATE_OPTIONS, DEFAULT_INSTAGRAM_TEMPLATE_ID, AUTO_TEMPLATE_ID, getScheduleTemplateMeta } from '@/lib/instagram-templates';
import { allocateBulkSlots, formatJst, nowJstParts, type BulkSlotAssignment } from '@/lib/jst-time';

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

interface BulkRow {
  personName: string;
  scheduledAtIso: string;
  genStatus: 'pending' | 'generating' | 'ready' | 'error';
  prepared?: PrepareResult;
  error?: string;
  excluded: boolean;
}

interface Props {
  persons: PersonOption[];
  /** 一括予約完了後に呼ばれる（親側で予約一覧の再取得トリガーに使う） */
  onBulkCreated: () => void;
}

export default function BulkScheduleClient({ persons, onBulkCreated }: Props) {
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState(DEFAULT_INSTAGRAM_TEMPLATE_ID);
  const [startDate, setStartDate] = useState(nowJstParts().date);

  const [postedNames, setPostedNames] = useState<Set<string>>(new Set());
  const [occupiedIsos, setOccupiedIsos] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState<number | null>(null);

  const loadReferenceData = useCallback(() => {
    Promise.all([
      safeFetchJson<{ personNames: string[] }>('/api/admin/instagram-schedule/posted-persons'),
      safeFetchJson<{ occupied: string[] }>('/api/admin/instagram-schedule/occupied-slots?days=120'),
    ])
      .then(([posted, occ]) => {
        setPostedNames(new Set(posted.personNames));
        setOccupiedIsos(new Set(occ.occupied));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // 選択・開始日・テンプレートが変わったら、生成済みプレビューは古くなるためリセットする
  useEffect(() => {
    setRows(null);
    setSubmittedCount(null);
  }, [selectedNames, startDate, templateId]);

  const plan: BulkSlotAssignment[] = useMemo(() => {
    if (!occupiedIsos || selectedNames.length === 0) return [];
    try {
      return allocateBulkSlots(startDate, selectedNames.length, occupiedIsos);
    } catch {
      return [];
    }
  }, [occupiedIsos, selectedNames.length, startDate]);

  async function generateOne(personName: string, scheduledAtIso: string, previousTemplateId: string | null): Promise<BulkRow> {
    try {
      const body: { personName: string; templateId: string; previousTemplateId?: string } = { personName, templateId };
      // 「自動」の場合のみ、同じバッチ内で直前に解決したテンプレートIDを渡し、
      // 連続で同じテンプレートにならないようローテーションさせる（手動指定時は無関係）。
      if (templateId === AUTO_TEMPLATE_ID && previousTemplateId) {
        body.previousTemplateId = previousTemplateId;
      }
      const data = await safeFetchJson<PrepareResult>('/api/admin/instagram-schedule/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { personName, scheduledAtIso, genStatus: 'ready', prepared: data, excluded: false };
    } catch (err) {
      return { personName, scheduledAtIso, genStatus: 'error', error: err instanceof Error ? err.message : String(err), excluded: false };
    }
  }

  async function handleGenerateAll() {
    if (plan.length === 0) return;
    setGenerating(true);
    setSubmittedCount(null);
    const initial: BulkRow[] = plan.map((a) => ({
      personName: selectedNames[a.index],
      scheduledAtIso: a.scheduledAtIso,
      genStatus: 'pending',
      excluded: false,
    }));
    setRows(initial);

    let previousTemplateId: string | null = null;
    for (let i = 0; i < initial.length; i++) {
      setRows((prev) => prev?.map((r, idx) => (idx === i ? { ...r, genStatus: 'generating' } : r)) ?? prev);
      const result = await generateOne(initial[i].personName, initial[i].scheduledAtIso, previousTemplateId);
      setRows((prev) => prev?.map((r, idx) => (idx === i ? result : r)) ?? prev);
      if (result.genStatus === 'ready' && result.prepared) {
        previousTemplateId = result.prepared.templateId;
      }
    }
    setGenerating(false);
  }

  async function handleRegenerate(index: number) {
    if (!rows) return;
    const target = rows[index];
    // 直前の行（存在すれば）が解決済みのテンプレートIDをローテーションの基準にする
    const previousTemplateId = index > 0 ? rows[index - 1].prepared?.templateId ?? null : null;
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, genStatus: 'generating', error: undefined } : r)) ?? prev);
    const result = await generateOne(target.personName, target.scheduledAtIso, previousTemplateId);
    setRows((prev) => prev?.map((r, i) => (i === index ? result : r)) ?? prev);
  }

  function toggleExclude(index: number) {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, excluded: !r.excluded } : r)) ?? prev);
  }

  const includedRows = useMemo(
    () => (rows ?? []).filter((r) => !r.excluded && r.genStatus === 'ready' && r.prepared),
    [rows],
  );

  async function handleConfirmBulkCreate() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items = includedRows.map((r) => ({
        personName: r.personName,
        // 「自動」で行ごとに異なるテンプレートへ解決されている場合があるため、
        // 一律の選択値ではなく、各行がprepareで実際に解決した結果のtemplateIdを使う
        // （手動でテンプレートを指定した場合はprepared.templateIdも同じ値になるため挙動は変わらない）。
        templateId: r.prepared!.templateId,
        scheduledAtIso: r.scheduledAtIso,
        caption: r.prepared!.caption,
        hashtags: r.prepared!.hashtags,
        imageUrls: r.prepared!.images.map((img) => img.url),
      }));
      const data = await safeFetchJson<{ schedules: unknown[] }>('/api/admin/instagram-schedule/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      setSubmittedCount(data.schedules.length);
      setConfirmOpen(false);
      setRows(null);
      setSelectedNames([]);
      loadReferenceData(); // 空き枠を最新化
      onBulkCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // 確認モーダル用: 日付ごとにグループ化した要約
  const groupedByDate = useMemo(() => {
    const map = new Map<string, { timeJst: string; personName: string }[]>();
    for (const row of includedRows) {
      const dateJst = formatJst(row.scheduledAtIso).split(' ')[0];
      const timeJst = formatJst(row.scheduledAtIso).split(' ')[1];
      if (!map.has(dateJst)) map.set(dateJst, []);
      map.get(dateJst)!.push({ timeJst, personName: row.personName });
    }
    return Array.from(map.entries());
  }, [includedRows]);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{loadError}</div>
      )}

      {/* 1. 人物を複数選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">1. 人物を複数選択</h2>
        <PersonMultiSelect
          persons={persons}
          postedPersonNames={postedNames}
          selected={selectedNames}
          onChange={setSelectedNames}
        />
      </section>

      {/* 2. 開始日・テンプレート・配置プレビュー */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">2. 開始日・テンプレートと自動配置プレビュー</h2>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">開始日（JST）</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">投稿テンプレート</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              {SCHEDULE_TEMPLATE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-2">
          1日3枠（09:00 / 15:00 / 20:00 JST）。既に予約済みの枠は自動でスキップし、次の空き枠へ配置します。
        </p>

        {selectedNames.length === 0 ? (
          <p className="text-xs text-gray-400">人物を選択すると配置プレビューが表示されます。</p>
        ) : !occupiedIsos ? (
          <p className="text-xs text-gray-400">空き枠を確認中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-1.5 pr-3">予定日時（JST）</th>
                  <th className="py-1.5 pr-3">人物</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((a) => (
                  <tr key={a.scheduledAtIso} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-600">{a.dateJst} {a.timeJst}</td>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{selectedNames[a.index]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. 一括生成 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">3. 投稿画像・キャプションを一括生成</h2>
        <p className="text-xs text-gray-500 mb-3">
          選択した人物ごとに、作品・配信先の取得、投稿画像3枚の生成、Vercel Blobへのアップロード、キャプション生成を順番に行います。
          <strong>この段階ではまだ予約されません（Instagramへの投稿も行いません）。</strong>
        </p>
        <button
          onClick={handleGenerateAll}
          disabled={generating || plan.length === 0}
          className="text-sm px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? '生成中...' : `${plan.length}件を一括生成`}
        </button>
      </section>

      {/* 4. プレビュー一覧 */}
      {rows && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">4. 一括プレビュー確認</h2>
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div
                key={`${row.personName}-${row.scheduledAtIso}`}
                className={`border rounded-lg p-3 ${row.excluded ? 'border-gray-200 bg-gray-50 opacity-50' : 'border-gray-200'}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {row.personName}
                      {templateId === AUTO_TEMPLATE_ID && row.genStatus === 'ready' && row.prepared && (
                        <span className="ml-2 text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 align-middle">
                          {getScheduleTemplateMeta(row.prepared.templateId)?.label ?? row.prepared.templateId}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{formatJst(row.scheduledAtIso)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.genStatus === 'generating' && <span className="text-xs text-gray-400">生成中...</span>}
                    {row.genStatus === 'ready' && <span className="text-xs text-emerald-600 font-semibold">✓ 準備完了</span>}
                    {row.genStatus === 'error' && <span className="text-xs text-red-600 font-semibold">エラー</span>}
                    {row.genStatus !== 'generating' && (
                      <button
                        onClick={() => handleRegenerate(i)}
                        className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
                      >
                        🔄 再生成
                      </button>
                    )}
                    <button
                      onClick={() => toggleExclude(i)}
                      className={`text-xs px-3 py-1 rounded-md ${row.excluded ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {row.excluded ? '除外を解除' : '除外する'}
                    </button>
                  </div>
                </div>

                {row.genStatus === 'error' && (
                  <p className="text-xs text-red-600 mt-2">{row.error}</p>
                )}

                {row.genStatus === 'ready' && row.prepared && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-1 flex gap-1.5">
                      {row.prepared.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={img.order} src={img.url} alt="" className="w-1/3 rounded border border-gray-200 object-cover aspect-[4/5]" />
                      ))}
                    </div>
                    <div className="sm:col-span-3 text-xs text-gray-600 space-y-1">
                      <p className="whitespace-pre-wrap line-clamp-3">{row.prepared.caption}</p>
                      <p className="text-indigo-600">{row.prepared.hashtags}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {submitError && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{submitError}</div>
          )}

          <div className="flex justify-end pt-4 mt-4 border-t border-gray-100">
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={includedRows.length === 0 || generating}
              className="text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {includedRows.length}件を一括予約
            </button>
          </div>
        </section>
      )}

      {submittedCount !== null && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
          ✅ {submittedCount}件を一括予約しました。
        </div>
      )}

      {/* 7. 確認モーダル */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-slate-800">一括予約の確認</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <p className="text-sm font-semibold text-slate-800">
                {includedRows.length}件をInstagram予約に登録します。
              </p>
              {groupedByDate.map(([date, items]) => (
                <div key={date}>
                  <p className="text-xs font-bold text-gray-500 mb-1">{date}</p>
                  <ul className="text-sm text-slate-700 space-y-0.5 pl-2">
                    {items.map((it) => (
                      <li key={it.timeJst + it.personName}>{it.timeJst} {it.personName}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                この時点ではInstagramへは投稿されません。指定日時になったら自動投稿の設定に従って処理されます。
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmBulkCreate}
                disabled={submitting}
                className="text-sm px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50"
              >
                {submitting ? '登録中...' : '一括予約'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
