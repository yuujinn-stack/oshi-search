'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import {
  COLOR_PRESETS,
  DEFAULT_DESIGN,
  FONT_STACKS,
  LINK_POSITIONS,
  SLIDE_COUNTS,
  SLIDE_TEXT_FIELDS,
  STORY_TEMPLATES,
  fillStoryText,
  getStoryTemplate,
  linkTargetOptions,
  screenshotPathOptions,
  structureLabel,
  structureSlideCount,
  structureSlides,
  bfStructureSlides,
  editSlotIndex,
  isBfTemplate,
  type ColorPresetId,
  type FontId,
  type ImageSlot,
  type LinkPosition,
  type SlideDef,
  type SlideText,
  type StoryDesign,
  type StoryStructure,
  type StoryTarget,
  type StoryTemplateId,
} from '@/lib/story-maker/templates';
import { AB_CTA_A_DEFAULT, AB_TESTS, applyAbVariant, type AbSettings, type StoryVariantConfig } from '@/lib/story-maker/ab';
import { appendUtm, buildStoryUtm, isSiteUrl, storyFileName, storyZipName, suggestTargetKey, type AbTestKey, type AbVariant } from '@/lib/story-maker/utm';
import {
  AUTO_CARD_VARIANTS,
  autoImageCaption,
  autoImageOwnerKey,
  autoImagePlan,
  describeImageResponseError,
  isAutoSupported,
  memberPickMode,
  type AutoCardVariant,
} from '@/lib/story-maker/auto';
import { buildServicesPanel, panelSignature, type ProductPanelItem, type StoryPanel } from '@/lib/story-maker/panels';
import { StoryScaled, StorySlide, type ImageFit, type SlideImage } from './StorySlide';
import { STORY_H, downloadBlob, downloadZip, renderStoryElementPng } from './png-export';
import BfSalePanel, { type BfPanelState } from './BfSalePanel';
import type { RecordSlideCount } from '@/lib/story-maker/metrics';
import { STORY_MAKER_FROM, type StoryMakerInitial } from '@/lib/story-maker/open-link';
import { BF_STORY_MAX_ITEMS, bfProductPageCount, bfSalePeriodLabel, bfStoryItems, checkedAtLabel, maxOffRate, type BfSlideData } from '@/lib/story-maker/bf-sale';
import StoryMetricsPanel, { type MetricsDraftContext } from './StoryMetricsPanel';

export interface GroupChoice {
  name: string;
  pagePath: string;
  slug?: string;
  /** 所属メンバー（グループページと同じ判定。自動作成でメンバーを選ぶときに使う） */
  members?: { name: string; current: boolean }[];
}

/** 自動作成の段階（失敗したらどの段階かを表示する） */
const AUTO_STAGES = [
  { id: 'check', label: 'テンプレートと推しを確認' },
  { id: 'fetch', label: 'サイトの実画像を取得' },
  { id: 'text', label: '文章を作成' },
  { id: 'place', label: '画像を配置' },
  { id: 'render', label: 'ストーリーズ画像を作成' },
  { id: 'done', label: 'プレビュー・保存の準備' },
] as const;
type AutoStageId = (typeof AUTO_STAGES)[number]['id'];
interface AutoStatus {
  stage: AutoStageId;
  state: 'running' | 'done' | 'error';
  text: string;
}
/** 自動取得のタイムアウト（画像APIはサーバーで描画するため、初回は数秒かかることがある） */
const AUTO_FETCH_TIMEOUT_MS = 25_000;
/** B の商品データを同じ推しで作り直すときは取得し直さない（10分） */
const GOODS_CACHE_MS = 10 * 60_000;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

type EditMap = Record<string, Partial<SlideText>>;

/** 1枚完結版での各文言の置き場所（項目名を置き場所に合わせて表示する） */
const SINGLE_FIELD_LABELS: Partial<Record<keyof SlideText, string>> = {
  subheading: '見出しの下の一言',
  body: '説明文（画像・スタンプの下）',
  stickerCaption: 'CTAの1行目（矢印の行の上）',
  cta: 'CTA文言（↓ ◯◯ ↓）',
  note: '補足文（いちばん下）',
};
type ImageMap = Record<string, SlideImage>;

const editKey = (t: StoryTemplateId, count: StoryStructure, i: number) => `${t}:${count}:${i}`;
const imageKey = (t: StoryTemplateId, slot: ImageSlot) => `${t}:${slot}`;

/** 1つのパターン（A/B 無しなら1つ）を描くのに必要な値 */
interface ResolvedSlide {
  index: number;
  def: SlideDef;
  rawText: SlideText;
  text: SlideText;
  image: SlideImage | null;
  missingImage: boolean;
}

function resolveSlides(
  templateId: StoryTemplateId,
  cfg: StoryVariantConfig,
  edits: EditMap,
  images: ImageMap,
  target: StoryTarget | null,
  /** 楽天BF：採用した商品の数（商品ページの枚数＝3件まで1枚・4〜6件で2枚）。他のテンプレートは使わない */
  bfItemCount = 0,
): ResolvedSlide[] {
  const tpl = getStoryTemplate(templateId);
  const t = tpl.usesTarget ? target : null;
  const defs = templateId === 'bf' ? bfStructureSlides(bfProductPageCount(bfItemCount)) : structureSlides(tpl, cfg.slides);
  return defs.map((def, index) => {
    const rawText: SlideText = { ...def.text, ...edits[editKey(templateId, cfg.slides, editSlotIndex(def, index))] };
    const filled = Object.fromEntries(Object.entries(rawText).map(([k, v]) => [k, fillStoryText(v, t)])) as unknown as SlideText;
    if (cfg.ctaOverride && def.sticker === 'link') filled.cta = cfg.ctaOverride;
    const image = def.imageSlot ? images[imageKey(templateId, def.imageSlot)] ?? null : null;
    return { index, def, rawText, text: filled, image, missingImage: def.image === 'required' && !image };
  });
}

function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-bold text-slate-800 flex items-center gap-2">
          <span className="inline-flex w-6 h-6 rounded-full bg-amber-400 text-white text-xs items-center justify-center font-black">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Pill({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-full text-sm border transition ${active ? 'bg-amber-400 border-amber-400 text-white font-bold' : 'bg-white border-gray-300 text-gray-700 hover:border-amber-400'} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text, label = 'コピー' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch { /* クリップボード不可 */ }
      }}
      className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-700"
    >
      {done ? 'コピーしました' : label}
    </button>
  );
}

/** プレビュー内の [data-fit-area] のはみ出しを調べる */
function useOverflowCheck(deps: unknown[]): [React.RefObject<HTMLDivElement | null>, number[]] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [over, setOver] = useState<number[]>([]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const bad: number[] = [];
      root.querySelectorAll<HTMLElement>('[data-slide-index]').forEach((el) => {
        const i = Number(el.dataset.slideIndex);
        const areas = el.querySelectorAll<HTMLElement>('[data-fit-area]');
        if (Array.from(areas).some((a) => a.scrollHeight > a.clientHeight + 2 || a.scrollWidth > a.clientWidth + 2)) bad.push(i);
      });
      setOver(bad);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, over];
}

export default function StoryMakerClient({ persons, groups, initial }: { persons: PersonOption[]; groups: GroupChoice[]; initial?: StoryMakerInitial }) {
  // 他の管理画面からのリンクで開いたときだけ、テンプレート・対象を選んだ状態で始める（無ければ従来どおり A・グループ未選択）
  const [templateId, setTemplateId] = useState<StoryTemplateId>(initial?.templateId ?? 'vod');
  const tpl = getStoryTemplate(templateId);

  // ② 対象
  const [targetType, setTargetType] = useState<'person' | 'group'>(initial?.targetType ?? 'group');
  const [personName, setPersonName] = useState(initial?.targetType === 'person' ? initial.name : '');
  const [groupName, setGroupName] = useState(initial?.targetType === 'group' ? initial.name : '');
  const target: StoryTarget | null = useMemo(() => {
    if (targetType === 'person' && personName) return { type: 'person', name: personName, pagePath: `/person/${encodeURIComponent(personName)}` };
    if (targetType === 'group' && groupName) {
      const g = groups.find((x) => x.name === groupName);
      if (g) return { type: 'group', name: g.name, pagePath: g.pagePath, slug: g.slug };
    }
    return null;
  }, [targetType, personName, groupName, groups]);

  // ③ 枚数・デザイン
  const [slides, setSlides] = useState<StoryStructure>(tpl.defaultSlides);
  const [design, setDesign] = useState<StoryDesign>(DEFAULT_DESIGN);
  const [ab, setAb] = useState<AbSettings | null>(null);
  const [viewVariant, setViewVariant] = useState<AbVariant>('a');

  // ④ テキスト・画像
  const [edits, setEdits] = useState<EditMap>({});
  const [images, setImages] = useState<ImageMap>({});
  const [selected, setSelected] = useState(0);
  const [questionText, setQuestionText] = useState('追加してほしいのは誰？');

  // ⑤ プレビュー
  const [showGuide, setShowGuide] = useState(true);

  // ⑦ URL
  const [linkTargetId, setLinkTargetId] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [targetKeyInput, setTargetKeyInput] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // 自動作成
  const [memberPicks, setMemberPicks] = useState<string[]>([]);
  const [cardVariant, setCardVariant] = useState<AutoCardVariant>('basic');
  const [autoStatus, setAutoStatus] = useState<AutoStatus | null>(null);
  const [autoFiles, setAutoFiles] = useState<{ files: { name: string; blob: Blob }[]; sig: string } | null>(null);
  /** 自動取得した画像の持ち主（imageKey → 対象・設定）。対象を変えたら外す。手動の画像は含めない */
  const autoOwners = useRef<Record<string, string>>({});
  /** 二重クリック防止（state の更新を待たずに止める） */
  const autoLock = useRef(false);
  /** B の商品データ（取得先URL → 取得結果）。同じ推しで何度押しても再取得しない */
  const goodsCache = useRef<Map<string, { at: number; panel: StoryPanel; note: string }>>(new Map());
  // 楽天BF・推し別セール紹介：承認済みで「投稿に使う」商品（BfSalePanel から受け取る）
  const [bfState, setBfState] = useState<BfPanelState>({ items: [], blocked: '商品を選んでください。' });
  const frameH = tpl.frameHeight ?? STORY_H;
  const isBf = isBfTemplate(templateId);
  // ストーリーズ版は先頭3件だけ（最大割引率・確認日時もその商品だけから出す。承認していない商品は含まれない）
  const bfItems = templateId === 'bfstory' ? bfStoryItems(bfState.items) : bfState.items;
  const bfData: BfSlideData | undefined = isBf
    ? { items: bfItems, maxRate: maxOffRate(bfItems), periodLabel: bfSalePeriodLabel(), checkedLabel: checkedAtLabel(bfItems) }
    : undefined;
  const groupChoice = target?.type === 'group' ? groups.find((g) => g.name === target.name) ?? null : null;
  const pickMode = memberPickMode(templateId, target);

  function chooseStructure(s: StoryStructure) {
    setSlides(s);
    setSelected(0);
    // 1枚完結版はリンク位置が固定のため、リンク位置の A/B テストは使えない
    if (s === 'single' && ab?.test === 'link') setAb(null);
  }

  function selectTemplate(id: StoryTemplateId) {
    setTemplateId(id);
    setSlides(getStoryTemplate(id).defaultSlides);
    setSelected(0);
    setLinkTargetId('');
    setCustomUrl('');
    // 固定のテンプレート（楽天BF）は A/B テストを使わない
    if (getStoryTemplate(id).fixed) setAb(null);
    else if (ab && ab.test === 'cta') setAb({ ...ab, ctaB: '' });
  }

  const baseCfg: StoryVariantConfig = { slides, design, ctaOverride: null };
  const variants: AbVariant[] = ab ? ['a', 'b'] : ['a'];
  const cfgOf = (v: AbVariant) => applyAbVariant(baseCfg, ab, v);
  const viewCfg = cfgOf(ab ? viewVariant : 'a');
  const resolved = resolveSlides(templateId, viewCfg, edits, images, target, bfState.items.length);
  const sel = Math.min(selected, resolved.length - 1);
  const current = resolved[sel];

  // リンク先・UTM
  const linkOpts = linkTargetOptions(templateId, tpl.usesTarget ? target : null);
  const linkOpt = linkOpts.find((o) => o.id === linkTargetId) ?? linkOpts[0];
  const baseUrl = linkTargetId === 'custom' ? customUrl.trim() : linkOpt?.path ?? '/';
  const targetKey = targetKeyInput ?? suggestTargetKey(tpl.usesTarget ? target : null);
  const abOf = (v: AbVariant) => (ab ? { test: ab.test, variant: v } : null);
  const urlOf = (v: AbVariant) => {
    if (!baseUrl) return '';
    try {
      return appendUtm(baseUrl, buildStoryUtm(tpl, targetKey, cfgOf(v).slides, abOf(v)));
    } catch {
      return '';
    }
  };

  // テンプレート・対象が変わったら識別子の手入力をやめて自動に戻す
  useEffect(() => { setTargetKeyInput(null); }, [templateId, target?.name]);

  const [previewRef, overflowSlides] = useOverflowCheck([resolved.map((r) => JSON.stringify(r.text)).join('|'), viewCfg.slides, JSON.stringify(viewCfg.design), Object.keys(images).join(), bfData ? JSON.stringify(bfData.items.map((i) => i.productId)) : '']);

  function setText(field: keyof SlideText, value: string) {
    const k = editKey(templateId, viewCfg.slides, editSlotIndex(current.def, sel));
    setEdits((prev) => ({ ...prev, [k]: { ...prev[k], [field]: value } }));
  }
  function resetTexts() {
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${templateId}:`))));
  }

  async function onUpload(slot: ImageSlot, file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setMessage({ kind: 'error', text: 'PNG・JPEG・WebP の画像を選んでください。' }); return; }
    if (file.size > 12 * 1024 * 1024) { setMessage({ kind: 'error', text: '画像は12MBまでです。' }); return; }
    const src = await blobToDataUrl(file);
    delete autoOwners.current[imageKey(templateId, slot)];
    setImages((prev) => ({ ...prev, [imageKey(templateId, slot)]: { src, fit: prev[imageKey(templateId, slot)]?.fit ?? 'top' } }));
    setMessage({ kind: 'ok', text: '画像を差し替えました。' });
  }

  const [shotPath, setShotPath] = useState('');
  const [shotScroll, setShotScroll] = useState(0);
  async function onScreenshot(slot: ImageSlot, path: string) {
    setBusy('shot');
    setMessage(null);
    try {
      const res = await fetch('/api/admin/story-maker/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, scrollY: shotScroll }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `取得に失敗しました（${res.status}）`);
      }
      const src = await blobToDataUrl(await res.blob());
      delete autoOwners.current[imageKey(templateId, slot)];
      setImages((prev) => ({ ...prev, [imageKey(templateId, slot)]: { src, fit: prev[imageKey(templateId, slot)]?.fit ?? 'top' } }));
      setMessage({ kind: 'ok', text: `oshi-search.jp${path} の画面を取得しました。` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  function slideElement(r: ResolvedSlide, cfg: StoryVariantConfig, total: number, guide: boolean) {
    return (
      <StorySlide
        decoration={tpl.decoration}
        def={r.def}
        text={r.text}
        design={cfg.design}
        index={r.index}
        total={total}
        image={r.image}
        showGuide={guide}
        questionText={questionText}
        templateId={templateId}
        sale={bfData}
      />
    );
  }

  async function download(v: AbVariant, only?: number) {
    const cfg = cfgOf(v);
    const rs = resolveSlides(templateId, cfg, edits, images, target, bfState.items.length);
    const targets = only === undefined ? rs : rs.filter((r) => r.index === only);
    if (isBf && bfState.blocked) {
      setMessage({ kind: 'error', text: `保存できません：${bfState.blocked}` });
      return;
    }
    const missing = targets.filter((r) => r.missingImage);
    if (missing.length > 0) {
      setMessage({ kind: 'error', text: `${missing.map((r) => `${r.index + 1}枚目`).join('・')}の実際の画面が未設定です。スクリーンショットを取得するか、画像をアップロードしてください（架空の画面は出力しません）。` });
      return;
    }
    setBusy(`dl-${v}-${only ?? 'all'}`);
    setMessage(null);
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const r of targets) {
        const blob = await renderStoryElementPng(slideElement(r, cfg, rs.length, false), frameH);
        files.push({ name: storyFileName(tpl, targetKey, r.index, abOf(v)), blob });
      }
      if (files.length === 1) downloadBlob(files[0].blob, files[0].name);
      else await downloadZip(files, storyZipName(tpl, targetKey, abOf(v)));
      setMessage({ kind: 'ok', text: `${files.map((f) => f.name).join('、')} を保存しました。` });
    } catch (err) {
      setMessage({ kind: 'error', text: `画像の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(null);
    }
  }

  /** 自動作成した画像が、いまの文言・画像・設定と同じか（編集後は⑥の保存を使う） */
  const autoSigOf = (imgs: ImageMap) => JSON.stringify([
    templateId,
    target?.name ?? '',
    targetKey,
    questionText,
    variants.map((v) => {
      const cfg = cfgOf(v);
      return [cfg, resolveSlides(templateId, cfg, edits, imgs, target, bfState.items.length).map((r) => [r.text, r.image ? `${r.image.fit}:${r.image.caption ?? ''}:${r.image.panel ? panelSignature(r.image.panel) : ''}:${r.image.src.length}:${r.image.src.slice(-32)}` : null])];
    }),
  ]);
  const autoFilesFresh = autoFiles !== null && autoFiles.sig === autoSigOf(images);

  /**
   * ✨ ストーリーズを自動作成：確認 → 既存APIから実画像を1枚取得 → 文章 → 配置 → PNG作成（最大3枚×A/B）→ プレビュー。
   * 画像はブラウザで作る（サーバー・Mac で Chromium は起動しない）。失敗したら段階と理由を表示して止める。
   */
  async function runAuto() {
    if (autoLock.current || busy !== null) return;
    autoLock.current = true;
    setBusy('auto');
    setMessage(null);
    setAutoFiles(null);
    let stage: AutoStageId = 'check';
    const step = (s: AutoStageId, text: string) => { stage = s; setAutoStatus({ stage: s, state: 'running', text }); };
    try {
      step('check', 'テンプレートと推しを確認しています');
      const plan = autoImagePlan(templateId, target, { members: memberPicks, cardVariant });
      if (plan.kind === 'blocked' || plan.kind === 'unsupported') throw new Error(plan.reason);

      let fetched: { key: string; image: SlideImage; owner: string } | null = null;
      let panelNote = '';
      if (plan.kind === 'panel') {
        let panel: StoryPanel;
        if (plan.source === 'services') {
          step('fetch', 'グッズ制作比較ページの掲載内容を読み込んでいます');
          panel = buildServicesPanel();
        } else {
          step('fetch', `サイトの関連商品を取得しています（${plan.personNames.join('・')}）`);
          const cached = goodsCache.current.get(plan.url!);
          if (cached && Date.now() - cached.at < GOODS_CACHE_MS) {
            panel = cached.panel;
            panelNote = cached.note;
          } else {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), AUTO_FETCH_TIMEOUT_MS);
            let res: Response;
            try {
              res = await fetch(plan.url!, { signal: ctrl.signal, cache: 'no-store' });
            } catch {
              throw new Error(ctrl.signal.aborted ? `${AUTO_FETCH_TIMEOUT_MS / 1000}秒以内に商品データを取得できませんでした。時間をおいてもう一度お試しください。` : '商品データを取得できませんでした（通信エラー）。');
            } finally {
              clearTimeout(timer);
            }
            const j = (await res.json().catch(() => ({}))) as { error?: string; targetName?: string; items?: ProductPanelItem[]; totalOnSite?: number; imageFailures?: number };
            if (!res.ok || !Array.isArray(j.items) || j.items.length === 0) throw new Error(j.error ?? `商品データを取得できませんでした（HTTP ${res.status}）。`);
            panel = { kind: 'products', title: `${j.targetName ?? plan.personNames[0]}の関連商品`, items: j.items };
            panelNote = `サイトに公開中の関連商品${j.totalOnSite ?? j.items.length}件から${j.items.length}件を使用。${j.imageFailures ? `${j.imageFailures}件は商品画像を取得できなかったため、商品名とカテゴリのカードで表示しています。` : ''}`;
            goodsCache.current.set(plan.url!, { at: Date.now(), panel, note: panelNote });
          }
        }
        fetched = { key: imageKey(templateId, plan.slot), image: { src: '', fit: 'contain', panel }, owner: autoImageOwnerKey(templateId, target, plan) };
      } else if (plan.kind === 'fetch') {
        step('fetch', `サイト画面を取得しています（${plan.label}：${plan.personNames.join('・')}）`);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), AUTO_FETCH_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(plan.url, { signal: ctrl.signal, cache: 'no-store' });
        } catch {
          throw new Error(ctrl.signal.aborted ? `${AUTO_FETCH_TIMEOUT_MS / 1000}秒以内に画像を取得できませんでした。時間をおいてもう一度お試しください。` : '画像を取得できませんでした（通信エラー）。');
        } finally {
          clearTimeout(timer);
        }
        const bad = describeImageResponseError(res.status, res.headers.get('content-type'));
        if (bad) throw new Error(bad);
        const src = await blobToDataUrl(await res.blob());
        fetched = { key: imageKey(templateId, plan.slot), image: { src, fit: 'contain', caption: autoImageCaption(templateId, plan) }, owner: autoImageOwnerKey(templateId, target, plan) };
      }

      step('text', '文章を作成しています');
      const nextImages: ImageMap = fetched ? { ...images, [fetched.key]: fetched.image } : images;

      step('place', '画像を配置しています');
      if (fetched) {
        autoOwners.current[fetched.key] = fetched.owner;
        setImages(nextImages);
      }

      step('render', '画像を作成しています');
      const files: { name: string; blob: Blob }[] = [];
      for (const v of variants) {
        const cfg = cfgOf(v);
        const rs = resolveSlides(templateId, cfg, edits, nextImages, target, bfState.items.length);
        const missing = rs.filter((r) => r.missingImage);
        if (missing.length > 0) throw new Error(`${missing.map((r) => `${r.index + 1}枚目`).join('・')}に必要な画像がありません。`);
        for (const r of rs) {
          files.push({ name: storyFileName(tpl, targetKey, r.index, abOf(v)), blob: await renderStoryElementPng(slideElement(r, cfg, rs.length, false)) });
        }
      }

      setAutoFiles({ files, sig: autoSigOf(nextImages) });
      setSelected(0);
      const basis = plan.kind === 'panel' ? `${panelNote} ` : plan.kind === 'fetch' && target?.type === 'group' ? `${plan.label}は ${plan.personNames.join('・')} で作成（画像内にも名前が表示されます。9人以上は「ほか◯人」）。` : '';
      setAutoStatus({ stage: 'done', state: 'done', text: `ストーリーズが完成しました（${files.length}枚）。${basis}プレビューを確認して保存してください。文言・画像は下の③④で調整できます。` });
    } catch (err) {
      setAutoStatus({ stage, state: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
      autoLock.current = false;
    }
  }

  function saveAutoFiles() {
    if (!autoFiles || !autoFilesFresh) return;
    const { files } = autoFiles;
    if (files.length === 1) { downloadBlob(files[0].blob, files[0].name); return; }
    const name = ab ? storyZipName(tpl, targetKey, null).replace(/\.zip$/, `_${ab.test}_ab.zip`) : storyZipName(tpl, targetKey, null);
    void downloadZip(files, name)
      .then(() => setMessage({ kind: 'ok', text: `${name} を保存しました。` }))
      .catch((err) => setMessage({ kind: 'error', text: `画像の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}` }));
  }

  // グループを変えたらメンバーの選択を戻す（別グループのメンバーを使わない）
  useEffect(() => { setMemberPicks([]); }, [targetType, groupName]);

  // 推し・メンバー・カードのデザインが変わったら、前の推しの自動取得画像を外す（別の推しの画像で保存しない）
  useEffect(() => {
    const owners = autoOwners.current;
    const removed = Object.entries(owners)
      .filter(([k, owner]) => {
        const t = k.split(':')[0] as StoryTemplateId;
        return autoImageOwnerKey(t, target, autoImagePlan(t, target, { members: memberPicks, cardVariant })) !== owner;
      })
      .map(([k]) => k);
    if (removed.length === 0) return;
    for (const k of removed) delete owners[k];
    setImages((prev) => {
      const n = { ...prev };
      for (const k of removed) delete n[k];
      return n;
    });
    setAutoStatus(null);
    setMessage({ kind: 'ok', text: '推し・メンバー・カードのデザインが変わったため、前に自動取得した画像を外しました。もう一度「ストーリーズを自動作成」を押してください。' });
  }, [target, memberPicks, cardVariant]);

  const slotsInUse =Array.from(new Set(resolved.map((r) => r.def.imageSlot).filter((s): s is ImageSlot => !!s)));
  const presetOf = (Object.keys(COLOR_PRESETS) as ColorPresetId[]).find((id) => JSON.stringify(COLOR_PRESETS[id].colors) === JSON.stringify(design.colors));
  const locked = (k: AbTestKey) => ab?.test === k;

  const metricsCtx: MetricsDraftContext = {
    templateId,
    targetName: tpl.usesTarget ? target?.name ?? null : null,
    targetType: tpl.usesTarget ? target?.type ?? null : null,
    variants: variants.map((v) => {
      const cfg = cfgOf(v);
      const utm = buildStoryUtm(tpl, targetKey, cfg.slides, abOf(v));
      // 楽天BFは商品数で3〜4枚（記録の枚数も実際に保存する枚数に合わせる）
      const count = templateId === 'bf' ? (resolveSlides(templateId, cfg, edits, images, target, bfState.items.length).length as RecordSlideCount) : structureSlideCount(cfg.slides);
      const linkSlide = templateId === 'bf' ? -1 : structureSlides(tpl, cfg.slides).findIndex((d) => d.sticker === 'link');
      return { variant: ab ? v : null, slides: count, utmCampaign: utm.campaign, utmContent: utm.content, url: urlOf(v), linkSlide: linkSlide >= 0 ? linkSlide + 1 : count };
    }),
    abTest: ab?.test ?? null,
    saleItems: isBf ? bfItems.map(({ imageSrc: _img, ...rest }) => rest) : null,
  };

  const fromScreen = initial?.from ? STORY_MAKER_FROM[initial.from] : null;

  return (
    <div className="space-y-4">
      {fromScreen && (
        <a href={fromScreen.href} className="inline-block text-xs text-violet-600 hover:text-violet-700 font-semibold">← {fromScreen.label}へ戻る</a>
      )}
      {templateId === 'bf' && (
        <div data-testid="bf-feed-notice" className="rounded-lg border-2 border-amber-500 bg-stone-900 text-stone-100 px-4 py-3 text-sm">
          <b className="text-amber-300">📐 Instagram 通常投稿（フィード）用・1080×1350（4:5）</b>
          <span className="ml-2">このテンプレートはストーリーズ用（1080×1920）ではありません。⑥で保存した画像（3〜4枚）を、Instagram アプリから通常投稿（カルーセル）として手動で投稿してください。自動投稿はしません。</span>
        </div>
      )}
      {templateId === 'bfstory' && (
        <div data-testid="bf-story-notice" className="rounded-lg border-2 border-amber-500 bg-stone-900 text-stone-100 px-4 py-3 text-sm">
          <b className="text-amber-300">📱 Instagram ストーリーズ用・1080×1920（9:16）・2枚</b>
          <span className="ml-2">商品の確認・承認はフィード版と共通です（先頭{BF_STORY_MAX_ITEMS}件を載せます）。⑥で保存した画像を Instagram アプリからストーリーズに投稿し、2枚目の点線の位置にリンクスタンプ（⑦のURL）を手動で置いてください。自動投稿はしません。</span>
        </div>
      )}
      {message && (
        <div role="status" className={`rounded-lg px-4 py-2 text-sm ${message.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        {/* ── 左：操作 ── */}
        <div className="space-y-4">
          <Step n={1} title="テンプレートを選ぶ">
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {STORY_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTemplate(t.id)}
                  className={`text-left rounded-lg border p-3 transition ${t.id === templateId ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' : 'border-gray-200 hover:border-amber-300'}`}
                >
                  <div className="font-bold text-sm text-slate-800">{t.title}</div>
                  <div className="text-xs text-gray-500 mt-1 leading-relaxed">{t.purpose}</div>
                  <div className="text-[11px] text-amber-700 mt-1 font-semibold">{t.id === 'bf' ? '3〜4枚・通常投稿 1080×1350' : t.id === 'bfstory' ? '2枚・ストーリーズ 1080×1920' : `基本 ${t.defaultSlides}枚`}</div>
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title="人物・グループを選ぶ" aside={!tpl.usesTarget && <span className="text-xs text-gray-400">このテンプレートは名前を使いません（任意）</span>}>
            <div className="flex gap-2 mb-3">
              <Pill active={targetType === 'group'} onClick={() => setTargetType('group')}>グループ</Pill>
              <Pill active={targetType === 'person'} onClick={() => setTargetType('person')}>人物</Pill>
            </div>
            {targetType === 'person' ? (
              <PersonCombobox persons={persons} value={personName} onChange={setPersonName} allowEmpty emptyLabel="（選ばない）" placeholder="人物名で検索" />
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  list="story-maker-groups"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="グループ名で検索（例：M!LK）"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <datalist id="story-maker-groups">
                  {groups.map((g) => <option key={g.name} value={g.name} />)}
                </datalist>
                {groupName && <button type="button" className="text-xs text-gray-500 underline shrink-0" onClick={() => setGroupName('')}>クリア</button>}
              </div>
            )}
            <p className="text-xs mt-2 text-gray-500">
              {target ? <>選択中：<b className="text-slate-700">{target.name}</b>（ページ：<code>{target.pagePath}</code>）</> :
                targetType === 'group' && groupName ? <span className="text-red-600">「{groupName}」は登録されているグループではありません。候補から選んでください。</span> :
                '未選択の場合は「推し」などの一般的な文言になります。'}
            </p>
            {pickMode && groupChoice && (
              <div className="mt-3 rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-semibold text-slate-700">
                  {pickMode === 'multi' ? '診断に使うメンバー（1〜12人。自動では選びません）' : 'カードにするメンバー（1人。自動では選びません）'}
                  <span className="ml-2 font-normal text-gray-500">{memberPicks.length}人選択中</span>
                </div>
                {(groupChoice.members ?? []).length === 0 ? (
                  <p className="text-xs text-red-600 mt-1">このグループのメンバーが登録されていません。「人物」から選んでください。</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 max-h-40 overflow-y-auto">
                    {(groupChoice.members ?? []).map((m) => {
                      const checked = memberPicks.includes(m.name);
                      return (
                        <label key={m.name} className="flex items-center gap-1 text-xs text-gray-700">
                          <input
                            type={pickMode === 'multi' ? 'checkbox' : 'radio'}
                            name="story-maker-member"
                            checked={checked}
                            onChange={(e) => setMemberPicks((prev) => pickMode === 'single' ? [m.name] : e.target.checked ? [...prev, m.name] : prev.filter((x) => x !== m.name))}
                          />
                          {m.name}{m.current ? '' : <span className="text-gray-400">（元メンバー）</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
                {pickMode === 'multi' && (groupChoice.members ?? []).length > 0 && (
                  <div className="mt-2 flex gap-3 text-xs">
                    <button type="button" className="text-amber-700 underline" onClick={() => setMemberPicks((groupChoice.members ?? []).filter((m) => m.current).slice(0, 12).map((m) => m.name))}>現メンバーを選ぶ（12人まで）</button>
                    <button type="button" className="text-gray-500 underline" onClick={() => setMemberPicks([])}>選択を外す</button>
                  </div>
                )}
              </div>
            )}
          </Step>

          {isBf ? (
            <div className="space-y-2">
              <BfSalePanel key={`${target?.type ?? ''}:${target?.name ?? ''}`} target={target} onChange={setBfState} />
              {templateId === 'bfstory' && bfState.items.length > BF_STORY_MAX_ITEMS && (
                <p data-testid="bf-story-limit" className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                  ストーリーズには「投稿に使う」の先頭{BF_STORY_MAX_ITEMS}件だけを載せます（{bfState.items.length}件中）。最大割引率もこの{BF_STORY_MAX_ITEMS}件から計算します。残りの商品はフィード版で紹介してください。
                </p>
              )}
            </div>
          ) : (
          <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runAuto()}
                disabled={busy !== null || !isAutoSupported(templateId)}
                className="px-4 py-2.5 rounded-lg bg-amber-500 text-white font-black hover:bg-amber-600 disabled:opacity-40"
              >
                {busy === 'auto' ? '作成中…' : '✨ ストーリーズを自動作成'}
              </button>
              {templateId === 'card' && (
                <label className="text-xs text-gray-700 flex items-center gap-1">カードのデザイン
                  <select value={cardVariant} onChange={(e) => setCardVariant(e.target.value as AutoCardVariant)} className="border border-gray-300 rounded px-2 py-1">
                    {AUTO_CARD_VARIANTS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">
              {templateId === 'vod' ? '推しサーチのサブスク診断で、選んだ推しを実際に診断した結果画像（/api/oshi-vod/image）を取得して配置します。' :
                templateId === 'card' ? '推し布教カードの作成画面と同じ処理のカード画像（/api/oshi-card/image・作品なし・公開中のトレカ風）を取得して配置します。' :
                templateId === 'request' ? '画像は使いません。質問スタンプを置く余白を空けたストーリーズを作ります。' :
                templateId === 'goods' ? '選んだ人物・グループのページに公開中の関連商品（写真集・CD・Blu-ray・DVD・グッズ）から最大3件を選び、商品画像と商品名のカードを作ります（価格は載せません）。グループはグループページと同じく所属メンバー全員の商品から選びます。' :
                templateId === 'goodsmaking' ? 'グッズ制作比較ページ（/oshikatsu/goods-making）に掲載中のサービス名・紹介文・作れるもの・最小注文個数でカードを作ります（料金・納期・順位は載せません）。' :
                'このテンプレートの自動作成は準備中です。実際の画面は④の「画像をアップロード」で設定してください。'}
              {isAutoSupported(templateId) && ' 現在の投稿枚数・デザイン・A/B設定で作ります。'}
            </p>
            {autoStatus && (
              <div className="mt-3">
                <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {AUTO_STAGES.map((s, i) => {
                    const cur = AUTO_STAGES.findIndex((x) => x.id === autoStatus.stage);
                    const mark = i < cur || autoStatus.state === 'done' ? '✅' : i === cur ? (autoStatus.state === 'error' ? '❌' : '⏳') : '・';
                    return <li key={s.id} className={i === cur && autoStatus.state === 'error' ? 'text-red-700 font-bold' : 'text-gray-600'}>{mark} {s.label}</li>;
                  })}
                </ol>
                <p role="status" className={`mt-2 text-sm ${autoStatus.state === 'error' ? 'text-red-700' : autoStatus.state === 'done' ? 'text-emerald-700' : 'text-slate-700'}`}>
                  {autoStatus.state === 'error' ? `「${AUTO_STAGES.find((s) => s.id === autoStatus.stage)?.label}」で止まりました：` : ''}{autoStatus.text}
                </p>
              </div>
            )}
            {autoFiles && (
              autoFilesFresh ? (
                <button type="button" onClick={saveAutoFiles} disabled={busy !== null} className="mt-3 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-40">
                  完成した画像を保存（{autoFiles.files.length === 1 ? 'PNG' : `${autoFiles.files.length}枚・ZIP`}）
                </button>
              ) : (
                <p className="mt-3 text-xs text-gray-600">自動作成のあとに編集されました。保存は⑥の「PNGをダウンロードする」から行ってください（編集内容で作り直します）。</p>
              )
            )}
          </section>
          )}

          <Step n={3} title="投稿枚数とデザインを選ぶ">
            {tpl.fixed ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-gray-600">このテンプレートはフィード投稿（1080×1350）の3枚固定です：①表紙（黒×ゴールド・名前と最大割引率）→ ②セール対象商品（最大3件）→ ③プロフィールのリンクへ誘導。背景色・リンク位置・A/Bテストは使いません。</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-gray-600">フォント</span>
                  {(Object.keys(FONT_STACKS) as FontId[]).map((f) => (
                    <Pill key={f} active={design.font === f} onClick={() => setDesign({ ...design, font: f })}>{FONT_STACKS[f].label}</Pill>
                  ))}
                  <label className="flex items-center gap-2 ml-2 text-xs text-gray-600">
                    文字サイズ
                    <input type="range" min={0.8} max={1} step={0.05} value={Math.min(1, design.fontScale)} onChange={(e) => setDesign({ ...design, fontScale: Number(e.target.value) })} />
                    {Math.round(Math.min(1, design.fontScale) * 100)}%
                  </label>
                </div>
              </div>
            ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-gray-600">構成</span>
                <Pill active={slides === 'single'} disabled={locked('slides')} onClick={() => chooseStructure('single')}>1枚完結版（1枚）</Pill>
                <Pill active={slides === tpl.defaultSlides} disabled={locked('slides')} onClick={() => chooseStructure(tpl.defaultSlides)}>標準版（{tpl.defaultSlides}枚）</Pill>
                <span className="text-xs font-semibold text-amber-700">選択中：{structureLabel(tpl, slides)}</span>
              </div>
              <p className="text-xs text-gray-500 -mt-1 ml-[6.5rem]">
                {slides === 'single'
                  ? '見出し・実際の画面・CTA・リンクの余白を1枚にまとめます（1枚だけでもサイトへ誘導できる構成）。リンクスタンプの余白は画面下部に固定です。'
                  : slides === 1 ? '紹介・実画面・CTAを1枚に（従来の1枚構成）' : slides === 2 ? '興味を引く → 実画面・CTA' : '興味を引く → 解決方法 → CTA'}
              </p>
              <details className="ml-[6.5rem] text-xs text-gray-500">
                <summary className="cursor-pointer select-none">ほかの枚数で作る</summary>
                <div className="flex flex-wrap gap-2 mt-2">
                  {SLIDE_COUNTS.filter((n) => n !== tpl.defaultSlides).map((n) => (
                    <Pill key={n} active={slides === n} disabled={locked('slides')} onClick={() => chooseStructure(n)}>{n}枚構成</Pill>
                  ))}
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-gray-600">背景色</span>
                {(Object.keys(COLOR_PRESETS) as ColorPresetId[]).map((id) => (
                  <Pill key={id} active={presetOf === id} disabled={locked('bg')} onClick={() => setDesign({ ...design, colors: { ...COLOR_PRESETS[id].colors } })}>
                    <span className="inline-block w-3 h-3 rounded-full mr-1 align-[-1px] border border-black/10" style={{ background: COLOR_PRESETS[id].colors.bg }} />
                    {COLOR_PRESETS[id].label}
                  </Pill>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-24 text-gray-600">色の調整</span>
                {([['bg', '背景'], ['accent', 'アクセント'], ['sub', 'サブ'], ['text', '文字']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="color" value={design.colors[k]} disabled={locked('bg') && k === 'bg'} onChange={(e) => setDesign({ ...design, colors: { ...design.colors, [k]: e.target.value } })} className="w-8 h-8 rounded border border-gray-200" />
                    {label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-gray-600">フォント</span>
                {(Object.keys(FONT_STACKS) as FontId[]).map((f) => (
                  <Pill key={f} active={design.font === f} onClick={() => setDesign({ ...design, font: f })}>{FONT_STACKS[f].label}</Pill>
                ))}
                <label className="flex items-center gap-2 ml-2 text-xs text-gray-600">
                  文字サイズ
                  <input type="range" min={0.8} max={1.2} step={0.05} value={design.fontScale} onChange={(e) => setDesign({ ...design, fontScale: Number(e.target.value) })} />
                  {Math.round(design.fontScale * 100)}%
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-24 text-gray-600">{templateId === 'request' ? 'スタンプ位置' : 'リンク位置'}</span>
                {LINK_POSITIONS.map((p) => (
                  <Pill key={p.value} active={design.linkPos === p.value} disabled={locked('link') || slides === 'single'} onClick={() => setDesign({ ...design, linkPos: p.value as LinkPosition })}>{p.label}</Pill>
                ))}
                {slides === 'single' && <span className="text-xs text-gray-400">1枚完結版は画面下部に固定（画像を大きく見せるため）</span>}
              </div>

              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3">
                <label className="flex items-center gap-2 font-semibold text-slate-700">
                  <input type="checkbox" checked={ab !== null} onChange={(e) => { setAb(e.target.checked ? { test: 'slides', ctaA: AB_CTA_A_DEFAULT, ctaB: '' } : null); setViewVariant('a'); setSelected(0); }} />
                  A/Bテスト用に2パターン作る
                </label>
                {ab && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {AB_TESTS.map((t) => (
                        <Pill key={t.key} active={ab.test === t.key} disabled={t.key === 'link' && slides === 'single'} onClick={() => { setAb({ ...ab, test: t.key }); setSelected(0); }}>
                          {t.label}：{t.a} vs {t.b}
                        </Pill>
                      ))}
                    </div>
                    {ab.test === 'cta' && (
                      <div className="grid sm:grid-cols-2 gap-2">
                        <label className="text-xs text-gray-600">A の CTA
                          <input value={ab.ctaA} onChange={(e) => setAb({ ...ab, ctaA: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">B の CTA（空欄＝テンプレートの文言）
                          <input value={ab.ctaB} placeholder={structureSlides(tpl, slides).find((d) => d.sticker === 'link')?.text.cta ?? ''} onChange={(e) => setAb({ ...ab, ctaB: e.target.value })} className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm" />
                        </label>
                      </div>
                    )}
                    <p className="text-xs text-gray-500">A・Bは別々の画像・別々のUTM（utm_content の末尾 _a / _b）になります。比較したい項目以外は同じ設定です。</p>
                  </div>
                )}
              </div>
            </div>
            )}
          </Step>

          <Step n={4} title="テキストと画像を調整する" aside={<button type="button" onClick={resetTexts} className="text-xs text-gray-500 underline">このテンプレートの文言を初期値に戻す</button>}>
            <div className="flex gap-2 mb-3 flex-wrap">
              {resolved.map((r) => (
                <Pill key={r.index} active={r.index === sel} onClick={() => setSelected(r.index)}>
                  {r.index + 1}枚目{r.def.sticker === 'link' ? '・リンク' : r.def.sticker === 'question' ? '・質問' : ''}{r.missingImage ? ' ⚠' : ''}
                </Pill>
              ))}
              {ab && <span className="text-xs text-gray-500 self-center">{viewVariant.toUpperCase()}パターン（{structureLabel(tpl, viewCfg.slides)}）の文言を編集中</span>}
            </div>
            <p className="text-xs text-gray-500 mb-2"><code>{'{name}'}</code> は選んだ人物・グループ名、<code>{'{name推し}'}</code> は「◯◯推し」に置き換わります。改行はそのまま反映されます。</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {SLIDE_TEXT_FIELDS.map((f) => {
                const single = current.def.layout === 'single';
                const irrelevant = (f.key === 'cta' && current.def.sticker !== 'link') || (f.key === 'stickerCaption' && (current.def.sticker === 'none' || (single && current.def.sticker !== 'link')));
                return (
                  <label key={f.key} className={`text-xs text-gray-600 ${irrelevant ? 'opacity-50' : ''}`}>
                    {(single && SINGLE_FIELD_LABELS[f.key]) || f.label}{irrelevant ? '（このページでは表示されません）' : ''}
                    {f.multiline ? (
                      <textarea rows={3} value={current.rawText[f.key]} onChange={(e) => setText(f.key, e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
                    ) : (
                      <input value={current.rawText[f.key]} onChange={(e) => setText(f.key, e.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-slate-800" />
                    )}
                  </label>
                );
              })}
            </div>
            {ab?.test === 'cta' && current.def.sticker === 'link' && <p className="text-xs text-amber-700 mt-2">CTA文言はA/Bテストの設定（{viewVariant.toUpperCase()}：「{current.text.cta}」）が優先されます。</p>}
            {templateId === 'request' && (
              <label className="block text-xs text-gray-600 mt-3">質問スタンプに入れる質問文（Instagramアプリで入力。画像には入りません）
                <div className="flex gap-2 mt-1">
                  <input value={questionText} onChange={(e) => setQuestionText(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                  <CopyButton text={questionText} />
                </div>
                <span className="block mt-1 text-gray-400">回答は Instagram のストーリーズの閲覧者一覧（質問スタンプの回答）で確認してください。推し投票ではありません。</span>
              </label>
            )}

            {slotsInUse.length > 0 && (
              <div className="mt-4 space-y-3">
                {slotsInUse.map((slot) => {
                  const img = images[imageKey(templateId, slot)];
                  const def = resolved.find((r) => r.def.imageSlot === slot)!.def;
                  const shotOpts = screenshotPathOptions(templateId, slot, tpl.usesTarget ? target : null);
                  return (
                    <div key={slot} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-slate-700">実際の画面：{def.imageHint}{def.image === 'optional' ? '（任意）' : ''}</div>
                        <span className={`text-xs font-bold ${img ? 'text-emerald-600' : def.image === 'required' ? 'text-red-600' : 'text-gray-400'}`}>{img ? '設定済み' : def.image === 'required' ? '未設定（保存できません）' : '未設定'}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <select value={shotPath} onChange={(e) => setShotPath(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 max-w-[320px]">
                          <option value="">撮影するページを選ぶ</option>
                          {shotOpts.map((o) => <option key={o.path} value={o.path}>{o.label}（{decodeURI(o.path)}）</option>)}
                        </select>
                        <label className="flex items-center gap-1 text-gray-600">スクロール
                          <input type="number" min={0} step={100} value={shotScroll} onChange={(e) => setShotScroll(Number(e.target.value))} className="w-20 border border-gray-300 rounded px-1 py-1" />px
                        </label>
                        <button type="button" disabled={busy !== null || !(shotPath || shotOpts[0])} onClick={() => onScreenshot(slot, shotPath || shotOpts[0].path)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold disabled:opacity-40">
                          {busy === 'shot' ? '取得中…' : 'スクリーンショットを取得'}
                        </button>
                        <label className="px-3 py-1.5 rounded-lg border border-gray-300 cursor-pointer hover:bg-gray-50">
                          画像をアップロード
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(slot, f); e.target.value = ''; }} />
                        </label>
                        {img && (
                          <>
                            {!img.panel && <select value={img.fit} onChange={(e) => setImages((p) => ({ ...p, [imageKey(templateId, slot)]: { ...img, fit: e.target.value as ImageFit } }))} className="border border-gray-300 rounded px-2 py-1.5">
                              <option value="top">上から大きく表示（はみ出しは切り取り）</option>
                              <option value="contain">全体を表示</option>
                            </select>}
                            <button type="button" className="text-red-600 underline" onClick={() => { delete autoOwners.current[imageKey(templateId, slot)]; setImages((p) => { const n = { ...p }; delete n[imageKey(templateId, slot)]; return n; }); }}>画像を外す</button>
                          </>
                        )}
                      </div>
                      {img?.panel && (
                        <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2 text-xs text-slate-700">
                          <p className="font-semibold">自動作成のカードを使用中（{img.panel.title}）。別の画像にしたいときは「画像をアップロード」で差し替えられます。</p>
                          <ul className="mt-1 list-disc pl-4 space-y-0.5">
                            {img.panel.kind === 'products'
                              ? img.panel.items.map((it, i) => <li key={i}>[{it.section}] {it.url ? <a href={it.url} target="_blank" rel="noopener noreferrer" className="underline">{it.title}</a> : it.title}{it.imageSrc ? '' : '（商品画像なし・代替カード）'}</li>)
                              : img.panel.items.map((it, i) => <li key={i}>{it.name}：{it.items}</li>)}
                          </ul>
                        </div>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1">本番の oshi-search.jp をスマホ幅（390px）で撮影します（閲覧数の計測・GAは読み込みません）。スクリーンショットはローカルの管理画面でだけ動きます。本番の管理画面では画像をアップロードしてください。</p>
                    </div>
                  );
                })}
              </div>
            )}
          </Step>

          <Step n={7} title="誘導URLをコピーする">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="w-24 text-gray-600">誘導先</span>
                <select value={linkTargetId || linkOpt?.id} onChange={(e) => setLinkTargetId(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm max-w-full">
                  {linkOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  <option value="custom">URLを直接入力</option>
                </select>
              </div>
              {linkTargetId === 'custom' && (
                <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="https://oshi-search.jp/..." className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
              )}
              {linkTargetId !== 'custom' && linkOpt?.warning && <p className="text-xs text-red-600">⚠ {linkOpt.warning}</p>}
              {linkTargetId === 'custom' && customUrl && !isSiteUrl(customUrl) && <p className="text-xs text-amber-700">推しサーチ以外のURLです。計測（GA4）は推しサーチのページでのみ確認できます。</p>}
              <div className="flex flex-wrap gap-2 items-center">
                <span className="w-24 text-gray-600">識別名</span>
                <input value={targetKey} onChange={(e) => setTargetKeyInput(e.target.value)} className="w-48 border border-gray-300 rounded-lg px-2 py-1 text-sm font-mono" />
                <span className="text-xs text-gray-400">utm_content の先頭（英数字。日本語名は英字に書き換えると分析しやすくなります）</span>
              </div>
              {variants.map((v) => {
                const url = urlOf(v);
                return (
                  <div key={v} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
                    {ab && <span className="shrink-0 w-6 h-6 rounded bg-amber-400 text-white text-xs font-black flex items-center justify-center">{v.toUpperCase()}</span>}
                    <code className="text-xs break-all flex-1 text-slate-700">{url ? decodeURI(url) : 'URLを入力してください'}</code>
                    {url && <CopyButton text={url} />}
                  </div>
                );
              })}
              <p className="text-xs text-gray-400">utm_source=instagram／utm_medium=social／utm_campaign=story_{tpl.key}。既存のクエリ（with・p 等）とページ内の位置（#）は残します。InstagramアプリでリンクスタンプにこのURLを貼ってください。</p>
            </div>
          </Step>
        </div>

        {/* ── 右：プレビュー・保存 ── */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <Step n={5} title="プレビューを確認する" aside={
            <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />ガイド表示</label>
          }>
            {ab && (
              <div className="flex gap-2 mb-3">
                {(['a', 'b'] as AbVariant[]).map((v) => (
                  <Pill key={v} active={viewVariant === v} onClick={() => { setViewVariant(v); setSelected(0); }}>
                    {v.toUpperCase()}：{v === 'a' ? AB_TESTS.find((t) => t.key === ab.test)!.a : AB_TESTS.find((t) => t.key === ab.test)!.b}
                  </Pill>
                ))}
              </div>
            )}
            <p className="text-xs font-bold text-amber-700 mb-2 text-center">構成：{templateId === 'bf' ? `${resolved.length}枚（表紙・商品${resolved.length - 2}ページ・最終ページ）` : structureLabel(tpl, viewCfg.slides)}</p>
            <div ref={previewRef} className="flex flex-col items-center gap-3">
              <div data-slide-index={sel} className="cursor-default">
                <StoryScaled width={340} height={frameH}>{slideElement(current, viewCfg, resolved.length, showGuide)}</StoryScaled>
              </div>
              <div className="flex gap-2">
                {resolved.map((r) => (
                  <button key={r.index} type="button" onClick={() => setSelected(r.index)} data-slide-index={r.index} className={`rounded-md ${r.index === sel ? 'ring-2 ring-amber-400' : 'opacity-70 hover:opacity-100'}`}>
                    <StoryScaled width={90} height={frameH}>{slideElement(r, viewCfg, resolved.length, false)}</StoryScaled>
                  </button>
                ))}
              </div>
            </div>
            {overflowSlides.length > 0 && (
              <p className="mt-2 text-xs text-red-600">⚠ {Array.from(new Set(overflowSlides)).sort().map((i) => `${i + 1}枚目`).join('・')}で文字や画像が枠からはみ出しています。文言を短くするか、文字サイズを下げてください。</p>
            )}
            <p className="mt-2 text-[11px] text-gray-400">紫の点線はスタンプを置く場所、灰色は Instagram の画面表示と重なる範囲です（ガイドは保存画像には入りません）。</p>
          </Step>

          <Step n={6} title="PNGをダウンロードする">
            <div className="space-y-2">
              {variants.map((v) => {
                const cfg = cfgOf(v);
                const rs = resolveSlides(templateId, cfg, edits, images, target, bfState.items.length);
                const missingPages = rs.filter((r) => r.missingImage).map((r) => `${r.index + 1}枚目`);
                return (
                  <div key={v} className="rounded-lg bg-slate-50 p-2">
                    {ab && <div className="text-xs font-bold text-slate-700 mb-1">{v.toUpperCase()}パターン（{cfg.slides}枚）</div>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy !== null} onClick={() => download(v)} className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-40">
                        {busy === `dl-${v}-all` ? '保存中…' : rs.length > 1 ? `${rs.length}枚まとめて保存（ZIP）` : 'PNGで保存'}
                      </button>
                      {rs.length > 1 && rs.map((r) => (
                        <button key={r.index} type="button" disabled={busy !== null} onClick={() => download(v, r.index)} className="px-2 py-2 rounded-lg border border-gray-300 text-xs hover:bg-white disabled:opacity-40">
                          {busy === `dl-${v}-${r.index}` ? '保存中…' : `${r.index + 1}枚目`}
                        </button>
                      ))}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1 font-mono break-all">{rs.length > 1 ? storyZipName(tpl, targetKey, abOf(v)) : storyFileName(tpl, targetKey, 0, abOf(v))}</div>
                    {isBf && bfState.blocked && <div className="text-xs text-red-600 mt-1">保存できません：{bfState.blocked}</div>}
                    {missingPages.length > 0 && <div className="text-xs text-red-600 mt-1">画像が必要なページ（{missingPages.join('・')}）が未設定のため、まとめて保存できません。必要な画像をアップロードしてください。画像が不要なページは個別にPNG保存できます。</div>}
                  </div>
                );
              })}
              <p className="text-[11px] text-gray-400">{templateId === 'bf' ? `1080×1350 の PNG（フィード投稿・カルーセル${resolved.length}枚。商品3件まで3枚・4〜6件で4枚）。プロフィールのリンクには⑦のURLを設定してください。` : '1080×1920 の PNG。ガイド・スタンプの枠は入りません。リンクスタンプは Instagram アプリで、点線の位置に置いてください。'}</p>
            </div>
          </Step>
        </div>
      </div>

      <StoryMetricsPanel ctx={metricsCtx} />
    </div>
  );
}
