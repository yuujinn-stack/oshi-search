// /vod/[provider] のうち、Hulu・DMM TV・Disney+ の3ページにのみ追加する編集コンテンツ。
// 目的: 広告目的の薄いページではなく、推しサーチ独自の使い方・情報の透明性・
// 実際のページ機能に即したFAQを掲載し、ユーザーにとっての情報価値を高めること。
//
// 重要:
// - 既存の作品一覧・人物一覧・pagination・provider抽出ロジックには一切影響しない
//   （page.tsx側で追加セクションとして描画するのみ）。
// - ここに定義した3サービス以外のurlSlugはVOD_PAGE_EDITORIALに存在しないため、
//   他11サービスのページ表示は変更されない。
// - 月額料金・無料期間・作品総数・同時視聴数等の変動しやすい情報はここでは扱わない
//   （公式情報の継続的な確認体制がない状態で掲載すると、審査対策のための不正確な
//   情報掲載になりかねないため、今回は意図的に対象外としている）。

export interface VodPageFaqItem {
  question: string;
  answer: string;
}

export interface VodPageEditorial {
  /** 「推しサーチでのHulu活用法」等の見出し */
  uniqueValueHeading: string;
  /** サービスの一般的な説明ではなく、このサイトでの独自の使い道を説明する導入文（100〜250字目安） */
  uniqueValueBody: string;
  /** よくある質問（実際のページ機能と一致するもののみ、2〜4問） */
  faq: VodPageFaqItem[];
}

function buildDefaultFaq(displayName: string): VodPageFaqItem[] {
  return [
    {
      question: 'このページにある作品はすべて現在見放題ですか？',
      answer: `いいえ、作品によって異なります。見放題・レンタル・購入など配信形式（availabilityType）は作品ごとに異なるため、各作品カード右上のバッジで配信形式をご確認ください。視聴前には${displayName}の公式サイト・アプリでも最終的な配信条件をあわせてご確認ください。`,
    },
    {
      question: '配信情報はいつ確認されていますか？',
      answer: `各作品の配信情報は、推しサーチが確認できた時点の情報です。作品カードに表示される「配信確認：〇〇」が確認日にあたります。確認日から時間が経っている作品は、配信状況が変わっている場合があるため、公式サイトでの最新確認をおすすめします。`,
    },
    {
      question: '推しの作品をどう探せますか？',
      answer: `このページ上部の「${displayName}の配信作品から人物を探す」から出演者を選ぶか、人物ページやサイト内検索から探している人物を見つけ、その人物の出演作一覧から${displayName}で配信中の作品を確認できます。`,
    },
  ];
}

export const VOD_PAGE_EDITORIAL: Partial<Record<string, VodPageEditorial>> = {
  hulu: {
    uniqueValueHeading: '推しサーチでのHulu活用法',
    uniqueValueBody:
      'Huluは配信タイトル数が非常に多く、公式アプリ内の検索だけで推しの出演作をもれなく見つけるのは簡単ではありません。推しサーチでは、Huluで配信中と確認できた作品を出演者ごとに整理しているため、「この人がHuluのどの作品に出ているか」を人物起点でまとめて確認できます。',
    faq: buildDefaultFaq('Hulu'),
  },
  'dmm-tv': {
    uniqueValueHeading: '推しサーチでのDMM TV活用法',
    uniqueValueBody:
      'DMM TVはアニメ作品を中心に、バラエティやアイドル関連コンテンツまで幅広いジャンルを扱っているのが特徴です。配信元やジャンルが多岐にわたるぶん、特定の推しの出演作だけを探すのは手間がかかりがちです。推しサーチでは、DMM TVで配信を確認できた作品を人物・グループ単位でまとめて一覧化しています。',
    faq: buildDefaultFaq('DMM TV'),
  },
  'disney-plus': {
    uniqueValueHeading: '推しサーチでのDisney+活用法',
    uniqueValueBody:
      'Disney+はディズニー・ピクサー・マーベル・スター・ウォーズに加え、国内ドラマやバラエティも含む「スター」ブランド作品まで扱う配信サービスです。作品ジャンルが幅広いぶん、推しの出演作だけを効率よく探すのは大変です。推しサーチでは、Disney+で配信を確認できた作品を出演者から検索できるようまとめています。',
    faq: buildDefaultFaq('Disney+'),
  },
};

export function getVodPageEditorial(urlSlug: string): VodPageEditorial | null {
  return VOD_PAGE_EDITORIAL[urlSlug] ?? null;
}
