'use client';

// 全人物詳細ページ共通の「#推しアド」（AccessTrade）広告枠。
// 人物ごとにDBへ広告情報を保存する方式ではなく、このコンポーネント側に
// 一度だけ実装することで、既存人物・CSV追加人物・管理画面追加人物のすべてに
// 自動的に同じ広告が表示される。
//
// ACCESSTRADE_BANNER_HTML は AccessTrade 管理画面で発行された公式SSLリンクコードを
// 一切改変せずそのまま埋め込む（アフィリエイトURL・計測用img・rel・referrerpolicy等を
// 書き換えると成果計測が壊れるため）。dangerouslySetInnerHTML を使うのも、JSX変換時の
// 属性欠落・タイプミスを避けて元コードを文字列のまま渡すため。
//
// クリック計測（GA4 affiliate_click）は、AccessTradeのリンクコード自体には手を入れず、
// 外側のラッパーdivにonClickを付けてイベントバブリングで検知する方式にしている。

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const ACCESSTRADE_BANNER_HTML =
  '<a href="https://h.accesstrade.net/sp/cc?rk=0100q6rn00ovvr" rel="nofollow" referrerpolicy="no-referrer-when-downgrade"><img src="https://h.accesstrade.net/sp/rr?rk=0100q6rn00ovvr" alt="#推しアド" border="0" width="300" height="250"></a>';

interface Props {
  personName: string;
}

export default function OshiAdBanner({ personName }: Props) {
  // 明示的に 'true' を設定した場合のみ表示する（opt-in）。
  // 未設定・'false'・その他の値はすべて非表示にすることで、案件終了後や
  // 環境変数の設定漏れ時に広告が表示され続けるのを防ぐ。
  if (process.env.NEXT_PUBLIC_OSHI_AD_ENABLED !== 'true') return null;

  const handleClick = () => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', 'affiliate_click', {
        affiliate_name: 'oshi_ad',
        page_type: 'person',
        person_name: personName,
        placement: 'after_watch_now',
      });
    }
  };

  return (
    <div className="theme-card px-4 py-6 flex flex-col items-center gap-4">
      <span
        className="self-start text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full"
        style={{ background: 'var(--ds-bg)', color: 'var(--ds-muted)', border: '1px solid var(--ds-border)' }}
      >
        PR　推し活におすすめ
      </span>
      <p className="text-sm leading-relaxed text-center" style={{ color: 'var(--ds-text)' }}>
        🎉 推しの誕生日や記念日に、
        <br />
        応援広告でお祝いしてみませんか？
      </p>
      {/* eslint-disable-next-line react/no-danger -- AccessTrade提供のリンクコードを改変せずそのまま利用する仕様 */}
      <div
        className="oshi-ad-banner__creative"
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: ACCESSTRADE_BANNER_HTML }}
      />
    </div>
  );
}
