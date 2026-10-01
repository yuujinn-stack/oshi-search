'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { safeFetchJson } from './safe-fetch-json';
import PersonMultiSelect from './PersonMultiSelect';
import CaptionEditor from './CaptionEditor';
import TemplatePlanSettings, { type TemplateMethod } from './TemplatePlanSettings';
import PostTimesEditor from './PostTimesEditor';
import { SCHEDULE_TEMPLATE_OPTIONS, DEFAULT_INSTAGRAM_TEMPLATE_ID, AUTO_TEMPLATE_ID, H_TEMPLATE_ID, getScheduleTemplateMeta } from '@/lib/instagram-templates';
import { validateCaption } from '@/lib/instagram-caption-rules';
import { allocateBulkSlots, formatJst, nowJstParts, type BulkSlotAssignment } from '@/lib/jst-time';
import { defaultPostTimes, sortPostTimes, validatePostTimes, evaluatePublishingQuota, type PublishingQuota } from '@/lib/instagram-post-times';
import { assignTemplatesToSlots, pastSlotIsos, type TemplatePlanRule } from '@/lib/instagram-template-plan';

interface PostImage {
  /** 1から始まる並び順（Jは4枚） */
  order: number;
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
  images: PostImage[];
  works: PostWork[];
  caption: string;
  hashtags: string;
  templateId: string;
  /** J が条件を満たさず H・G で作成した場合の理由 */
  fallbackReason?: string;
}

interface BulkRow {
  personName: string;
  scheduledAtIso: string;
  genStatus: 'pending' | 'generating' | 'ready' | 'error';
  prepared?: PrepareResult;
  /** 人物固定・テンプレを変えるモードで、この枠に割り当てたテンプレートID（従来モードでは未使用） */
  templateId?: string;
  /** 生成時のキャプション（編集欄の「生成時のキャプションに戻す」用） */
  originalCaption?: string;
  error?: string;
  excluded: boolean;
}

interface Props {
  persons: PersonOption[];
  /** 最初に選択しておくテンプレートID（?template=… から。未指定なら従来どおり標準） */
  initialTemplateId?: string;
  /** 一括予約完了後に呼ばれる（親側で予約一覧の再取得トリガーに使う） */
  onBulkCreated: () => void;
}

/** 「1週間分を作成」モードの対象日数 */
const WEEK_DAYS = 7;

export default function BulkScheduleClient({ persons, initialTemplateId, onBulkCreated }: Props) {
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  // 複数選択から人物固定モードへ切り替えて先頭1人に絞ったときの案内（選択を変えるか、モードを戻すと消える）
  const [placementNote, setPlacementNote] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState(initialTemplateId ?? DEFAULT_INSTAGRAM_TEMPLATE_ID);
  const [startDate, setStartDate] = useState(nowJstParts().date);

  // 「通常」＝従来通り開始日から件数ぶん連続で埋める。「week」＝1週間(7日)×1日あたり件数の枠に限定する。
  const [bulkMode, setBulkMode] = useState<'normal' | 'week'>('normal');
  // 1日あたり投稿数（1〜10件）と投稿時刻（JST・1時間単位）。既定は従来と同じ3件（09:00 / 15:00 / 20:00）
  const [perDayCount, setPerDayCount] = useState(3);
  const [postTimes, setPostTimes] = useState<string[]>(() => defaultPostTimes(3));

  // 配置方法：「人物を変える・テンプレ固定」（従来どおり）／「人物固定・テンプレを変える」（人物1人に複数テンプレートを割り当てる）
  const [placement, setPlacement] = useState<'vary-person' | 'fixed-person'>('vary-person');
  const fixedPerson = placement === 'fixed-person';
  const [templateMethod, setTemplateMethod] = useState<TemplateMethod>('rotation');
  const [rotationTemplates, setRotationTemplates] = useState<string[]>([]);
  const [manualBySlot, setManualBySlot] = useState<Record<string, string>>({});
  const [manualSequence, setManualSequence] = useState<string[]>([]);

  const [postedNames, setPostedNames] = useState<Set<string>>(new Set());
  const [lastPostedAt, setLastPostedAt] = useState<Map<string, string>>(new Map());
  const [occupiedIsos, setOccupiedIsos] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Instagramの投稿上限（取得できなければ null ＋理由）。予約前の警告にだけ使う
  const [quota, setQuota] = useState<PublishingQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [generating, setGenerating] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedCount, setSubmittedCount] = useState<number | null>(null);

  const loadReferenceData = useCallback(() => {
    Promise.all([
      safeFetchJson<{ personNames: string[]; lastPostedAt?: Record<string, string> }>('/api/admin/instagram-schedule/posted-persons'),
      safeFetchJson<{ occupied: string[] }>('/api/admin/instagram-schedule/occupied-slots?days=120'),
    ])
      .then(([posted, occ]) => {
        setPostedNames(new Set(posted.personNames));
        setLastPostedAt(new Map(Object.entries(posted.lastPostedAt ?? {})));
        setOccupiedIsos(new Set(occ.occupied));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    safeFetchJson<PublishingQuota>('/api/admin/instagram-schedule/publishing-quota')
      .then((q) => { setQuota(q); setQuotaError(null); })
      .catch((err) => setQuotaError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    loadReferenceData();
  }, [loadReferenceData]);

  // 選択・開始日・テンプレート・モード・1日あたり件数が変わったら、生成済みプレビューは古くなるためリセットする
  useEffect(() => {
    setRows(null);
    setSubmittedCount(null);
  }, [selectedNames, startDate, templateId, bulkMode, perDayCount, postTimes, placement, templateMethod, rotationTemplates, manualBySlot, manualSequence]);

  function handleSelectPlacement(next: 'vary-person' | 'fixed-person') {
    setPlacement(next);
    // 人物固定モードは1人だけ（既に複数選んでいた場合は先頭の1人を残す）
    if (next === 'fixed-person') setSelectedNames((prev) => prev.slice(0, 1));
    setPlacementNote(next === 'fixed-person' && selectedNames.length > 1 ? '人物固定モードのため、先頭の1人だけを選択しました。' : null);
  }

  function handleSelectWeekMode() {
    setBulkMode('week');
    // 「自動（おすすめ）」をデフォルトにする（既に手動で選び直している場合はそのまま尊重してもよいが、
    // モード切替のタイミングでは明示的にautoへ戻す方が分かりやすいため統一する）。
    // ただしHは「自動」では選ばれないテンプレートのため、Hを選んでいる場合はHのままにする。
    setTemplateId((prev) => (prev === H_TEMPLATE_ID ? prev : AUTO_TEMPLATE_ID));
  }

  // 投稿時刻（昇順）。すべてのモードで、設定した時刻を1日の投稿枠として使う
  // （人物固定モードの件数：通常＝開始日の1日分、1週間分＝7日分）
  const timesError = validatePostTimes(postTimes, perDayCount);
  const dailySlots = useMemo(() => sortPostTimes(postTimes), [postTimes]);
  const todayJst = nowJstParts().date;
  const startDateError = startDate < todayJst ? '開始日に過去の日付は指定できません（今日以降を選んでください）。' : null;
  const maxSelectable = fixedPerson ? 1 : bulkMode === 'week' ? WEEK_DAYS * perDayCount : undefined;
  const overLimitCount = maxSelectable !== undefined ? Math.max(0, selectedNames.length - maxSelectable) : 0;

  const plan: BulkSlotAssignment[] = useMemo(() => {
    if (!occupiedIsos || selectedNames.length === 0 || timesError || startDateError) return [];
    // 予約済みの枠に加えて、現在時刻を過ぎた枠もスキップする（予約APIが過去日時を拒否するため）
    const skip = new Set([...occupiedIsos, ...pastSlotIsos(startDate, todayJst, dailySlots, new Date())]);
    // 人物固定モード：1日あたり投稿数 ×（通常=1日／1週間分=7日）の枠。
    // 従来モード：選んだ人物の人数ぶん（1週間分は上限まで）。人物より枠が多くても同じ人物を繰り返し使うことはない。
    const count = fixedPerson
      ? perDayCount * (bulkMode === 'week' ? WEEK_DAYS : 1)
      : maxSelectable !== undefined ? Math.min(selectedNames.length, maxSelectable) : selectedNames.length;
    try {
      return allocateBulkSlots(startDate, count, skip, dailySlots);
    } catch {
      return [];
    }
  }, [occupiedIsos, selectedNames.length, startDate, todayJst, dailySlots, maxSelectable, fixedPerson, perDayCount, bulkMode, timesError, startDateError]);

  // 人物・日時の入力チェック（両モード共通）
  const planError: string | null = timesError ?? startDateError ?? (occupiedIsos && selectedNames.length > 0 && plan.length === 0
    ? '予約できる空き枠がありません（予約済み・過去の枠を除くと0件です）。開始日や投稿時刻を変更してください。'
    : null);

  // Instagramの投稿上限に近づく場合の警告（予約済み＋今回の予約）
  const quotaWarnings = useMemo(
    () => (quota && occupiedIsos && plan.length > 0 ? evaluatePublishingQuota(quota, plan.map((a) => a.scheduledAtIso), [...occupiedIsos], new Date()) : []),
    [quota, occupiedIsos, plan],
  );

  // 人物固定モード：各枠のテンプレート（自動ローテーション／手動）。従来モードでは空
  const planTemplates: (string | null)[] = useMemo(() => {
    if (!fixedPerson) return [];
    const rule: TemplatePlanRule =
      templateMethod === 'rotation'
        ? { method: 'rotation', sequence: rotationTemplates }
        : bulkMode === 'week'
          ? { method: 'manual-sequence', sequence: manualSequence }
          : { method: 'manual-slot', bySlot: manualBySlot };
    return assignTemplatesToSlots(plan, rule);
  }, [fixedPerson, templateMethod, rotationTemplates, manualSequence, manualBySlot, bulkMode, plan]);

  // 人物固定モードの入力チェック（問題があれば生成ボタンを押せない）
  const fixedPersonError: string | null = !fixedPerson
    ? null
    : selectedNames.length === 0
      ? '人物を1人選択してください。'
      : templateMethod === 'rotation' && rotationTemplates.length === 0
        ? '使うテンプレートを1つ以上選択してください。'
        : templateMethod === 'manual' && bulkMode === 'week' && (manualSequence.length === 0 || manualSequence.some((x) => !x))
          ? 'テンプレート列を1つ以上追加し、すべての行でテンプレートを選択してください。'
          : templateMethod === 'manual' && bulkMode !== 'week' && dailySlots.some((t) => !manualBySlot[t])
            ? 'すべての投稿枠にテンプレートを指定してください。'
            : planTemplates.some((t) => !t)
                ? 'テンプレートが決まっていない枠があります。'
                : null;

  async function generateOne(personName: string, scheduledAtIso: string, previousTemplateId: string | null, fixedTemplateId?: string): Promise<BulkRow> {
    try {
      // 人物固定モードでは枠ごとに割り当てたテンプレート、従来モードでは一律の選択値を使う
      const effectiveTemplateId = fixedTemplateId ?? templateId;
      const body: { personName: string; templateId: string; previousTemplateId?: string } = { personName, templateId: effectiveTemplateId };
      // 「自動」の場合のみ、同じバッチ内で直前に解決したテンプレートIDを渡し、
      // 連続で同じテンプレートにならないようローテーションさせる（手動指定時は無関係）。
      if (effectiveTemplateId === AUTO_TEMPLATE_ID && previousTemplateId) {
        body.previousTemplateId = previousTemplateId;
      }
      const data = await safeFetchJson<PrepareResult>('/api/admin/instagram-schedule/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { personName, scheduledAtIso, templateId: fixedTemplateId, genStatus: 'ready', prepared: data, originalCaption: data.caption, excluded: false };
    } catch (err) {
      return { personName, scheduledAtIso, templateId: fixedTemplateId, genStatus: 'error', error: err instanceof Error ? err.message : String(err), excluded: false };
    }
  }

  async function handleGenerateAll() {
    if (plan.length === 0) return;
    setGenerating(true);
    setSubmittedCount(null);
    const initial: BulkRow[] = plan.map((a, i) => ({
      personName: fixedPerson ? selectedNames[0] : selectedNames[a.index],
      scheduledAtIso: a.scheduledAtIso,
      templateId: fixedPerson ? planTemplates[i] ?? undefined : undefined,
      genStatus: 'pending',
      excluded: false,
    }));
    setRows(initial);

    let previousTemplateId: string | null = null;
    for (let i = 0; i < initial.length; i++) {
      setRows((prev) => prev?.map((r, idx) => (idx === i ? { ...r, genStatus: 'generating' } : r)) ?? prev);
      const result = await generateOne(initial[i].personName, initial[i].scheduledAtIso, previousTemplateId, initial[i].templateId);
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
    const result = await generateOne(target.personName, target.scheduledAtIso, previousTemplateId, target.templateId);
    setRows((prev) => prev?.map((r, i) => (i === index ? result : r)) ?? prev);
  }

  function updateCaption(index: number, caption: string) {
    setRows((prev) => prev?.map((r, i) => (i === index && r.prepared ? { ...r, prepared: { ...r.prepared, caption } } : r)) ?? prev);
  }

  function toggleExclude(index: number) {
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, excluded: !r.excluded } : r)) ?? prev);
  }

  const includedRows = useMemo(
    () => (rows ?? []).filter((r) => !r.excluded && r.genStatus === 'ready' && r.prepared),
    [rows],
  );
  // 編集したキャプションが上限を超えている行があれば一括予約させない（予約APIでも同じ判定で拒否される）
  const invalidCaptionCount = includedRows.filter((r) => validateCaption(r.prepared!.caption)).length;

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
      setPlacementNote(null);
      loadReferenceData(); // 空き枠を最新化
      onBulkCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // 確認モーダル用: 実際に予約する行（除外を除く）での投稿上限の警告
  const confirmQuotaWarnings = useMemo(
    () => (quota && occupiedIsos && includedRows.length > 0 ? evaluatePublishingQuota(quota, includedRows.map((r) => r.scheduledAtIso), [...occupiedIsos], new Date()) : []),
    [quota, occupiedIsos, includedRows],
  );

  // 確認モーダル用: 日付ごとにグループ化した要約
  const groupedByDate = useMemo(() => {
    const map = new Map<string, { timeJst: string; personName: string; templateLabel?: string }[]>();
    for (const row of includedRows) {
      const dateJst = formatJst(row.scheduledAtIso).split(' ')[0];
      const timeJst = formatJst(row.scheduledAtIso).split(' ')[1];
      if (!map.has(dateJst)) map.set(dateJst, []);
      map.get(dateJst)!.push({
        timeJst,
        personName: row.personName,
        templateLabel: fixedPerson ? getScheduleTemplateMeta(row.prepared!.templateId)?.label ?? row.prepared!.templateId : undefined,
      });
    }
    return Array.from(map.entries());
  }, [includedRows, fixedPerson]);

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{loadError}</div>
      )}

      {/* 1. モードを選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">1. モードを選択</h2>
        <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setBulkMode('normal')}
            className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
              bulkMode === 'normal' ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
            }`}
          >
            通常
          </button>
          <button
            type="button"
            onClick={handleSelectWeekMode}
            className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
              bulkMode === 'week' ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
            }`}
          >
            1週間分を作成
          </button>
        </div>
        {bulkMode === 'week' && !fixedPerson && (
          <p className="text-xs text-gray-500 mt-3">
            開始日から{WEEK_DAYS}日間、1日あたり{perDayCount}件（最大{WEEK_DAYS * perDayCount}人）の投稿をまとめて準備します。
            テンプレートは既定で「自動（おすすめ）」になります（手動固定に変更も可能です）。
          </p>
        )}

        <p className="text-xs font-semibold text-gray-500 mt-4 mb-1.5">配置方法</p>
        <div className="flex flex-wrap gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
          {([['vary-person', '人物を変える・テンプレ固定'], ['fixed-person', '人物固定・テンプレを変える']] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => handleSelectPlacement(v)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
                placement === v ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {fixedPerson && (
          <p className="text-xs text-gray-500 mt-3">
            1人の人物について、{bulkMode === 'week' ? `開始日から${WEEK_DAYS}日間` : '開始日の1日分'}、1日あたり{perDayCount}件
            （計{perDayCount * (bulkMode === 'week' ? WEEK_DAYS : 1)}件）の投稿を、枠ごとにテンプレートを変えて準備します。
          </p>
        )}
      </section>

      {/* 2. 人物を複数選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">{fixedPerson ? '2. 人物を1人選択' : '2. 人物を複数選択'}</h2>
        <PersonMultiSelect
          persons={persons}
          postedPersonNames={postedNames}
          lastPostedAt={lastPostedAt}
          selected={selectedNames}
          onChange={(next) => { setSelectedNames(next); setPlacementNote(null); }}
          maxSelected={maxSelectable}
          allowBulkSelect={!fixedPerson}
          notice={placementNote}
        />
        {overLimitCount > 0 && (
          <p className="text-xs text-amber-600 mt-2">
            選択人数が上限（{maxSelectable}人）を超えています。超過分（{overLimitCount}人、末尾側）は今回の生成対象に含まれません。
          </p>
        )}
      </section>

      {/* 3. 開始日・投稿数・テンプレートと自動配置プレビュー */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">3. 開始日・投稿数・テンプレートと自動配置プレビュー</h2>
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
          {!fixedPerson && (
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
          )}
        </div>
        {startDateError && <p className="text-xs text-red-600 -mt-2 mb-3">{startDateError}</p>}
        <div className="border border-gray-200 rounded-lg p-4 mb-4">
          <PostTimesEditor
            count={perDayCount}
            times={postTimes}
            error={timesError}
            onChange={(n, t) => { setPerDayCount(n); setPostTimes(t); }}
          />
        </div>
        {fixedPerson && (
          <TemplatePlanSettings
            method={templateMethod}
            onMethodChange={setTemplateMethod}
            weekMode={bulkMode === 'week'}
            dailySlots={dailySlots}
            rotation={rotationTemplates}
            onRotationChange={setRotationTemplates}
            bySlot={manualBySlot}
            onBySlotChange={setManualBySlot}
            sequence={manualSequence}
            onSequenceChange={setManualSequence}
          />
        )}
        <p className="text-xs text-gray-400 mb-2">
          1日{dailySlots.length}枠（{dailySlots.join(' / ')} JST）。既に予約済み（cancelledを除く）の枠と、現在時刻を過ぎた枠は自動でスキップし、次の空き枠へ配置します。
          {!fixedPerson && '人物より枠が多い場合も、同じ人物を繰り返し予約することはありません（選んだ人数ぶんだけ配置します）。'}
        </p>
        {/* 投稿時刻のエラーは時刻欄の下に出すため、ここでは開始日・空き枠・人物固定モードの入力不足だけを出す */}
        {selectedNames.length > 0 && !timesError && !startDateError && (planError || fixedPersonError) && (
          <p className="text-xs text-red-600 mb-2">{planError ?? fixedPersonError}</p>
        )}
        {quotaWarnings.map((w) => (
          <p key={w} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">⚠️ {w}</p>
        ))}
        {quotaError && plan.length > 0 && (
          <p className="text-[11px] text-gray-400 mb-2">Instagramの投稿上限を確認できませんでした（{quotaError}）。</p>
        )}
        {plan.length > 0 && (
          <p className="text-xs text-gray-500 mb-1">配置プレビュー：{plan.length}件</p>
        )}

        {selectedNames.length === 0 ? (
          <p className="text-xs text-gray-400">人物を選択すると配置プレビューが表示されます。</p>
        ) : !occupiedIsos ? (
          <p className="text-xs text-gray-400">空き枠を確認中...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-1.5 pr-3">日付</th>
                  <th className="py-1.5 pr-3">投稿予定時刻（JST）</th>
                  <th className="py-1.5 pr-3">人物</th>
                  <th className="py-1.5 pr-3">テンプレート</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((a, i) => (
                  <tr key={a.scheduledAtIso} className={`border-b ${i > 0 && plan[i - 1].dateJst !== a.dateJst ? 'border-t border-t-gray-200' : ''} border-gray-50`}>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{i === 0 || plan[i - 1].dateJst !== a.dateJst ? a.dateJst : ''}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-slate-700">{a.timeJst}</td>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{fixedPerson ? selectedNames[0] : selectedNames[a.index]}</td>
                    {fixedPerson ? (
                      <td className={`py-1.5 pr-3 ${planTemplates[i] ? 'text-violet-700' : 'text-red-500'}`}>
                        {planTemplates[i] ? getScheduleTemplateMeta(planTemplates[i]!)?.label ?? planTemplates[i] : '未指定'}
                      </td>
                    ) : (
                      <td className="py-1.5 pr-3 text-slate-600">
                        {templateId === AUTO_TEMPLATE_ID ? '自動（生成時に決定）' : getScheduleTemplateMeta(templateId)?.label ?? templateId}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. 一括生成 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">4. 投稿画像・キャプションを一括生成</h2>
        <p className="text-xs text-gray-500 mb-3">
          選択した人物ごとに、作品・配信先の取得、投稿画像3枚の生成、Vercel Blobへのアップロード、キャプション生成を順番に行います。
          <strong>この段階ではまだ予約されません（Instagramへの投稿も行いません）。</strong>
        </p>
        <button
          onClick={handleGenerateAll}
          disabled={generating || plan.length === 0 || !!planError || !!fixedPersonError}
          className="text-sm px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? '生成中...' : `${plan.length}件を一括生成`}
        </button>
      </section>

      {/* 5. プレビュー一覧 */}
      {rows && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-3">5. 一括プレビュー確認（{rows.length}件）</h2>
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
                      {templateId === AUTO_TEMPLATE_ID && !fixedPerson && row.genStatus === 'ready' && row.prepared && (
                        <span className="ml-2 text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 align-middle">
                          {getScheduleTemplateMeta(row.prepared.templateId)?.label ?? row.prepared.templateId}
                        </span>
                      )}
                      {fixedPerson && row.templateId && (
                        <span className="ml-2 text-xs font-semibold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 align-middle">
                          {getScheduleTemplateMeta(row.prepared?.templateId ?? row.templateId)?.label ?? row.templateId}
                        </span>
                      )}
                      {!fixedPerson && templateId !== AUTO_TEMPLATE_ID && row.prepared && row.prepared.templateId !== templateId && (
                        <span className="ml-2 text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 align-middle">
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
                {row.genStatus === 'ready' && row.prepared?.fallbackReason && (
                  <p className="text-xs text-amber-700 mt-2">⚠️ {row.prepared.fallbackReason}（予約は切り替えたテンプレートで保存されます）</p>
                )}

                {row.genStatus === 'ready' && row.prepared && (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2 flex items-start gap-1.5">
                      {row.prepared.images.map((img) => (
                        // テンプレートにより縦横比が異なる（Hは正方形）ため、切り抜かずにそのままの比率で表示する
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={img.order} href={img.url} target="_blank" rel="noreferrer" style={{ width: `${100 / row.prepared!.images.length}%` }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={`${row.personName} ${img.order}枚目`} className="w-full h-auto rounded border border-gray-200" />
                        </a>
                      ))}
                    </div>
                    <div className="sm:col-span-2 text-xs text-gray-600 space-y-1">
                      <CaptionEditor value={row.prepared.caption} original={row.originalCaption ?? row.prepared.caption} onChange={(c) => updateCaption(i, c)} rows={6} />
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
              disabled={includedRows.length === 0 || generating || invalidCaptionCount > 0}
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

      {/* 6. 確認モーダル */}
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
                      <li key={it.timeJst + it.personName}>
                        {it.timeJst} {it.personName}
                        {it.templateLabel && <span className="text-xs text-violet-600 ml-2">{it.templateLabel}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {confirmQuotaWarnings.map((w) => (
                <div key={w} className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-900 font-semibold">⚠️ {w}</div>
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
