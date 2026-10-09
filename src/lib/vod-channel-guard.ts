// VOD配信情報CSV取り込み時の安全装置：Prime Video 追加チャンネルの誤登録検出（純粋関数・DB非依存）。
//
// 背景: VOD調査の対象が主要14サービスに限定されていたため、Prime Video 内の追加チャンネル
// （NHKオンデマンド・FODチャンネル・TELASA・Leminoセレクト等。プライム会員費とは別料金）で
// 配信されている作品が「Prime Video」として登録され、Prime Video 本体の見放題として
// 集計されていた（2026-10 調査で157行を確認）。
//
// ルール:
// - provider が Prime Video 本体（normalizeProviderName === 'primevideo'）なのに、note / sourceUrl に
//   追加チャンネル・別契約を示す記述がある行は「追加チャンネルの可能性あり」として取り込みを保留する。
// - note の内容から provider を自動で書き換えることはしない（人間の確認を促すだけ）。
//   追加チャンネルで確定した場合は「NHK On Demand Amazon Channel」等の正式名で CSV を直して再取り込みする。
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { VodProvider } from '@/types/vod';

/** note に含まれていたら追加チャンネル・別契約の可能性がある語 */
const CHANNEL_HINT_RE =
  /チャンネル|channel|別途|追加契約|追加の?チャンネル|追加料金|別料金|追加登録|追加の?サブスクリプション|for\s*prime\s*video|会員特典(単体)?(では|の見放題では)(ない|なく)/i;

/** sourceUrl が Prime Video の追加チャンネルのページ */
const CHANNEL_URL_RE = /(primevideo\.com|amazon\.co\.jp)\/(.*\/)?(gp\/video\/)?channel\//i;

export const PRIME_CHANNEL_SUSPECT_WARNING =
  '追加チャンネルの可能性があります（Prime Video本体として取り込まず保留しました）。' +
  'プライム会員だけで追加料金なしに視聴できる場合のみ「Prime Video」、' +
  '追加チャンネル経由の場合は「NHK On Demand Amazon Channel」「FOD Channel Amazon Channel」等の正式名で登録してください。';

export interface VodRowLike {
  providerName: string;
  note?: string | null;
  sourceUrl?: string | null;
}

/** Prime Video 本体名義だが追加チャンネルの可能性がある行か */
export function isSuspectedPrimeChannelRow(row: VodRowLike): boolean {
  if (normalizeProviderName(row.providerName ?? '') !== 'primevideo') return false;
  if (row.sourceUrl && CHANNEL_URL_RE.test(row.sourceUrl)) return true;
  return !!row.note && CHANNEL_HINT_RE.test(row.note);
}

/** 保留理由の1行説明（プレビュー・結果表示用） */
export function describeSuspectedPrimeChannelRow(row: VodRowLike & { workId?: string; workTitle?: string | null }): string {
  const target = row.workTitle ?? row.workId ?? '';
  const note = (row.note ?? '').trim();
  return `${target ? `${target}: ` : ''}${row.providerName}${note ? `（note: ${note.slice(0, 60)}${note.length > 60 ? '…' : ''}）` : ''}`;
}

/**
 * AI Web検索補完の結果から「Prime Video 本体名義だが追加チャンネルの可能性がある」provider を除外する。
 * AI の note / reason / officialUrl に追加チャンネルの記述があるものは採用しない（provider 名の自動書き換えはしない）。
 */
export function partitionSuspectedPrimeChannelProviders(providers: VodProvider[]): { kept: VodProvider[]; held: VodProvider[] } {
  const kept: VodProvider[] = [];
  const held: VodProvider[] = [];
  for (const p of providers) {
    const note = [p.note, p.reason].filter(Boolean).join(' ');
    const suspected = isSuspectedPrimeChannelRow({ providerName: p.providerName, note, sourceUrl: p.officialUrl ?? p.sourceUrl })
      || (!!p.sourceUrl && p.sourceUrl !== p.officialUrl && isSuspectedPrimeChannelRow({ providerName: p.providerName, sourceUrl: p.sourceUrl }));
    (suspected ? held : kept).push(p);
  }
  return { kept, held };
}
