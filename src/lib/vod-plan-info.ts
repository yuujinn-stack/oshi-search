// 推しに合うサブスク診断（/oshi-vod）で使う、VODサービスの料金比較情報（一元管理）。
//
// ルール（変更時も必ず守ること）:
// - 料金は各サービスの「日本向け公式サイト」の現在の料金ページだけを一次情報とする。
//   第三者サイト・比較サイトの金額は使わない。
// - checkedAt は実際に公式ページを確認した日付のみ。推測・未確認の日付は入れない。
// - 比較に使うプランは「今回カウントしている作品（見放題作品）を視聴できる、通常の月額契約の中で
//   最も安いプラン」。広告つきプランでも見放題範囲が同じなら使ってよいが、広告つきプランで
//   一部作品が見られない等、作品カバー範囲が異なる場合はそのプランを比較に使わない。
//   料金の安さだけを有利に見せるためのプラン選択は禁止。
// - 公式サイトだけでは料金・税込/税抜・条件を確実に判断できないサービスは推測で埋めず、
//   isComparable=false とする（月額・コスパランキングから自動的に除外される）。
// - アプリ内課金など割高な経路の料金は比較に使わない（Web等の通常決済の料金を使う）。
//
// kind について:
// - 'subscription' … 有料の月額プランがあるサービス。作品ごとの配信種別（flatrate / free / ads）で
//   見放題対象か無料枠かを判定する（ABEMA・Lemino等の無料コンテンツは無料枠として扱われる）。
// - 'free' … 有料の月額プランを持たない無料サービス（TVer・YouTube）。有料サブスクランキングには入らない。
//
// このファイルは DB に依存しない（'use client' からも import 可能）。

export type VodPlanKind = 'subscription' | 'free';

export interface VodPlanInfo {
  /** normalizeProviderName() が返す正規化スラグ */
  service: string;
  kind: VodPlanKind;
  /** 比較に使用しているプラン名（結果画面に必ず表示する） */
  planName: string | null;
  /** 月額料金（円） */
  monthlyPrice: number | null;
  /** monthlyPrice が税込表記か（公式で確認できない場合は null） */
  taxIncluded: boolean | null;
  /** 料金を確認した公式ページ */
  sourceUrl: string | null;
  /** 公式ページを実際に確認した日付（YYYY-MM-DD） */
  checkedAt: string | null;
  /** 月額・コスパランキングに使ってよいか */
  isComparable: boolean;
  /** 比較条件の補足（比較できない理由・決済方法による違い等。結果画面の詳細比較に表示） */
  note?: string;
  /** 公式サイトURL（アフィリエイト未登録時のCTAリンク先） */
  officialUrl: string;
}

const CHECKED_2026_10_08 = '2026-10-08';

export const VOD_PLAN_INFO: VodPlanInfo[] = [
  {
    service: 'hulu',
    kind: 'subscription',
    planName: '月額見放題プラン',
    monthlyPrice: 1320,
    taxIncluded: true,
    sourceUrl: 'https://news.hulu.jp/hulu_svod_rev_2026/',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    note: '2026年10月1日改定後の通常決済の料金。アプリ内決済は月額1,450円（税込）。改定前から継続中の一部契約は旧料金の場合があります。',
    officialUrl: 'https://www.hulu.jp/',
  },
  {
    service: 'unext',
    kind: 'subscription',
    planName: '月額プラン',
    monthlyPrice: 2189,
    taxIncluded: true,
    sourceUrl: 'https://www.video.unext.jp/lp/introduction',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    officialUrl: 'https://video.unext.jp/',
  },
  {
    service: 'netflix',
    kind: 'subscription',
    planName: 'スタンダード',
    monthlyPrice: 1590,
    taxIncluded: null,
    sourceUrl: 'https://help.netflix.com/ja/node/24926',
    checkedAt: CHECKED_2026_10_08,
    isComparable: false,
    note: '広告つきスタンダード（月額890円）は一部作品が視聴できないため比較に使用しません。スタンダードの料金は公式ページで税込/税抜の表記を確認できなかったため、月額・コスパ比較の対象外としています。',
    officialUrl: 'https://www.netflix.com/jp/',
  },
  {
    service: 'primevideo',
    kind: 'subscription',
    planName: 'Amazonプライム（月額プラン）',
    monthlyPrice: 600,
    taxIncluded: true,
    sourceUrl: 'https://www.amazon.co.jp/gp/help/customer/display.html?nodeId=G34EUPKVMYFW8N2U',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    note: 'Prime Video本体の見放題作品のみを対象にしています。Prime Video内の追加チャンネル（別料金）の作品は含みません。',
    officialUrl: 'https://www.amazon.co.jp/gp/video/storefront',
  },
  {
    service: 'disneyplus',
    kind: 'subscription',
    planName: 'スタンダード',
    monthlyPrice: 1250,
    taxIncluded: true,
    sourceUrl: 'https://www.disneyplus.com/ja-jp',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    officialUrl: 'https://www.disneyplus.com/ja-jp',
  },
  {
    service: 'dmmtv',
    kind: 'subscription',
    planName: 'DMMプレミアム',
    monthlyPrice: 550,
    taxIncluded: true,
    sourceUrl: 'https://support.dmm.com/premium/article/47489',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    note: 'アプリ内課金からの登録は月額650円（税込）。',
    officialUrl: 'https://tv.dmm.com/',
  },
  {
    service: 'lemino',
    kind: 'subscription',
    planName: 'Leminoプレミアム',
    monthlyPrice: 1540,
    taxIncluded: true,
    sourceUrl: 'https://www.docomo.ne.jp/service/lemino/index.html',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    note: 'Web登録の料金。App Store・Google Playでの購入は月額1,650円（税込）。無料配信作品は「無料で見られる作品」として別に表示しています。',
    officialUrl: 'https://lemino.docomo.ne.jp/',
  },
  {
    service: 'fod',
    kind: 'subscription',
    planName: 'FODプレミアム',
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '公式サイトで料金を確認できなかったため、月額・コスパ比較の対象外としています。',
    officialUrl: 'https://fod.fujitv.co.jp/',
  },
  {
    service: 'telasa',
    kind: 'subscription',
    planName: '見放題プラン',
    monthlyPrice: 990,
    taxIncluded: true,
    sourceUrl: 'https://help.telasa.jp/info/41498/',
    checkedAt: CHECKED_2026_10_08,
    isComparable: true,
    officialUrl: 'https://telasa.jp/',
  },
  {
    service: 'abema',
    kind: 'subscription',
    planName: null,
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '公式ページ間で料金表記が一致せず確定できなかったため、月額・コスパ比較の対象外としています。無料配信作品は「無料で見られる作品」として別に表示しています。',
    officialUrl: 'https://abema.tv/',
  },
  {
    service: 'nhkオンデマンド',
    kind: 'subscription',
    planName: null,
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '見放題パック以外に単品購入の作品があり、公式サイトで料金条件を確認できなかったため、月額・コスパ比較の対象外としています。',
    officialUrl: 'https://www.nhk-ondemand.jp/',
  },
  {
    service: 'のぎ動画',
    kind: 'subscription',
    planName: null,
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '公式サイトで料金を確認できなかったため、月額・コスパ比較の対象外としています。',
    officialUrl: 'https://nogidoga.com/',
  },
  {
    service: 'tver',
    kind: 'free',
    planName: null,
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '無料サービスのため、有料サブスクのランキングには含めません（見逃し配信は期間限定の場合があります）。',
    officialUrl: 'https://tver.jp/',
  },
  {
    service: 'youtube',
    kind: 'free',
    planName: null,
    monthlyPrice: null,
    taxIncluded: null,
    sourceUrl: null,
    checkedAt: null,
    isComparable: false,
    note: '無料サービスとして扱い、有料サブスクのランキングには含めません。',
    officialUrl: 'https://www.youtube.com/',
  },
];

const PLAN_BY_SERVICE = new Map(VOD_PLAN_INFO.map((p) => [p.service, p]));

export function getVodPlanInfo(service: string): VodPlanInfo | null {
  return PLAN_BY_SERVICE.get(service) ?? null;
}

/** 月額・コスパランキングに使える料金か（必要項目がすべて揃っている場合のみ true） */
export function isPriceComparable(plan: VodPlanInfo | null | undefined): plan is VodPlanInfo & { monthlyPrice: number } {
  return !!plan
    && plan.kind === 'subscription'
    && plan.isComparable
    && plan.monthlyPrice != null
    && plan.monthlyPrice > 0
    && plan.taxIncluded != null
    && !!plan.planName
    && !!plan.sourceUrl
    && !!plan.checkedAt;
}
