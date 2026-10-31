// アフィリエイト素材の表示判定（DB非依存。公開ページの AffiliateSlot と管理画面の両方から使う）。
//
// 管理画面で種類「HTML広告コード」(raw_html/embed) を選んだまま、ASP発行の広告コードではなく
// アフィリエイトURLだけを貼り付けると、dangerouslySetInnerHTML でURL文字列がそのまま
// 表示されてしまう（例: Lemino の tr.affiliate-sp.docomo.ne.jp/cl/...）。
// rawCode が「http(s)のURL1つだけ」の場合はURL形式の素材として扱い、ボタンとして描画する。

/** rawCode がURL1つだけ（タグ・空白・引用符を含まない）ならそのURLを返す。URLの中身は一切変更しない。 */
export function getBareAffiliateUrl(rawCode: string | null | undefined): string | null {
  if (!rawCode) return null;
  const s = rawCode.trim();
  return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : null;
}

/** URL形式の素材をボタン化するときの文言（例: 「Leminoで今すぐ見る →」） */
export function affiliateCtaLabel(serviceDisplayName: string): string {
  return `${serviceDisplayName}で今すぐ見る →`;
}
