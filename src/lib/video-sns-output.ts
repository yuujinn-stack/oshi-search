// 動画生成（/admin/video-maker）の出力先SNS（Instagram / TikTok / 両方）と、SNS別のCTA設定。
//
// 動画の大部分は全SNSで共通。最後のCTAだけをSNSごとに変える（oshi-video-maker の scripts/sns/snsVariants.ts）:
//   mode "template" = テンプレートのCTAのまま（final.mp4 そのもの。Instagram の既定。従来の動画と同じ）
//   mode "search"   = 「推しサーチ」の検索窓CTAに差し替える（TikTok の既定。プロフィールにリンクを置けないため）
// ジョブ作成時の設定はジョブの template_input の "snsOutput" に保存し（DBの列は増やさない）、Worker へは claim の応答で
// template_input とは別の snsOutput として渡す（template_input の中身は従来どおり）。
//
// oshi-video-maker の src/lib/snsCta.ts と同じ形・同じ既定値・同じキー計算（snsCtaAudioKey）。片方を変えたらもう片方も合わせる。
// このファイルは純粋な関数・定数だけ（クライアント・サーバーの両方から使う）。

export const SNS_TARGETS = ['instagram', 'tiktok'] as const;
export type SnsTarget = (typeof SNS_TARGETS)[number];
export type SnsCtaMode = 'template' | 'search';

export const SNS_TARGET_LABELS: Record<SnsTarget, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

/** 管理画面の「出力先SNS」の選択肢（初期値は両方） */
export type SnsOutputChoice = 'instagram' | 'tiktok' | 'both';
export const SNS_OUTPUT_CHOICES: Array<{ value: SnsOutputChoice; label: string; targets: SnsTarget[] }> = [
  { value: 'instagram', label: 'Instagramのみ', targets: ['instagram'] },
  { value: 'tiktok', label: 'TikTokのみ', targets: ['tiktok'] },
  { value: 'both', label: 'Instagram ＋ TikTok（両方）', targets: ['instagram', 'tiktok'] },
];
export const DEFAULT_SNS_OUTPUT_CHOICE: SnsOutputChoice = 'both';

export interface SnsCtaSetting {
  mode: SnsCtaMode;
  /** CTAナレーション（表示と同じ表記。字幕にもこの文を使う） */
  narration: string;
  /** ナレーションの読み（ひらがな。CapCut の読み上げ・長さの見積もりに使う） */
  narrationKana: string;
  /** CTAテロップ（改行で2行まで。「」で囲んだ語を強調する） */
  telop: string;
  /** 検索窓に表示する文字 */
  searchText: string;
  /** サブテキスト（下部に小さく表示。URL など） */
  subText: string;
  /** URL表示（サブテキストを出すか） */
  showSubText: boolean;
  /** CTAの表示時間（秒・目安）。ナレーションが長い場合は読み終わるまで自動で延ばす */
  durationSec: number;
}
export type SnsCtaSettings = Record<SnsTarget, SnsCtaSetting>;

export interface SnsOutputRequest {
  version: 1;
  targets: SnsTarget[];
  cta: SnsCtaSettings;
}

export const SNS_CTA_DURATION_MIN = 2.0;
export const SNS_CTA_DURATION_MAX = 5.0;

export const DEFAULT_TIKTOK_CTA: SnsCtaSetting = {
  mode: 'search',
  narration: '気になったら、推しサーチで検索！',
  narrationKana: 'きになったら、おしサーチでけんさく！',
  telop: '気になったら\n「推しサーチ」で検索！',
  searchText: '推しサーチ',
  subText: 'oshi-search.jp',
  showSubText: true,
  durationSec: 2.8,
};

/** Instagram はテンプレートのCTA（プロフィールのリンク等）をそのまま使う。search に切り替えた場合の文言の初期値も持つ */
export const DEFAULT_INSTAGRAM_CTA: SnsCtaSetting = {
  ...DEFAULT_TIKTOK_CTA,
  mode: 'template',
  narration: '気になったら、プロフィールのリンクからチェック！',
  narrationKana: 'きになったら、プロフィールのリンクからチェック！',
  telop: '気になったら\n「プロフィールのリンク」から！',
};

export const DEFAULT_SNS_CTA: SnsCtaSettings = { instagram: DEFAULT_INSTAGRAM_CTA, tiktok: DEFAULT_TIKTOK_CTA };

export class SnsOutputError extends Error {}

function str(v: unknown, max: number, label: string, fallback: string, allowEmpty = false): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw new SnsOutputError(`${label}が文字列ではありません`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (!s && !allowEmpty) throw new SnsOutputError(`${label}が空です`);
  if (s.length > max) throw new SnsOutputError(`${label}が長すぎます（${max}文字まで）`);
  return s;
}

export function parseSnsCtaSetting(raw: unknown, target: SnsTarget): SnsCtaSetting {
  const d = DEFAULT_SNS_CTA[target];
  if (raw === undefined || raw === null) return { ...d };
  if (typeof raw !== 'object') throw new SnsOutputError(`${SNS_TARGET_LABELS[target]}のCTA設定が不正です`);
  const o = raw as Record<string, unknown>;
  const label = SNS_TARGET_LABELS[target];
  const mode = o.mode === undefined ? d.mode : o.mode;
  if (mode !== 'template' && mode !== 'search') throw new SnsOutputError(`${label}のCTAの種類が不正です`);
  const telop = str(o.telop, 40, `${label}のCTAテロップ`, d.telop);
  if (telop.split('\n').length > 2) throw new SnsOutputError(`${label}のCTAテロップは2行までです`);
  const durationSec = o.durationSec === undefined ? d.durationSec : Number(o.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < SNS_CTA_DURATION_MIN || durationSec > SNS_CTA_DURATION_MAX) {
    throw new SnsOutputError(`${label}のCTAの表示時間は${SNS_CTA_DURATION_MIN}〜${SNS_CTA_DURATION_MAX}秒です`);
  }
  return {
    mode,
    narration: str(o.narration, 40, `${label}のCTAナレーション`, d.narration),
    narrationKana: str(o.narrationKana, 60, `${label}のCTAナレーションの読み`, d.narrationKana),
    telop,
    searchText: str(o.searchText, 16, `${label}の検索窓の文字`, d.searchText),
    subText: str(o.subText, 40, `${label}のサブテキスト`, d.subText, true),
    showSubText: o.showSubText === undefined ? d.showSubText : o.showSubText === true,
    durationSec: Math.round(durationSec * 10) / 10,
  };
}

export function parseSnsCtaSettings(raw: unknown): SnsCtaSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { instagram: parseSnsCtaSetting(o.instagram, 'instagram'), tiktok: parseSnsCtaSetting(o.tiktok, 'tiktok') };
}

/** ジョブの出力先SNSの指定。無い（従来の画面・API）なら null = 従来どおり final.mp4 だけ（Instagram 版） */
export function parseSnsOutputRequest(raw: unknown): SnsOutputRequest | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') throw new SnsOutputError('出力先SNSの指定が不正です');
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) throw new SnsOutputError('出力先SNSの指定の版が不正です');
  const targets = Array.isArray(o.targets) ? o.targets : [];
  const picked = SNS_TARGETS.filter((t) => targets.includes(t));
  if (picked.length === 0 || picked.length !== targets.length) throw new SnsOutputError('出力先SNSが不正です');
  return { version: 1, targets: picked, cta: parseSnsCtaSettings(o.cta) };
}

export function buildSnsOutputRequest(choice: SnsOutputChoice, cta: SnsCtaSettings): SnsOutputRequest {
  const targets = SNS_OUTPUT_CHOICES.find((c) => c.value === choice)?.targets ?? ['instagram'];
  return { version: 1, targets: [...targets], cta };
}

/** ジョブの template_input から出力先SNSの指定を取り出す（template_input の他の中身はそのまま） */
export function splitSnsOutput(templateInput: unknown): { templateInput: Record<string, unknown> | null; snsOutput: unknown } {
  if (!templateInput || typeof templateInput !== 'object') return { templateInput: null, snsOutput: undefined };
  const { snsOutput, ...rest } = templateInput as Record<string, unknown>;
  return { templateInput: Object.keys(rest).length > 0 ? rest : null, snsOutput };
}

/** 文の正規化（空白・改行の違いを無視）。CTA音声の対応付けのキーに使う */
export function normalizeCtaNarration(text: string): string {
  return text.replace(/\s+/g, '').trim();
}

/**
 * CTAナレーションの CapCut 音声を対応付けるキー（FNV-1a 32bit・16進8桁）。oshi-video-maker と同じ計算。
 * 受信フォルダのファイル名「sns-cta__{キー}.wav」に使う
 */
export function snsCtaAudioKey(narration: string): string {
  const s = normalizeCtaNarration(narration);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const SNS_CTA_AUDIO_FILE_PREFIX = 'sns-cta__';

// ── 管理画面: 出力先SNSの選択からジョブ作成時の指定を決める ─────────────────────

export interface SnsSubmission {
  /** ジョブ作成 API に送る出力先SNSの指定（null = 送らない＝従来どおり Instagram 版だけ） */
  snsOutput: SnsOutputRequest | null;
  /** 選んだ出力先から変えた・注意が必要な理由（画面に表示する） */
  note: string | null;
  /** この組み合わせでは作れない理由（サーバーでも同じ理由で断る） */
  blocked: string | null;
}

/**
 * 画面の選択から、ジョブ作成時に送る出力先SNSの指定を決める。
 * ・Worker が SNS別CTA を報告していない（古い Worker）: 送らない（Instagram 版だけ）
 * ・CTA を差し替える SNS が、このテンプレート・ナレーション方式で未対応: 両方なら Instagram 版だけにして理由を表示、
 *   その SNS だけなら作れない（blocked）
 */
export function resolveSnsSubmission(input: {
  capability: SnsCtaCapability | null | undefined;
  narrationMode: string | null;
  choice: SnsOutputChoice;
  settings: SnsCtaSettings;
}): SnsSubmission {
  const { capability, narrationMode, choice, settings } = input;
  const wanted = SNS_OUTPUT_CHOICES.find((c) => c.value === choice)?.targets ?? ['instagram'];
  if (!capability) {
    return {
      snsOutput: null,
      note: wanted.includes('tiktok') ? 'Worker が TikTok 版に未対応のため、Instagram 版だけを作ります（Worker の更新・再起動が必要です）。' : null,
      blocked: null,
    };
  }
  const supported = !!narrationMode && capability.modes.includes(narrationMode);
  const unsupported = wanted.filter((t) => settings[t].mode === 'search' && !supported);
  if (unsupported.length === 0) return { snsOutput: buildSnsOutputRequest(choice, settings), note: null, blocked: null };
  const reason = capability.reason ?? 'このナレーション方式は未対応です。';
  const rest = wanted.filter((t) => !unsupported.includes(t));
  if (rest.length === 0) {
    return { snsOutput: null, note: null, blocked: `このテンプレートは${unsupported.map((t) => SNS_TARGET_LABELS[t]).join('・')}版（CTAの差し替え）に未対応です: ${reason}` };
  }
  return {
    snsOutput: { version: 1, targets: rest, cta: settings },
    note: `このテンプレートは${unsupported.map((t) => SNS_TARGET_LABELS[t]).join('・')}版に未対応のため、${rest.map((t) => SNS_TARGET_LABELS[t]).join('・')}版だけを作ります（${reason}）`,
    blocked: null,
  };
}

// ── Worker の報告・完了結果 ────────────────────────────────────────────────

/** テンプレートごとの SNS別CTA（CTAの差し替え）への対応（Worker 報告）。報告の無い古い Worker は未対応 */
export interface SnsCtaCapability {
  version: 1;
  /** CTA を差し替えられるナレーション方式（none / capcut） */
  modes: string[];
  /** 未対応の方式がある場合の理由 */
  reason: string | null;
}

export function parseSnsCtaCapability(raw: unknown): SnsCtaCapability | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.modes)) return null;
  return {
    version: 1,
    modes: o.modes.filter((m): m is string => m === 'none' || m === 'capcut' || m === 'auto'),
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : null,
  };
}

/** Worker に保存済みの SNS別CTA のナレーション音声（全テンプレート共通の CapCut 音声） */
export interface SnsCtaAudioReport {
  inboxPath: string | null;
  entries: Array<{ key: string; durationSec: number; importedAt: string }>;
}

export function parseSnsCtaAudioReport(raw: unknown): SnsCtaAudioReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .slice(0, 20)
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e.key === 'string' && /^[0-9a-f]{8}$/.test(e.key) && typeof e.durationSec === 'number' && Number.isFinite(e.durationSec))
    .map((e) => ({ key: e.key as string, durationSec: e.durationSec as number, importedAt: typeof e.importedAt === 'string' ? e.importedAt.slice(0, 40) : '' }));
  return { inboxPath: typeof o.inboxPath === 'string' && o.inboxPath.startsWith('/') ? o.inboxPath.slice(0, 500) : null, entries };
}

/** 完了したジョブの SNS別の完成動画（result.snsOutputs）。1つの SNS の結果 */
export interface SnsOutputResult {
  status: 'PASS' | 'FAIL';
  ctaMode: SnsCtaMode;
  /** final.mp4 と同じ内容（CTA を差し替えていない）。URL はジョブの動画URL */
  sameAsFinal: boolean;
  url: string | null;
  durationSec: number | null;
  ctaStartSec: number | null;
  ctaDurationSec: number | null;
  /** CTAのナレーション: capcut=保存済みの CapCut 音声 / none=音声なしの動画 / template=テンプレートのまま */
  ctaAudio: 'capcut' | 'none' | 'template' | null;
  ctaAudioKey: string | null;
  narration: string | null;
  srt: string | null;
  error: string | null;
}
export interface SnsOutputsResult {
  version: 1;
  targets: SnsTarget[];
  results: Partial<Record<SnsTarget, SnsOutputResult>>;
}

export function readSnsOutputsResult(result: unknown): SnsOutputsResult | null {
  const raw = result && typeof result === 'object' ? (result as Record<string, unknown>).snsOutputs : null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.targets)) return null;
  const targets = SNS_TARGETS.filter((t) => (o.targets as unknown[]).includes(t));
  const results = (o.results ?? {}) as Record<string, unknown>;
  const out: SnsOutputsResult = { version: 1, targets, results: {} };
  for (const t of targets) {
    const r = results[t] as SnsOutputResult | undefined;
    if (r && (r.status === 'PASS' || r.status === 'FAIL')) out.results[t] = r;
  }
  return out;
}
