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
    <div
      className="theme-card relative overflow-hidden px-4 py-6 flex justify-center"
      style={{
        // 「お祝い」感の淡いグラデーション（白→薄ピンク→薄アプリコット）。
        // color-mix() で各テーマの--ds-surfaceに対して20〜28%だけ色味を混ぜているため、
        // trust/oshiテーマでは目視で分かる淡いピンク〜アプリコットのグラデーションに、
        // darkテーマでは紺の--ds-surfaceにほんのり暖色が混ざる程度になり、
        // どのテーマでも文字の可読性を損なわない。
        background:
          'linear-gradient(to bottom, var(--ds-surface) 0%, color-mix(in srgb, var(--ds-surface) 78%, #f9a8d4 22%) 50%, color-mix(in srgb, var(--ds-surface) 72%, #fdba74 28%) 100%)',
      }}
    >
      {/* 推し活・お祝い感の控えめな装飾（3個・カード隅のみ）。
          pointer-events-none・aria-hidden で操作性・アクセシビリティに影響を与えず、
          文字・バナーの領域（内側コンテナ）には入らないよう
          カード自体のpadding帯（px-4=16px）の内側にとどめている。 */}
      <span aria-hidden="true" className="absolute top-1 left-1.5 text-sm opacity-60 pointer-events-none select-none" style={{ transform: 'rotate(-10deg)' }}>✨</span>
      <span aria-hidden="true" className="absolute top-1 right-1.5 text-sm opacity-60 pointer-events-none select-none" style={{ transform: 'rotate(8deg)' }}>🎊</span>
      <span aria-hidden="true" className="absolute bottom-1 right-1.5 text-sm opacity-50 pointer-events-none select-none" style={{ transform: 'rotate(14deg)' }}>✨</span>

      {/* 内側コンテナ: モバイルは最大幅320pxの縦積み、768px以上は左（PR・コピー）+
          右（バナー）の2カラム構成に切り替える（md:flex-row）。PRバッジ・バナーは
          モバイルではどちらも300px幅の箱に揃えているため左端が一致し、
          デスクトップでは左カラム内で左揃えに統一する（バナーの実サイズ・
          拡大縮小には一切関与しない。CSS側の表示のみの調整）。 */}
      <div className="flex flex-col items-center md:flex-row md:items-center w-full max-w-[320px] md:max-w-[640px] md:gap-8 relative">
        <div className="flex flex-col items-center md:items-start w-full md:w-auto md:flex-1">
          <div className="w-full max-w-[300px] md:max-w-none text-left mb-4">
            <span
              className="inline-block text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full"
              style={{
                background: 'color-mix(in srgb, var(--ds-surface) 78%, #f472b6 22%)',
                color: 'color-mix(in srgb, var(--ds-text) 55%, #9d174d 45%)',
                border: '1px solid color-mix(in srgb, var(--ds-border) 55%, #f472b6 45%)',
              }}
            >
              PR　推し活におすすめ
            </span>
          </div>
          <p className="text-base font-bold leading-snug text-center md:text-left mb-[10px]" style={{ color: 'var(--ds-text)' }}>
            推しの特別な日を、
            <br />
            応援広告でもっと特別にしませんか？
          </p>
          <p
            className="text-xs leading-relaxed text-center md:text-left mb-4 md:mb-0"
            style={{ color: 'color-mix(in srgb, var(--ds-text) 40%, var(--ds-muted) 60%)' }}
          >
            個人でも、ファン同士でも利用できる応援広告サービスです。
          </p>
        </div>
        {/* eslint-disable-next-line react/no-danger -- AccessTrade提供のリンクコードを改変せずそのまま利用する仕様 */}
        <div
          className="oshi-ad-banner__creative md:flex-shrink-0"
          onClick={handleClick}
          dangerouslySetInnerHTML={{ __html: ACCESSTRADE_BANNER_HTML }}
        />
      </div>
    </div>
  );
}
