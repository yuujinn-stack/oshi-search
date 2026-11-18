// 期間限定セールのリール動画（動画生成「楽天ブラックフライデー」A・B・C）の文言の設定（純粋なデータ。DB・管理画面なし）。
//
// ・開始・終了日時はここに書かない。トップの特設コーナーと同じ SALE_CORNERS（src/lib/sale-corner/config.ts）の
//   saleCornerId の項目を使う（公式ページで確認した日時を1か所だけで管理する）。
// ・次回（楽天スーパーSALE 等）は SALE_CORNERS に1件追加し、ここにも同じ id で1件追加する。
//   同時に複数が対象になるときは、開催中 → 開始の早い順で1件だけ使う（トップの特設コーナーと同じ選び方）。
// ・終了日時を過ぎたら、台本の生成・ジョブの作成・Worker での生成をすべて止める（終了後に告知動画を作らない）。
//   開催前に作った台本（「始まります」）は、開催が始まったら生成しない（作り直す）。
//
// 書いてよい内容（誇大表示・未確認の断定をしないため。src/lib/__tests__/video-site-sale.test.ts が禁止語を確認する）:
// - セール名・日時は楽天の公式ページで確認した内容だけ（SALE_CORNERS 側に確認日がある）
// - 値引き率・セール価格・ポイント倍率・エントリー条件・対象商品・在庫・特典は書かない（推しサーチで確認していない）
// - 「まだ買ってない？」など購入をあおる表現は使わない
// - 楽天の画像・ロゴは使わない（文字だけ）
// 読み（kana）はひらがな（CapCut の音声用。漢字・英字・数字を残さない）。

export type SaleVideoPhase = 'upcoming' | 'active';

export interface SaleVideoLine {
  /** 字幕・画面の文字 */
  text: string;
  /** 音声用の読み（ひらがな） */
  kana: string;
}

export interface SaleVideoConfig {
  /** SALE_CORNERS の id（日時・公式ページはそちらを使う） */
  saleCornerId: string;
  /** 動画の中のセール名（例: 楽天ブラックフライデー） */
  name: string;
  /** 冒頭に出す帯（開催前は「11月19日20時スタート」を自動で付ける。開催中はこの文言） */
  activeBadge: string;
  /**
   * 冒頭0〜1.5秒の大きなセール名（赤地・白文字。A・B・C 共通）。開催前・開催中で同じ文
   * （開催状態は下の小さな行で「11月19日20時スタート」「開催中」と出す）
   */
  title: SaleVideoLine & { /** 画面の大きな文字の改行（1行ずつスマホで一瞬で読める大きさにする） */ display: string };
  /** 冒頭1.5〜3.5秒の一言（A 推しグッズ紹介・B 過去ライブ映像・C 予算×お買い物診断）。開催前・開催中 */
  intro: Record<'goods' | 'live' | 'shopping', Record<SaleVideoPhase, SaleVideoLine>>;
  /** 冒頭の一言の画面に小さく出す注記（ポイントアップ等の特典を誤解させないため。公式ページで確認した内容だけ） */
  entryNote: string;
  /** C で選ぶ予算（お買い物診断の予算の値。src/lib/oshi-shopping/params.ts の BUDGET_OPTIONS） */
  shoppingBudget: '1000' | '3000' | '5000' | '10000';
  /** 締め（ナレーション1文・画面の大きな文字・その下の検索誘導）。A・B・C それぞれ */
  cta: Record<'goods' | 'live' | 'shopping', SaleVideoLine & { title: string; sub: string }>;
  /** 動画と投稿文に入れる PR 表記 */
  prLabel: string;
}

export const SALE_VIDEO_CONFIGS: SaleVideoConfig[] = [
  {
    saleCornerId: 'rakuten-blackfriday-2026',
    name: '楽天ブラックフライデー',
    activeBadge: '楽天ブラックフライデー開催中',
    title: { text: '楽天ブラックフライデーセール！', kana: 'らくてんぶらっくふらいでーせーる！', display: '楽天\nブラック\nフライデー\nセール！' },
    intro: {
      goods: {
        upcoming: { text: '推しグッズ、損しないための探し方！', kana: 'おしぐっず、そんしないためのさがしかた！' },
        active: { text: '推しグッズ、損しないための探し方！', kana: 'おしぐっず、そんしないためのさがしかた！' },
      },
      // 開催中に「前に」は合わないため、開催中は「の間に」
      live: {
        upcoming: { text: 'ブラックフライデー前に、過去ライブをチェック！', kana: 'ぶらっくふらいでーまえに、かこらいぶをちぇっく！' },
        active: { text: 'ブラックフライデーの間に、過去ライブをチェック！', kana: 'ぶらっくふらいでーのあいだに、かこらいぶをちぇっく！' },
      },
      shopping: {
        upcoming: { text: '推しグッズ、予算内で失敗しない探し方！', kana: 'おしぐっず、よさんないでしっぱいしないさがしかた！' },
        active: { text: '推しグッズ、予算内で失敗しない探し方！', kana: 'おしぐっず、よさんないでしっぱいしないさがしかた！' },
      },
    },
    // 公式ページ（2026-11-18 確認）: ポイントアップはエントリーが必要・条件あり。値引き・還元の有無は商品ごとに楽天で確認
    entryNote: '※ポイントアップ特典は楽天公式ページでのエントリーと条件達成が必要です。価格・特典は楽天でご確認ください',
    shoppingBudget: '5000',
    cta: {
      goods: { text: '推しの名前からまとめて探せる！推しサーチで検索！', kana: 'おしのなまえからまとめてさがせる！おしさーちでけんさく！', title: '推しの名前から\nまとめて探せる！', sub: '推しサーチで検索！' },
      live: { text: '過去のライブ映像も探せる！推しサーチで検索！', kana: 'かこのらいぶえいぞうもさがせる！おしさーちでけんさく！', title: '過去のライブ映像も\n探せる！', sub: '推しサーチで検索！' },
      shopping: { text: '無料で試せる！推しサーチで検索！', kana: 'むりょうでためせる！おしさーちでけんさく！', title: '無料で試せる！', sub: '推しサーチで検索！' },
    },
    prLabel: 'PR（楽天アフィリエイト広告を含みます）',
  },
];
