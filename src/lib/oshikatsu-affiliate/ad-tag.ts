// ASP（A8.net 等）が発行した広告HTMLタグの安全確認（純粋関数・DB非依存・クライアントでも使える）。
//
// 方針: タグを「加工して安全にする」のではなく、「改変せずに表示しても安全な形か」を厳しく確認するだけにする。
// - 確認に通ったタグは、1文字も変えずにそのまま保存・表示する（リンクURLの抽出・文言変更・
//   計測用1×1画像の削除・画像サイズやリンク先の変更をしない。A8.netの規約に合わせる）
// - 1つでも許可外の記述があれば、保存も表示もしない（勝手に取り除いて表示することはしない）
//
// 許可する形（A8.netの「通常広告」タグの構造）:
//   <a href="https://px.a8.net/..." rel="nofollow">広告文言 または <img ...></a>
//   <img border="0" width="1" height="1" src="https://www??.a8.net/0.gif?a8mat=..." alt="">
// - 要素は a / img / br だけ。script・iframe・style・コメント・on* 属性・style 属性などは不可
// - リンク先・画像は https で、ASPごとに決めたドメイン（A8.net なら a8.net）だけ
// - URLの「?」より前に & は不可、数値文字参照（&#106; など）は不可（文字参照でURLを隠す書き方を通さない）
// 公開時にも同じ確認をもう一度行い、通らないタグは表示せず通常リンクに戻す（store.ts / core.ts）。

import type { OshikatsuAspId } from './constants';

export const AD_TAG_MAX_LENGTH = 5000;

interface AspTagRule {
  label: string;
  /** a href に許可するホスト */
  linkHost: RegExp;
  /** img src に許可するホスト */
  imageHost: RegExp;
  /** 計測用の1×1画像タグが必須か */
  requiresTrackingPixel: boolean;
}

const A8_HOST = /^(?:[a-z0-9-]+\.)*a8\.net$/;

export const ASP_TAG_RULES: Record<OshikatsuAspId, AspTagRule> = {
  a8: { label: 'A8.net', linkHost: A8_HOST, imageHost: A8_HOST, requiresTrackingPixel: true },
};

export interface AdTagCheckResult {
  ok: boolean;
  errors: string[];
  /** タグに含まれる広告リンクの数・画像の数（管理画面の確認表示用） */
  linkCount: number;
  imageCount: number;
  hasTrackingPixel: boolean;
}

const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'rel', 'target']),
  img: new Set(['src', 'width', 'height', 'border', 'alt']),
  br: new Set(),
};
const VOID_TAGS = new Set(['img', 'br']);
const REL_TOKENS = new Set(['nofollow', 'noopener', 'noreferrer', 'sponsored']);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/y;
const ATTR_RE = /\s+([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;
const ATTR_TAIL_RE = /\s*\/?\s*$/y;
const NUMERIC_RE = /^\d{1,4}$/;

function parseAttrs(raw: string, errors: string[], tag: string): Map<string, string> | null {
  const attrs = new Map<string, string>();
  let i = 0;
  while (i < raw.length) {
    ATTR_RE.lastIndex = i;
    const m = ATTR_RE.exec(raw);
    if (!m) {
      ATTR_TAIL_RE.lastIndex = i;
      const tail = ATTR_TAIL_RE.exec(raw);
      if (tail && ATTR_TAIL_RE.lastIndex === raw.length) break;
      errors.push(`<${tag}> の属性の書き方を読み取れません`);
      return null;
    }
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (attrs.has(name)) {
      errors.push(`<${tag}> に同じ属性（${name}）が2回あります`);
      return null;
    }
    attrs.set(name, value);
    i = ATTR_RE.lastIndex;
  }
  return attrs;
}

/**
 * 属性値のURLを確認する。https かつ許可ホストのみ。空白・制御文字は不可。
 * A8.net の画像URLはクエリに & をそのまま含む（aid=...&wid=...）ため、& は「?」より後ろだけ許可する。
 * 「?」より前（スキーム・ホスト・パス）の & と、数値文字参照（&#...）は不可（文字参照でドメインを隠す書き方を通さない）。
 */
function checkUrl(value: string, host: RegExp): string | null {
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return 'URLに空白や改行が含まれています';
  const q = value.indexOf('?');
  if ((q === -1 ? value : value.slice(0, q)).includes('&')) return 'URLのドメイン・パス部分に & が含まれています';
  if (value.includes('&#')) return 'URLに数値文字参照（&#...）が含まれています';
  let url: URL;
  try {
    url = new URL(value.replace(/&amp;/g, '&'));
  } catch {
    return 'URLの形式が正しくありません';
  }
  if (url.protocol !== 'https:') return 'URLが https ではありません';
  if (url.username || url.password) return 'URLにユーザー名・パスワードが含まれています';
  if (url.port) return 'URLにポート番号が含まれています';
  if (!host.test(url.hostname)) return `許可されていないドメイン（${url.hostname}）です`;
  return null;
}

/**
 * 広告タグが「改変せずにそのまま表示してよい形」かを確認する。タグ自体は変更しない。
 * aspId にルールが無い場合は常に不可。
 */
export function checkAdTag(aspId: string, html: string): AdTagCheckResult {
  const result: AdTagCheckResult = { ok: false, errors: [], linkCount: 0, imageCount: 0, hasTrackingPixel: false };
  const rule = (ASP_TAG_RULES as Record<string, AspTagRule | undefined>)[aspId];
  if (!rule) {
    result.errors.push('このASPの広告タグにはまだ対応していません（安全確認ルールが未設定）');
    return result;
  }
  if (typeof html !== 'string' || html.trim() === '') {
    result.errors.push('広告タグが空です');
    return result;
  }
  if (html.includes('\u0000')) {
    result.errors.push('広告タグに不正な文字（NUL）が含まれています');
    return result;
  }
  if (html.length > AD_TAG_MAX_LENGTH) {
    result.errors.push(`広告タグが長すぎます（${AD_TAG_MAX_LENGTH}文字まで）`);
    return result;
  }

  const errors = result.errors;
  const stack: string[] = [];
  let i = 0;
  while (i < html.length && errors.length === 0) {
    const ch = html[i];
    if (ch === '<') {
      TAG_RE.lastIndex = i;
      const m = TAG_RE.exec(html);
      if (!m) {
        errors.push('許可されていない記述（コメント・不完全なタグなど）が含まれています');
        break;
      }
      const isClose = m[1] === '/';
      const tag = m[2].toLowerCase();
      const allowed = ALLOWED_ATTRS[tag];
      if (!allowed) {
        errors.push(`許可されていない要素 <${tag}> が含まれています`);
        break;
      }
      if (isClose) {
        if (VOID_TAGS.has(tag) || m[3].trim() !== '') {
          errors.push(`</${tag}> の閉じタグが正しくありません`);
          break;
        }
        if (stack[stack.length - 1] !== tag) {
          errors.push(`</${tag}> に対応する開始タグがありません`);
          break;
        }
        stack.pop();
      } else {
        const attrs = parseAttrs(m[3], errors, tag);
        if (!attrs) break;
        for (const name of attrs.keys()) {
          if (!allowed.has(name)) {
            errors.push(`<${tag}> に許可されていない属性（${name}）があります`);
            break;
          }
        }
        if (errors.length > 0) break;

        if (tag === 'a') {
          if (stack.includes('a')) { errors.push('<a> の中に <a> があります'); break; }
          const href = attrs.get('href');
          if (!href) { errors.push('<a> に href がありません'); break; }
          const urlErr = checkUrl(href, rule.linkHost);
          if (urlErr) { errors.push(`リンク先: ${urlErr}`); break; }
          const rel = attrs.get('rel');
          if (rel !== undefined && !rel.trim().split(/\s+/).every((t) => REL_TOKENS.has(t.toLowerCase()))) {
            errors.push('<a> の rel に許可されていない値があります'); break;
          }
          const target = attrs.get('target');
          if (target !== undefined && target !== '_blank') { errors.push('<a> の target は _blank だけ使えます'); break; }
          result.linkCount++;
          stack.push('a');
        } else if (tag === 'img') {
          const src = attrs.get('src');
          if (!src) { errors.push('<img> に src がありません'); break; }
          const urlErr = checkUrl(src, rule.imageHost);
          if (urlErr) { errors.push(`画像: ${urlErr}`); break; }
          for (const n of ['width', 'height', 'border'] as const) {
            const v = attrs.get(n);
            if (v !== undefined && !NUMERIC_RE.test(v)) { errors.push(`<img> の ${n} は数字だけ使えます`); break; }
          }
          if (errors.length > 0) break;
          const alt = attrs.get('alt');
          if (alt !== undefined && /[<>]/.test(alt)) { errors.push('<img> の alt に < > は使えません'); break; }
          result.imageCount++;
          if (!stack.includes('a') && attrs.get('width') === '1' && attrs.get('height') === '1') {
            result.hasTrackingPixel = true;
          }
        }
        // br は属性なしのみ（ALLOWED_ATTRS で確認済み）
      }
      i = TAG_RE.lastIndex;
      continue;
    }
    // タグの外の文字（広告文言）は文字としてしか表示されないため、& などもそのまま許可する
    i++;
  }

  if (errors.length === 0 && stack.length > 0) errors.push(`<${stack[stack.length - 1]}> が閉じられていません`);
  if (errors.length === 0 && result.linkCount === 0) errors.push('広告リンク（<a>）がありません');
  if (errors.length === 0 && rule.requiresTrackingPixel && !result.hasTrackingPixel) {
    errors.push(`計測用の1×1画像タグがありません。${rule.label}で発行されたタグを、最後の <img> まで全部コピーして貼り付けてください`);
  }
  result.ok = errors.length === 0;
  return result;
}
