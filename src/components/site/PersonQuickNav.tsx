// 人物ページ 数字付きクイックナビゲーション。
// サイト共通ヘッダー（.site-header, position:sticky top:0, 高さ約60px）の直下に
// 重ならないよう top:64px でsticky表示する。スマホでは横スクロール可能な
// チップ形式。JSは使わず純粋なアンカーリンク＋CSS stickyのみで実装しているため、
// SSR済みのHTMLがそのまま機能する（SEO・Google側の読み取りに影響しない）。
interface NavItem {
  label: string;
  icon: string;
  count: number | null;
  href: string;
}

export default function PersonQuickNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="ページ内ナビゲーション"
      className="person-quick-nav breadcrumb-bar shadow-sm"
    >
      <div className="max-w-4xl mx-auto px-4 py-2.5">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          {items.map(({ label, icon, count, href }) => (
            <a
              key={label}
              href={href}
              className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-full transition-colors"
              style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {count !== null && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}
                >
                  {count.toLocaleString()}
                </span>
              )}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}
