// 推し活サービス（グッズ制作・グッズ買取・ファッションレンタル）のアフィリエイト管理の定数（DBアクセスなし）。
// 'use client' の管理画面から安全に import できるよう、DBを触る store.ts とは分離している。
//
// VODアフィリエイト（affiliate_programs / affiliate-store.ts）とは別の仕組み。VOD側のテーブル・判定は一切使わない。

import { OSHIKATSU_CATEGORIES, type OshikatsuCategoryId } from '@/lib/oshikatsu-services/categories';
import { OSHIKATSU_SERVICE_LINKS } from '@/lib/oshikatsu-services/links';
import { GOODS_MAKING_PATH } from '@/lib/oshikatsu-services/goods-making';
import { GOODS_BUYBACK_PATH } from '@/lib/oshikatsu-services/goods-buyback';
import { FASHION_RENTAL_PATH } from '@/lib/oshikatsu-services/fashion-rental';

export type { OshikatsuCategoryId };

/** 管理画面で選べるジャンル（推し活サービスのジャンル一覧と同じ。ジャンルを増やすときは categories.ts に追加する） */
export const OSHIKATSU_AFFILIATE_CATEGORIES: { id: OshikatsuCategoryId; name: string }[] =
  OSHIKATSU_CATEGORIES.map((c) => ({ id: c.id, name: c.name }));

export function isOshikatsuCategoryId(v: unknown): v is OshikatsuCategoryId {
  return typeof v === 'string' && OSHIKATSU_AFFILIATE_CATEGORIES.some((c) => c.id === v);
}

/** 提携状態。公開ページに広告を出せるのは approved のときだけ */
export type PartnershipStatus = 'not_applied' | 'pending' | 'approved' | 'rejected' | 'ended';
export const PARTNERSHIP_STATUSES: { id: PartnershipStatus; label: string }[] = [
  { id: 'not_applied', label: '未申請' },
  { id: 'pending', label: '審査中' },
  { id: 'approved', label: '承認済み' },
  { id: 'rejected', label: '否認' },
  { id: 'ended', label: '終了' },
];
export function isPartnershipStatus(v: unknown): v is PartnershipStatus {
  return typeof v === 'string' && PARTNERSHIP_STATUSES.some((s) => s.id === v);
}

/** 広告素材の種類（表示用の分類。中身はどちらもASPが発行したHTMLタグをそのまま保存する） */
export type CreativeKind = 'text' | 'banner';
export const CREATIVE_KINDS: { id: CreativeKind; label: string }[] = [
  { id: 'text', label: 'テキスト' },
  { id: 'banner', label: 'バナー' },
];
export function isCreativeKind(v: unknown): v is CreativeKind {
  return typeof v === 'string' && CREATIVE_KINDS.some((k) => k.id === v);
}

/**
 * ASP。広告タグの安全確認ルール（ad-tag.ts の ASP_TAG_RULES）があるASPだけ、タグを登録・公開できる。
 * 新しいASPを追加するときは、ここと ad-tag.ts の両方に追加する（ルールの無いASPのタグは保存しない）。
 */
// none（ASPなし・未定）は案件情報だけを管理するためのもの。広告タグの安全確認ルールが無いため、タグは登録・表示できない。
export type OshikatsuAspId = 'a8' | 'none';
export const OSHIKATSU_ASPS: { id: OshikatsuAspId; label: string }[] = [
  { id: 'a8', label: 'A8.net' },
  { id: 'none', label: 'ASPなし・未定' },
];
export function isOshikatsuAspId(v: unknown): v is OshikatsuAspId {
  return typeof v === 'string' && OSHIKATSU_ASPS.some((a) => a.id === v);
}

/** サービスキー（公開ページのサービスと結びつける識別子）。英小文字・数字・アンダースコアのみ */
export const SERVICE_KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

/** ジャンルごとの公開ページ（広告の掲載先）。管理画面で変更したらこのページを再生成する */
export const OSHIKATSU_CATEGORY_PAGE_PATHS: Partial<Record<OshikatsuCategoryId, string>> = {
  goods_making: GOODS_MAKING_PATH,
  goods_buyback: GOODS_BUYBACK_PATH,
  fashion_rental: FASHION_RENTAL_PATH,
};

/** 公開ページに掲載枠があるサービスキー（ここに無いサービスは登録だけでき、まだどのページにも表示されない） */
export const OSHIKATSU_PAGE_SERVICE_KEYS: Partial<Record<OshikatsuCategoryId, readonly string[]>> = {
  goods_making: ['shimauma_plus', 'cherish_palette'],
  goods_buyback: ['kaitori_ouji', 'justy', 'oshitoku', 'surugaya'],
  fashion_rental: ['mechakari', 'aircloset'],
};

/**
 * 管理画面で有効にしても、公開ページに広告を出さないサービス（サイト側の掲載方針で止めているもの）。
 * 条件を確認できたら、ここから外す（管理画面での承認・有効化とあわせて広告が表示される）。
 */
export const OSHIKATSU_AD_BLOCKED: Readonly<Record<string, string>> = {
  oshitoku: '比較サイトへの広告掲載条件を確認できるまで広告を出さない',
  surugaya: '公式にアフィリエイト機能の復旧を確認できるまで広告を出さない',
};

export function adBlockedReason(serviceKey: string): string | null {
  return OSHIKATSU_AD_BLOCKED[serviceKey] ?? null;
}

/**
 * 初期案件（管理画面の「初期案件を登録」ボタン用）。サービス名・公式URLは links.ts と同じ値。
 * プログラムIDはリポジトリに書かない方針のため空欄で登録し、管理画面で入力する。
 * 広告は必ず無効の状態で登録する。
 */
export const OSHIKATSU_AFFILIATE_PRESETS: {
  serviceKey: string;
  serviceName: string;
  category: OshikatsuCategoryId;
  aspId: OshikatsuAspId;
  officialUrl: string;
  partnershipStatus: PartnershipStatus;
}[] = [
  {
    serviceKey: 'cherish_palette',
    serviceName: OSHIKATSU_SERVICE_LINKS.cherish_palette.serviceName,
    category: 'goods_making',
    aspId: 'a8',
    officialUrl: OSHIKATSU_SERVICE_LINKS.cherish_palette.officialUrl,
    partnershipStatus: 'approved',
  },
  {
    serviceKey: 'shimauma_plus',
    serviceName: OSHIKATSU_SERVICE_LINKS.shimauma_plus.serviceName,
    category: 'goods_making',
    aspId: 'a8',
    officialUrl: OSHIKATSU_SERVICE_LINKS.shimauma_plus.officialUrl,
    partnershipStatus: 'pending',
  },
  // グッズ買取（/oshikatsu/goods-buyback）。JUSTY は A8.net で審査中。ほかは ASP 未定・未申請。
  { serviceKey: 'kaitori_ouji', serviceName: '買取王子', category: 'goods_buyback', aspId: 'none', officialUrl: 'https://www.kaitoriouji.jp/', partnershipStatus: 'not_applied' },
  { serviceKey: 'justy', serviceName: 'JUSTY', category: 'goods_buyback', aspId: 'a8', officialUrl: 'https://justy-consul.com/idols/', partnershipStatus: 'pending' },
  { serviceKey: 'oshitoku', serviceName: '推しトク', category: 'goods_buyback', aspId: 'none', officialUrl: 'https://kaitori-janiyard.jp/idol', partnershipStatus: 'not_applied' },
  { serviceKey: 'surugaya', serviceName: '駿河屋', category: 'goods_buyback', aspId: 'none', officialUrl: 'https://www.suruga-ya.jp/', partnershipStatus: 'not_applied' },
  // ファッションレンタル（/oshikatsu/fashion-rental）。A8.net の提携承認は未確認のため未申請・広告OFFで登録する。
  { serviceKey: 'mechakari', serviceName: 'メチャカリ', category: 'fashion_rental', aspId: 'a8', officialUrl: 'https://mechakari.com/', partnershipStatus: 'not_applied' },
  { serviceKey: 'aircloset', serviceName: 'airCloset', category: 'fashion_rental', aspId: 'a8', officialUrl: 'https://www.air-closet.com/', partnershipStatus: 'not_applied' },
];
