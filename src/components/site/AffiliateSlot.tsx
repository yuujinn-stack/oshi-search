// VODアフィリエイト広告の共通表示コンポーネント（Server Component）。
//
// 各公開ページ（作品詳細・VODサービスページ・人物ページ）はこのコンポーネントに
// vodService + slotKey (+ 必要なら既存UIの fallback) を渡すだけでよく、広告取得・
// 有効判定・期限判定・device判定・priority判定のロジックはすべて
// resolveAffiliateSlot() 側に集約している。
//
// fallback を渡した場合（例: 作品詳細の配信リンク）は、有効な広告がないときに
// fallback（＝既存のVODリンク・既存UI）をそのまま表示する。fallback を渡さない場合
// （VODサービスページ・人物ページの新規広告枠）は、広告が無ければ何も描画しない
// （余白も追加しない）。
//
// device='desktop'/'mobile'指定の素材がある場合のみ、CSSのレスポンシブ表示切り替えで
// 出し分ける（サーバー側でUser-Agent判定を行うとISR/静的レンダリングを妨げるため行わない）。
// 両端末で同じ素材・同じfallbackが選ばれる場合は二重にDOMへ出力しない。
import type { ReactNode } from 'react';
import { resolveAffiliateSlot, type ResolvedAffiliateCreative } from '@/lib/affiliate-store';

interface AffiliateSlotProps {
  /** normalizeProviderName() が返す正規化済みVODサービススラグ（例: hulu, lemino） */
  vodService: string;
  slotKey: string;
  /** 広告が無効/未登録/期限切れのときに表示する既存UI。未指定なら何も表示しない。 */
  fallback?: ReactNode;
  className?: string;
}

function AdWrapper({ children, slotKey }: { children: ReactNode; slotKey: string }) {
  // work_provider のみ、既存VODボタン（例: flatrateのbg-green-600）と同等の見た目に
  // CSSだけで揃える（globals.css の .affiliate-slot--work-provider a）。
  // ASP提供コード（rawCode内部のhref/計測img/rel/referrerpolicy等）は一切変更しない。
  // 他のslot（vod_hero/vod_mid/vod_bottom/person_vod）にはこの装飾を適用しない。
  const isWorkProviderCta = slotKey === 'work_provider';
  return (
    <div className={isWorkProviderCta ? 'affiliate-slot affiliate-slot--work-provider' : 'affiliate-slot'}>
      <span className="block text-[10px] font-semibold text-gray-400 mb-1 tracking-wide">PR</span>
      {/* ASP広告コードが横に大きくても、サイト全体を横スクロールさせないための安全な枠。
          広告コード自体（rawCode）は一切改変しない。 */}
      <div className="max-w-full overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

function CreativeBody({ creative }: { creative: ResolvedAffiliateCreative }) {
  switch (creative.type) {
    case 'raw_html':
    case 'embed':
      if (!creative.rawCode) return null;
      // eslint-disable-next-line react/no-danger -- ASP提供コードを改変せずそのまま利用する仕様
      return <div dangerouslySetInnerHTML={{ __html: creative.rawCode }} />;

    case 'banner':
      if (!creative.imageUrl || !creative.destinationUrl) return null;
      return (
        <a
          href={creative.destinationUrl}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="inline-block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- 外部ASPドメインの動的バナー画像のため */}
          <img
            src={creative.imageUrl}
            alt={creative.altText ?? ''}
            width={creative.width ?? undefined}
            height={creative.height ?? undefined}
            className="max-w-full h-auto rounded-lg"
          />
        </a>
      );

    case 'direct_url':
    case 'text':
      if (!creative.destinationUrl) return null;
      return (
        <a
          href={creative.destinationUrl}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="text-sm font-semibold text-indigo-600 hover:underline"
        >
          {creative.altText || creative.name}
        </a>
      );

    default:
      return null;
  }
}

function renderBranch(creative: ResolvedAffiliateCreative | null, fallback: ReactNode, slotKey: string): ReactNode {
  if (creative) return <AdWrapper slotKey={slotKey}><CreativeBody creative={creative} /></AdWrapper>;
  return fallback;
}

export default async function AffiliateSlot({ vodService, slotKey, fallback = null, className }: AffiliateSlotProps) {
  const { desktop, mobile } = await resolveAffiliateSlot(vodService, slotKey);

  // 広告が一切無い場合はfallbackをそのまま1回だけ返す（余計なwrapper divを増やさない）。
  if (!desktop && !mobile) {
    return fallback === null ? null : <>{fallback}</>;
  }

  // 両端末で同一の広告素材が選ばれた場合も1回だけ表示する。
  if (desktop && mobile && desktop.id === mobile.id) {
    return <div className={className}>{renderBranch(desktop, fallback, slotKey)}</div>;
  }

  return (
    <div className={className}>
      <div className="hidden md:block">{renderBranch(desktop, fallback, slotKey)}</div>
      <div className="md:hidden">{renderBranch(mobile, fallback, slotKey)}</div>
    </div>
  );
}
