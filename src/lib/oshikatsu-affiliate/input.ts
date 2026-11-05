// 推し活サービスのアフィリエイト管理APIの入力チェック（純粋関数・DB非依存）。
import { checkAdTag } from './ad-tag';
import {
  SERVICE_KEY_RE,
  isCreativeKind,
  isOshikatsuAspId,
  isOshikatsuCategoryId,
  isPartnershipStatus,
} from './constants';
import type { OshikatsuAffiliateCreativeInput, OshikatsuAffiliateServiceInput } from './store';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function checkOfficialUrl(v: string): string | null {
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '公式サイトURLは http(s) で入力してください';
    return null;
  } catch {
    return '公式サイトURLの形式が正しくありません';
  }
}

/**
 * 案件の入力チェック。mode='create' は全項目必須（広告掲載は常に無効で作成）、
 * mode='update' は送られてきた項目だけを確認して返す（serviceKey は変更不可のため無視）。
 */
export function parseServiceInput(body: unknown, mode: 'create'): Result<OshikatsuAffiliateServiceInput>;
export function parseServiceInput(body: unknown, mode: 'update'): Result<Partial<Omit<OshikatsuAffiliateServiceInput, 'serviceKey'>>>;
export function parseServiceInput(body: unknown, mode: 'create' | 'update'): Result<Partial<OshikatsuAffiliateServiceInput>> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const has = (k: string) => mode === 'create' || k in b;
  const out: Partial<OshikatsuAffiliateServiceInput> = {};

  if (mode === 'create') {
    const key = str(b.serviceKey);
    if (!SERVICE_KEY_RE.test(key)) return { ok: false, error: 'サービスキーは英小文字で始まる英小文字・数字・_（2〜50文字）で入力してください' };
    out.serviceKey = key;
  }
  if (has('serviceName')) {
    const v = str(b.serviceName);
    if (!v || v.length > 100) return { ok: false, error: 'サービス名を入力してください（100文字まで）' };
    out.serviceName = v;
  }
  if (has('category')) {
    if (!isOshikatsuCategoryId(b.category)) return { ok: false, error: 'ジャンルを選んでください' };
    out.category = b.category;
  }
  if (has('aspId')) {
    if (!isOshikatsuAspId(b.aspId)) return { ok: false, error: '対応しているASPを選んでください' };
    out.aspId = b.aspId;
  }
  if (has('programId')) {
    const v = str(b.programId);
    if (v.length > 100 || !/^[A-Za-z0-9_-]*$/.test(v)) return { ok: false, error: 'プログラムIDは英数字・-・_ で入力してください' };
    out.programId = v || null;
  }
  if (has('officialUrl')) {
    const v = str(b.officialUrl);
    const err = v ? checkOfficialUrl(v) : '公式サイトURLを入力してください';
    if (err) return { ok: false, error: err };
    out.officialUrl = v;
  }
  if (has('partnershipStatus')) {
    if (!isPartnershipStatus(b.partnershipStatus)) return { ok: false, error: '提携状態を選んでください' };
    out.partnershipStatus = b.partnershipStatus;
  }
  if (mode === 'create') {
    // 未完成の案件を誤って公開しないよう、作成時は必ず広告無効
    out.isAdEnabled = false;
  } else if ('isAdEnabled' in b) {
    if (typeof b.isAdEnabled !== 'boolean') return { ok: false, error: '広告掲載の有効・無効の値が正しくありません' };
    out.isAdEnabled = b.isAdEnabled;
  }
  if (has('note')) {
    const v = str(b.note);
    if (v.length > 2000) return { ok: false, error: 'メモは2000文字までです' };
    out.note = v || null;
  }
  return { ok: true, value: out };
}

/**
 * 広告素材の入力チェック。adHtml は前後の空白も含めて受け取ったまま保存する（改変しない）。
 * adHtml を含む場合は、その案件のASPのルールで安全確認し、通らなければ保存しない。
 */
export function parseCreativeInput(body: unknown, aspId: string, mode: 'create'): Result<OshikatsuAffiliateCreativeInput>;
export function parseCreativeInput(body: unknown, aspId: string, mode: 'update'): Result<Partial<OshikatsuAffiliateCreativeInput>>;
export function parseCreativeInput(body: unknown, aspId: string, mode: 'create' | 'update'): Result<Partial<OshikatsuAffiliateCreativeInput>> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const has = (k: string) => mode === 'create' || k in b;
  const out: Partial<OshikatsuAffiliateCreativeInput> = {};

  if (has('name')) {
    const v = str(b.name);
    if (!v || v.length > 100) return { ok: false, error: '素材名を入力してください（100文字まで）' };
    out.name = v;
  }
  if (has('kind')) {
    if (!isCreativeKind(b.kind)) return { ok: false, error: '広告素材の種類を選んでください' };
    out.kind = b.kind;
  }
  if (has('adHtml')) {
    const html = typeof b.adHtml === 'string' ? b.adHtml : '';
    const check = checkAdTag(aspId, html);
    if (!check.ok) return { ok: false, error: `広告タグを保存できません：${check.errors.join(' / ')}` };
    out.adHtml = html;
  }
  if ('isActive' in b) {
    if (typeof b.isActive !== 'boolean') return { ok: false, error: '素材の有効・無効の値が正しくありません' };
    out.isActive = b.isActive;
  } else if (mode === 'create') {
    out.isActive = true;
  }
  if ('sortOrder' in b) {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 999) return { ok: false, error: '表示順は0〜999の整数で入力してください' };
    out.sortOrder = n;
  } else if (mode === 'create') {
    out.sortOrder = 0;
  }
  return { ok: true, value: out };
}
