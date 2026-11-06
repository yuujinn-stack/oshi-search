// 人物ページ・グループページから「推し活グッズ買取サービス比較」への案内（サイト内リンクのみ）。
// - 所属グループのうち、どこかの買取サービスが公式サイトに名前を明記しているグループがあれば、
//   そのグループで絞り込んだ状態（?group=〇〇）で比較ページを開く。なければ絞り込みなしで開く。
// - 買取をすすめる表現は使わない（「整理したいときに」比較できる、という案内にとどめる）。
// - ここには広告（ASPのリンク・広告タグ）や人物画像を置かない（広告は比較ページのサービスカードだけ）。
// - GA4 は既存の oshikatsu_category_click（category_id=goods_buyback, placement=person_page / group_page）。
// - 既存ページのセクション番号CSS（section:nth-of-type 等）に影響しないよう <aside> で描画する。
import OshikatsuCategoryLink from '@/components/oshikatsu/OshikatsuCategoryLink';
import { GOODS_BUYBACK_PATH, findBuybackGroup } from '@/lib/oshikatsu-services/goods-buyback';
import './buyback-entry.css';

interface Props {
  /** 人物の現在の所属グループ、またはグループページのグループ名 */
  groupNames: readonly string[];
  placement: 'person_page' | 'group_page';
  className?: string;
}

export function buybackEntryHref(groupNames: readonly string[]): string {
  const g = findBuybackGroup(groupNames);
  return g ? `${GOODS_BUYBACK_PATH}?group=${encodeURIComponent(g)}` : GOODS_BUYBACK_PATH;
}

export default function BuybackEntryCta({ groupNames, placement, className }: Props) {
  const matched = findBuybackGroup(groupNames);
  const href = buybackEntryHref(groupNames);
  const description = matched
    ? `${matched}のグッズを買取対象として公式サイトに掲載しているサービスを、送料やキャンセル時の返送料とあわせて比較できます。`
    : '宅配買取サービスの対象グッズ・送料・キャンセル時の返送料などを比較できます。';
  return (
    <aside aria-label="グッズの整理・買取サービスを探す" className={className ? `bb-entry-wrap ${className}` : 'bb-entry-wrap'}>
      <OshikatsuCategoryLink href={href} categoryId="goods_buyback" placement={placement} className="bb-entry">
        <span className="bb-entry-body">
          <span className="bb-entry-eyebrow">GOODS BUYBACK</span>
          <span className="bb-entry-title">グッズの整理・買取サービスを探す</span>
          <span className="bb-entry-desc">{description}</span>
        </span>
        <span className="bb-entry-go" aria-hidden="true">比較 →</span>
      </OshikatsuCategoryLink>
    </aside>
  );
}
