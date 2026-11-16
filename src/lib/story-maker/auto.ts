// ストーリーズの自動作成：テンプレートと対象から「どの実画像を、どの既存APIから取るか」を決める（純粋関数・'use client' からも import 可）。
//
// - A（サブスク診断）：/api/oshi-vod/image（結果ページと同じ計算の診断結果画像）
// - C（追加希望）：画像なし
// - D（推し布教カード）：/api/oshi-card/image（作成画面と同じ処理のカード画像）
// - B（関連商品）：/api/admin/story-maker/goods（人物・グループページに公開中の商品と商品画像）からカードを描く
// - E（グッズ制作比較）：/oshikatsu/goods-making の掲載内容（goods-making.ts）からカードを描く（取得なし）
// - 画面の撮影（Playwright・Chromium・外部サービス）は使わない。自動作成の画像は手動のアップロードで差し替えられる
//
// 人物名・メンバーは呼び出し側が選んだものだけを使う。グループの代表メンバーを勝手に選ばない。
// どちらの API も公開サイトの既存エンドポイント（ブラウザ不要・サーバーで描画）で、架空の画面は作らない。

import { buildOshiVodImagePath, OSHI_VOD_MAX_PERSONS } from '@/lib/oshi-vod/params';
import { buildOshiCardImagePath, OSHI_CARD_DEFAULT_PHRASE } from '@/lib/oshi-card/params';
import type { ImageSlot, StoryTarget, StoryTemplateId } from './templates';

/** 自動作成で使うカードのデザイン（公開中のトレカ風。作品を選ばなくても描画できる） */
export type AutoCardVariant = 'basic' | 'ssr';
export const AUTO_CARD_VARIANTS: { id: AutoCardVariant; label: string }[] = [
  { id: 'basic', label: 'トレカ風 A（ベーシック）' },
  { id: 'ssr', label: 'トレカ風 B（SSR）' },
];

export interface AutoOptions {
  /** グループ選択時に選んだメンバー（A は1〜12人、D は1人） */
  members: string[];
  cardVariant: AutoCardVariant;
}

export type AutoImagePlan =
  | { kind: 'none' }
  | { kind: 'fetch'; slot: ImageSlot; url: string; label: string; personNames: string[] }
  /** 画像の代わりにカードを描く。source='goods' は url から商品データを取得、'services' は掲載内容から作る */
  | { kind: 'panel'; slot: ImageSlot; source: 'goods' | 'services'; url: string | null; label: string; personNames: string[] }
  | { kind: 'blocked'; reason: string }
  | { kind: 'unsupported'; reason: string };

/** 自動作成に対応しているテンプレート */
export function isAutoSupported(templateId: StoryTemplateId): boolean {
  return templateId === 'vod' || templateId === 'request' || templateId === 'card' || templateId === 'goods' || templateId === 'goodsmaking';
}

/** B の商品データの取得先（管理画面専用API） */
export function storyGoodsApiPath(target: StoryTarget): string {
  return `/api/admin/story-maker/goods?type=${target.type}&name=${encodeURIComponent(target.name)}`;
}

/** グループ選択時にメンバーを選ぶ必要があるか（A は複数、D は1人） */
export function memberPickMode(templateId: StoryTemplateId, target: StoryTarget | null): 'multi' | 'single' | null {
  if (target?.type !== 'group') return null;
  if (templateId === 'vod') return 'multi';
  if (templateId === 'card') return 'single';
  return null;
}

export function autoImagePlan(templateId: StoryTemplateId, target: StoryTarget | null, opts: AutoOptions): AutoImagePlan {
  if (templateId === 'request') return { kind: 'none' };
  if (templateId === 'goodsmaking') {
    return { kind: 'panel', slot: 'screen', source: 'services', url: null, label: 'グッズ制作サービスの比較カード', personNames: [] };
  }
  if (templateId === 'goods') {
    if (!target) return { kind: 'blocked', reason: '人物またはグループを選んでください。' };
    // グループはグループページと同じく所属メンバー全員の商品から選ぶ（メンバーは選ばない）
    return { kind: 'panel', slot: 'screen', source: 'goods', url: storyGoodsApiPath(target), label: '関連商品のカード', personNames: [target.name] };
  }
  if (!isAutoSupported(templateId)) {
    return { kind: 'unsupported', reason: 'このテンプレートの自動作成は準備中です。実際の画面は「画像をアップロード」で設定してください。' };
  }
  if (!target) return { kind: 'blocked', reason: '人物またはグループを選んでください。' };

  const members = Array.from(new Set(opts.members.map((m) => m.trim()).filter(Boolean)));
  if (templateId === 'vod') {
    let names: string[];
    if (target.type === 'person') names = [target.name];
    else {
      if (members.length === 0) return { kind: 'blocked', reason: `「${target.name}」の診断に使うメンバーを選んでください（自動では選びません）。` };
      if (members.length > OSHI_VOD_MAX_PERSONS) return { kind: 'blocked', reason: `診断に使えるメンバーは${OSHI_VOD_MAX_PERSONS}人までです（${members.length}人選択中）。` };
      names = members;
    }
    return { kind: 'fetch', slot: 'screen', url: buildOshiVodImagePath(names, 'feed'), label: 'サブスク診断の結果画像', personNames: names };
  }

  // card
  let person: string;
  if (target.type === 'person') person = target.name;
  else {
    if (members.length !== 1) return { kind: 'blocked', reason: `「${target.name}」のカードにするメンバーを1人選んでください（自動では選びません）。` };
    person = members[0];
  }
  const url = buildOshiCardImagePath({ person, workIds: [], variant: opts.cardVariant, phrase: OSHI_CARD_DEFAULT_PHRASE }, 'feed');
  return { kind: 'fetch', slot: 'card', url, label: '推し布教カードの画像', personNames: [person] };
}

/** 自動取得した画像がどの対象・設定のものか（対象を変えたら使わない） */
export function autoImageOwnerKey(templateId: StoryTemplateId, target: StoryTarget | null, plan: AutoImagePlan): string {
  // E は対象に関係しない（掲載内容から作る）ため、推しを変えても外さない
  if (plan.kind === 'panel' && plan.source === 'services') return [templateId, 'services'].join('|');
  return [templateId, target?.type ?? '', target?.name ?? '', plan.kind === 'fetch' || plan.kind === 'panel' ? plan.url ?? '' : ''].join('|');
}

/** 取得した応答が画像として使えるか（HTMLのエラーページ等を画像として置かない） */
export function describeImageResponseError(status: number, contentType: string | null): string | null {
  if (status === 429) return 'アクセスが集中しています（1分あたりの上限）。1分ほど待ってからもう一度お試しください。';
  if (status === 400) return '選んだ人物の画像を作れませんでした（公開されていない人物・作品の可能性があります）。';
  if (status < 200 || status >= 300) return `画像を取得できませんでした（HTTP ${status}）。`;
  if (!contentType || !/^image\/png\b/i.test(contentType)) return `画像以外の応答が返りました（${contentType ?? '種類不明'}）。`;
  return null;
}

/** 画像の説明に並べる人物名の上限（それ以上は「ほか◯人」。診断結果画像の中の表記と同じ考え方） */
const CAPTION_MAX_NAMES = 3;

/**
 * 自動取得した画像の上に出す説明（1枚完結版）。実際にその画像を作った人物名（plan.personNames）だけを使う。
 * 例：A「目黒蓮の診断結果」、A（3人超）「目黒蓮・向井康二・阿部亮平ほか2人の診断結果」、D「目黒蓮の推しカード」。
 */
export function autoImageCaption(templateId: StoryTemplateId, plan: AutoImagePlan): string | undefined {
  if (plan.kind !== 'fetch' || plan.personNames.length === 0) return undefined;
  const names = plan.personNames;
  const shown = names.slice(0, CAPTION_MAX_NAMES).join('・');
  const who = names.length > CAPTION_MAX_NAMES ? `${shown}ほか${names.length - CAPTION_MAX_NAMES}人` : shown;
  if (templateId === 'vod') return `${who}の診断結果`;
  if (templateId === 'card') return `${who}の推しカード`;
  return undefined;
}
