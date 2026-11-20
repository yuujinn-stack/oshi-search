import 'server-only';
/**
 * 楽天BF・推し別セール紹介の承認（サーバー側）。
 *
 * - 承認・期間・有効期限の判定はサーバーの時刻（Date.now()）で行う。管理者PCの時計は使わない。
 * - 承認時にサーバーが候補（公開中の関連商品）を読み直し、承認内容・承認日時・推しに HMAC-SHA256 の署名を付ける。
 *   鍵は既存の ADMIN_SESSION_SECRET（管理画面のログインと同じ。新しい保存先・DBは使わない）。
 *   署名の対象は bfApprovalMessage（'oshi-search:bf-approval:v1' で始まるため、ログインのトークンと混ざらない）。
 * - PNG保存の前（checkBfApprovals）と投稿記録の保存時（verifyBfRecordApprovals）に、署名・期間・期限を確かめる。
 *   承認内容はブラウザ側に持つだけで、サーバーには保存しない。
 */
import { validateSecretStrength } from '@/lib/session';
import {
  BF_MAX_ITEMS,
  BF_PRICE_LABELS,
  bfApprovalMessage,
  bfSaleCorner,
  bfSalePhase,
  bfTargetKey,
  checkBfRecordTiming,
  isApprovalUsable,
  parseBfRecordItems,
  verifyBfItem,
  type BfApprovedItem,
  type BfDiscountKind,
  type BfPriceLabel,
  type BfUnsignedItem,
  type BfVerificationInput,
} from '@/lib/story-maker/bf-sale';
import { loadStorySaleCandidates } from './goods-data';

export class BfApprovalError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type BfTarget = { type: 'person' | 'group'; name: string };

function hmacSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!validateSecretStrength(secret)) throw new BfApprovalError('承認の署名に使う設定（ADMIN_SESSION_SECRET）がないため、承認できません。', 500);
  return secret;
}

async function hmacKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(hmacSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signBfApproval(item: BfUnsignedItem, target: BfTarget): Promise<BfApprovedItem> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(['sign']), new TextEncoder().encode(bfApprovalMessage(item, bfTargetKey(target))));
  return { ...item, signature: toHex(sig) };
}

/** 署名が正しいか（承認内容・承認日時・推しのどれかが変わっていれば false。比較は crypto.subtle.verify で一定時間） */
export async function verifyBfSignature(item: BfApprovedItem, target: BfTarget): Promise<boolean> {
  const sig = fromHex(item.signature);
  if (!sig) return false;
  const { signature: _s, ...unsigned } = item;
  return crypto.subtle.verify('HMAC', await hmacKey(['verify']), sig, new TextEncoder().encode(bfApprovalMessage(unsigned, bfTargetKey(target))));
}

export function parseBfTarget(type: unknown, name: unknown): BfTarget {
  const n = typeof name === 'string' ? name.trim() : '';
  if ((type !== 'person' && type !== 'group') || !n || n.length > 100) throw new BfApprovalError('人物またはグループを選んでください。');
  return { type, name: n };
}

/** 承認欄の入力（ブラウザから届いた値）を型どおりに。数字の検証は verifyBfItem */
export function parseBfVerificationInput(raw: unknown): BfVerificationInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  const label = str(o.priceLabel, 20) as BfPriceLabel;
  return {
    priceLabel: (BF_PRICE_LABELS as readonly string[]).includes(label) ? label : '通常価格',
    regularPrice: str(o.regularPrice, 20),
    salePrice: str(o.salePrice, 20),
    sourceUrl: str(o.sourceUrl, 1000),
    discountKind: str(o.discountKind, 40) as BfDiscountKind | '',
    conditions: str(o.conditions, 200),
    confirmed: o.confirmed === true,
    checkedBy: str(o.checkedBy, 100),
  };
}

/** 承認（サーバーの時刻で）。候補はサーバーで読み直し、届いた商品名・商品ページは使わない */
export async function approveBfItem(
  target: BfTarget,
  productId: string,
  input: BfVerificationInput,
  nowMs: number = Date.now(),
): Promise<{ ok: true; item: BfApprovedItem } | { ok: false; errors: string[] }> {
  if (!productId || productId.length > 100) throw new BfApprovalError('商品を選んでください。');
  const { candidates } = await loadStorySaleCandidates(target);
  const candidate = candidates.find((c) => c.productId === productId);
  if (!candidate) return { ok: false, errors: ['この推しの候補に無い商品です。候補を読み込み直してください。'] };
  const r = verifyBfItem(candidate, input, nowMs);
  if (!r.ok) return r;
  return { ok: true, item: await signBfApproval(r.item, target) };
}

export interface BfApprovalProblem {
  productId: string;
  reason: string;
}

/** PNG保存の前の確認（サーバーの時刻で、署名・セール期間・有効期限） */
export async function checkBfApprovals(target: BfTarget, rawItems: unknown, nowMs: number = Date.now()): Promise<{ ok: boolean; problems: BfApprovalProblem[] }> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return { ok: false, problems: [{ productId: '', reason: '承認済みの商品がありません。' }] };
  if (rawItems.length > BF_MAX_ITEMS) return { ok: false, problems: [{ productId: '', reason: `商品は${BF_MAX_ITEMS}件までです。` }] };
  let items: BfApprovedItem[];
  try {
    items = parseBfRecordItems(rawItems) ?? [];
  } catch (err) {
    return { ok: false, problems: [{ productId: '', reason: err instanceof Error ? err.message : String(err) }] };
  }
  const phase = bfSalePhase(nowMs);
  const problems: BfApprovalProblem[] = [];
  for (const it of items) {
    if (!(await verifyBfSignature(it, target))) problems.push({ productId: it.productId, reason: '承認の内容を確認できません（変更された・別の推しの承認・サーバーで承認していない）。承認し直してください。' });
    else if (phase !== 'active') problems.push({ productId: it.productId, reason: '楽天ブラックフライデーの期間外のため保存できません。' });
    else if (!isApprovalUsable(it, nowMs)) problems.push({ productId: it.productId, reason: '承認から24時間を過ぎたため、商品ページで確認し直して承認してください。' });
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 投稿記録の保存時の確認。問題があればメッセージの一覧。
 * - すべての商品：署名が正しく、投稿日時の時点で承認が有効だったこと
 * - 新しく記録する商品（新規の記録、または保存済みの記録に無かった承認）：さらにサーバーの今の時刻でも承認が有効なこと
 *   （投稿日時だけを過去に戻して期限切れの承認を記録させない）
 * - 保存済みの記録と同じ承認（同じ商品・同じ署名）は、サーバーの今の時刻では判定しない（セール終了後もリーチ等を編集できる）
 */
export async function verifyBfRecordApprovals(
  record: { targetName: string | null; targetType: 'person' | 'group' | null; postedAt: string; saleItems?: BfApprovedItem[] | null },
  nowMs: number = Date.now(),
  savedSaleItems: BfApprovedItem[] | null = null,
): Promise<string[]> {
  const items = record.saleItems ?? [];
  if (items.length === 0) return [];
  if (!record.targetName || !record.targetType) return ['セール商品を記録するには、対象（人物・グループ）が必要です。'];
  const target: BfTarget = { type: record.targetType, name: record.targetName };
  const errors: string[] = [];
  for (const it of items) {
    if (!(await verifyBfSignature(it, target))) errors.push(`セール商品（${it.productId}）の承認の内容を確認できません（変更された・別の推しの承認・サーバーで承認していない）。`);
  }
  if (errors.length > 0) return errors;
  errors.push(...checkBfRecordTiming(items, record.postedAt, nowMs, bfSaleCorner()));
  const saved = new Set((savedSaleItems ?? []).map((s) => `${s.productId}|${s.signature}`));
  for (const it of items) {
    if (saved.has(`${it.productId}|${it.signature}`)) continue;
    if (!isApprovalUsable(it, nowMs)) {
      errors.push(`セール商品（${it.productId}）の承認は今の時刻で有効ではないため、新しく記録できません（承認から24時間を過ぎた・セール期間外）。商品ページで確認し直して承認してください。`);
    }
  }
  return errors;
}
