// 人物ページ・グループページから「ライブ参戦服・ファッションレンタル比較」への控えめな案内（サイト内リンクのみ）。
// - 人物の性別・写真・所属グループなどから、特定の服を「本人着用」などと結びつけない（服の情報は一切出さない）。
// - ここには広告（ASPのリンク・広告タグ）や人物画像を置かない（広告は比較ページのサービスカードだけ）。
// - GA4 は既存の oshikatsu_category_click（category_id=fashion_rental, placement=person_page / group_page）。
// - 既存ページのセクション番号CSS（section:nth-of-type 等）に影響しないよう <aside> で描画する。
import OshikatsuCategoryLink from '@/components/oshikatsu/OshikatsuCategoryLink';
import { FASHION_RENTAL_PATH } from '@/lib/oshikatsu-services/fashion-rental';
import './fashion-entry.css';

interface Props {
  placement: 'person_page' | 'group_page';
  className?: string;
}

export default function FashionEntryCta({ placement, className }: Props) {
  return (
    <aside aria-label="ライブ参戦服を探す" className={className ? `fr-entry-wrap ${className}` : 'fr-entry-wrap'}>
      <OshikatsuCategoryLink href={FASHION_RENTAL_PATH} categoryId="fashion_rental" placement={placement} className="fr-entry">
        <span className="fr-entry-title">ライブ参戦服を探す</span>
        <span className="fr-entry-desc">ライブにも普段にも使えるファッションレンタルを比較</span>
        <span className="fr-entry-go" aria-hidden="true">→</span>
      </OshikatsuCategoryLink>
    </aside>
  );
}
