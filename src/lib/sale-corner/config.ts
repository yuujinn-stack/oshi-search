// トップページの「期間限定 楽天セール特設コーナー」の設定（純粋なデータ。DB・管理画面なし）。
//
// 次回（楽天スーパーSALE 等）は SALE_CORNERS に1件追加するだけで使い回せる。終了したものは残しておいてよい
// （終了日時を過ぎると表示されない）。同時に複数が対象になるときは、開催中 → 開始の早い順で1件だけ出す。
//
// 書いてよい内容（誇大表示・未確認の断定をしないため）:
// - 日時・参加条件は楽天の公式ページ（officialUrl）で実際に確認した内容だけ。確認した日を officialCheckedAt に書く
// - 「全商品半額」「最安」「対象商品」など、推しサーチで確認していない値引き・対象・在庫・特典は書かない
// - リンク先は既存の公開ページだけ。グループのURLはトップの「グループで探す」と同じ方法（groupHrefByName）で
//   表示時に作る（ここにURLを書かない）。ライブ映像は過去のライブ映像特集の対象グループ（LIVE_ARCHIVE_GROUPS）だけ
// - 楽天の画像・ロゴは使わない（文字だけ）

export interface SaleCornerConfig {
  /** GA4 の sale_id（英数字・ハイフン） */
  id: string;
  /** 見出し（例: 楽天ブラックフライデー2026） */
  title: string;
  /** 開催中のバッジ（例: 楽天ブラックフライデー開催中） */
  activeLabel: string;
  /** 見出しの下の一文 */
  lead: string;
  /** 開始・終了（日本時間。+09:00 付きの ISO 8601）。終了日時ちょうど以降は表示しない */
  startsAt: string;
  endsAt: string;
  /** 告知を始める日時（日本時間）。省略時は設定を公開した時点から開始前まで告知する */
  announceFrom?: string;
  /** 楽天公式のセール会場（https・rakuten.co.jp。アフィリエイトの計測リンクは不可） */
  officialUrl: string;
  /** 公式ページで日時・条件を確認した日 YYYY-MM-DD */
  officialCheckedAt: string;
  /** 参加条件の注記（公式ページで確認した内容だけ） */
  conditionsNote: string;
  /** 導線に出すグループ（表示順。トップの「グループで探す」に無いグループは出さない） */
  groups: string[];
}

export const SALE_CORNERS: SaleCornerConfig[] = [
  {
    id: 'rakuten-blackfriday-2026',
    title: '楽天ブラックフライデー2026',
    activeLabel: '楽天ブラックフライデー開催中',
    lead: '推しの写真集・CD・ライブ映像を探そう',
    startsAt: '2026-11-19T20:00:00+09:00',
    endsAt: '2026-11-25T01:59:00+09:00',
    officialUrl: 'https://event.rakuten.co.jp/campaign/point-up/blackfriday/',
    officialCheckedAt: '2026-11-18',
    // 公式ページ（2026-11-18 確認）: エントリー必要・対象期間中の1ショップでのお買い物合計1,000円(税込)以上・一部対象外ショップあり
    conditionsNote:
      'ポイントアップの特典を受けるには楽天の公式ページでのエントリーが必要で、1ショップ1,000円（税込）以上のお買い物などの条件があります（一部対象外のショップあり）。',
    groups: ['Snow Man', 'M!LK', 'SixTONES'],
  },
];
