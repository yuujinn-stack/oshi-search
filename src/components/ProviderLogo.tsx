'use client';

/**
 * ProviderLogo — 配信サービスロゴ共通コンポーネント
 *
 * 画像の取得順:
 *  1. TMDb logoPath  （tmdb_watch_provider データから）
 *  2. /providers/{slug}.png  （/public/providers/ に置いた独自画像）
 *  3. SVG フォールバックアイコン  （文字表示は一切しない）
 */

import { useState } from 'react';
import { normalizeProviderName } from '@/lib/vod-dedup';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

// ─── Amazon Channel → 親サービスキーのマッピング ────────────────────────────
const AMAZON_CHANNEL_PARENT: Record<string, string> = {
  'fodchannelamazonchannel':            'fod',
  'telasaamazonchannel':                'telasa',
  'nhkondemandamazonchannel':           'nhkondemand',
  'danimeamazonchannel':                'danimestore',
  'danimestoreamazonchannel':           'danimestore',
  'paraviamoplusamazonchannel':         'paravi',
  'wowowamazonchannel':                 'wowow',
  'wowowondemandamazonchannel':         'wowow',
  'niconicochannelplusamazonchannel':   'niconico',
  'bandaichannelamazonchannel':         'bandaichannel',
};

// ─── 正規化キー → /public/providers/{slug}.png のファイル名 ──────────────────
const PROVIDER_SLUG: Record<string, string> = {
  'hulu':               'hulu',
  'unext':              'unext',
  'lemino':             'lemino',
  'netflix':            'netflix',
  'primevideo':         'prime-video',
  'amazonprimevideo':   'prime-video',
  'prime':              'prime-video',
  'dmmtv':              'dmm-tv',
  'telasa':             'telasa',
  'fod':                'fod',
  'abema':              'abema',
  'abemat':             'abema',
  'disneyplus':         'disney-plus',
  'tver':               'tver',
  'youtube':            'youtube',
  'nhkondemand':        'nhk-on-demand',
  'nhkone':             'nhk-one',
  'nhk':                'nhk-on-demand',
  'appletvplus':        'apple-tv-plus',
  'appletv':            'apple-tv-plus',
  'wowowondemand':      'wowow',
  'wowow':              'wowow',
  'bandaichannel':      'bandai-channel',
  'niconico':           'niconico',
  'danimestore':        'danime-store',
  'danime':             'danime-store',
  'paravi':             'paravi',
  'rakutentv':          'rakuten-tv',
  'tversionrakuten':    'rakuten-tv',
  'tversionrakutentv':  'rakuten-tv',
  'hikari':             'hikari-tv',
  'jcomtv':             'jcom-tv',
  'videomarket':        'video-market',
  'milplus':            'mil-plus',
  'gyao':               'gyao',
};

// ─── サービスキー解決（Amazon Channel → 親サービス） ─────────────────────────
function resolveServiceKey(providerName: string): string {
  const norm = normalizeProviderName(providerName);
  if (AMAZON_CHANNEL_PARENT[norm]) return AMAZON_CHANNEL_PARENT[norm];
  if (norm.endsWith('amazonchannel')) {
    return norm.replace(/channel?amazonchannel$/, '').replace(/channel$/, '');
  }
  return norm;
}

function getLocalSlug(providerName: string): string | undefined {
  const key = resolveServiceKey(providerName);
  return PROVIDER_SLUG[key];
}

// ─── サイズ定義 ────────────────────────────────────────────────────────────────
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const SIZE_CLASS: Record<Size, string> = {
  xs: 'w-4 h-4',
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
  xl: 'w-11 h-11',
};

// ─── SVG フォールバックアイコン ───────────────────────────────────────────────
function PlayFallback() {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className="w-3/5 h-3/5"
      aria-hidden="true"
    >
      {/* 薄いグレー円 */}
      <circle cx="20" cy="20" r="20" fill="#F3F4F6" />
      {/* プレイ三角 */}
      <path d="M16 13l12 7-12 7V13z" fill="#D1D5DB" />
    </svg>
  );
}

// ─── 状態マシン ───────────────────────────────────────────────────────────────
type ImgState = 'tmdb' | 'local' | 'fallback';

// ─── コンポーネント ───────────────────────────────────────────────────────────
interface Props {
  providerName: string;
  logoPath?: string;   // TMDb の logoPath（例: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg"）
  size?: Size;
  /** 外側 div への追加クラス（rounded-xl / shadow-sm など） */
  className?: string;
}

export default function ProviderLogo({
  providerName,
  logoPath,
  size = 'md',
  className = '',
}: Props) {
  const localSlug = getLocalSlug(providerName);

  const [imgState, setImgState] = useState<ImgState>(() => {
    if (logoPath) return 'tmdb';
    if (localSlug) return 'local';
    return 'fallback';
  });

  const handleError = () => {
    if (imgState === 'tmdb') {
      setImgState(localSlug ? 'local' : 'fallback');
    } else {
      setImgState('fallback');
    }
  };

  const imgSrc =
    imgState === 'tmdb'  ? `${TMDB_LOGO_BASE}${logoPath}` :
    imgState === 'local' ? `/providers/${localSlug}.png`  :
    null;

  return (
    <div
      className={`${SIZE_CLASS[size]} rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-white border border-gray-100 ${className}`}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imgSrc}
          alt={providerName}
          onError={handleError}
          className="w-full h-full object-contain p-0.5"
        />
      ) : (
        <PlayFallback />
      )}
    </div>
  );
}
