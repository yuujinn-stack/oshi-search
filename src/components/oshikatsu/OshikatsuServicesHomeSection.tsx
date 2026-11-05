// ホームの「推し活サービス」コーナー（3つの機能カード〈サブスク診断・お買い物診断・布教カード〉の後、「ジャンルで探す」の前）。
// 既存ページのセクション番号CSS（home-graphic.css の section:nth-of-type）に影響しないよう <aside> で描画する。
// 見出しは .section-heading を使わない（番号ラベルの対象にしない）。人物・作品検索より目立たせないよう小さめにする。
import Link from 'next/link';
import OshikatsuCategoryCards from './OshikatsuCategoryCards';
import { OSHIKATSU_PATH } from '@/lib/oshikatsu-services/categories';

export default function OshikatsuServicesHomeSection() {
  return (
    <aside aria-labelledby="home-oshikatsu-heading" className="oks-home">
      <p className="oks-eyebrow">推し活サービス</p>
      <h2 id="home-oshikatsu-heading" className="oks-home-title">推し活をもっと楽しむ</h2>
      <p className="oks-home-lead">
        オリジナルグッズを作る、グッズを整理する、ライブ参戦服を探す。推し活に役立つサービスを比較できます。
      </p>
      <OshikatsuCategoryCards placement="home" />
      <p className="oks-home-more">
        <Link href={OSHIKATSU_PATH}>推し活サービスの一覧を見る →</Link>
      </p>
    </aside>
  );
}
