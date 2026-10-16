import { AFFILIATE_LINK_STATUS_LABEL, type AffiliateLinkStatus } from '@/lib/rakuten-affiliate-link';

// 楽天商品リンクの状態バッジ（管理画面用）。要確認・未設定は、正規のアフィリエイトリンクと誤解されない色と説明にする。
const STYLE: Record<AffiliateLinkStatus, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  plain_needs_review: 'bg-amber-50 text-amber-800 border-amber-300',
  short_needs_review: 'bg-amber-50 text-amber-800 border-amber-300',
  unverified_affiliate: 'bg-amber-50 text-amber-800 border-amber-300',
  missing: 'bg-gray-100 text-gray-600 border-gray-300',
};

const NOTE: Record<AffiliateLinkStatus, string> = {
  verified: '楽天アフィリエイトURLの形式で、遷移先が商品URLと同じ商品であることを確認済みです。成果がどの楽天アカウントに計上されるかは、この表示では確認していません（楽天アフィリエイトのレポートで確認してください）',
  plain_needs_review: '公開ページでは通常URLでリンクされ、楽天アフィリエイトの成果が付きません',
  short_needs_review: '短縮URLは発行元・遷移先を確認できないため自動変換していません',
  unverified_affiliate: 'アフィリエイトURLの発行元または遷移先を確認できません',
  missing: '商品URLが設定されていません',
};

export default function AffiliateLinkBadge({ status }: { status: AffiliateLinkStatus }) {
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-medium ${STYLE[status]}`}
      title={NOTE[status]}
    >
      {status === 'verified' ? '✓ ' : '⚠ '}
      {AFFILIATE_LINK_STATUS_LABEL[status]}
    </span>
  );
}
