// 広告（アフィリエイトリンク・ASP広告枠）が掲載されるページのファーストビューに出すPR表記。
//
// サイト下部（layout.tsx のフッター）の「本サイトはアフィリエイト広告を利用しています。」に加えて、
// ページを開いてすぐ広告を含むことが分かるように、各ページのパンくず直下（トップはヒーローの上、人物・グループはパンくずの上）に置く。
// 見た目は globals.css の .pr-notice（黒地・白文字・PRはオレンジ。Graphic Pop の黒インクに合わせる）。
// 外側は div ではなく aside にする。各ページのデザインCSSが「最初の div」「パンくず直後の div」
// （例: home-graphic.css の `> div:first-of-type`、person-graphic.css の `nav:first-of-type + div`）で
// 既存の要素を装飾しているため、div を差し込むとその指定がずれる。
// 広告リンク・広告枠（AffiliateSlot 等）には一切関与しない、表示だけの Server Component。

export const PR_NOTICE_TEXT = 'PR｜本ページにはアフィリエイト広告が含まれます';

export default function PrNotice({ className }: { className?: string }) {
  return (
    <aside aria-label="広告表記" className={className ? `pr-notice-wrap ${className}` : 'pr-notice-wrap'}>
      <p className="pr-notice">
        <span className="pr-notice__label">PR</span>
        <span className="pr-notice__sep">｜</span>
        本ページにはアフィリエイト広告が含まれます
      </p>
    </aside>
  );
}
