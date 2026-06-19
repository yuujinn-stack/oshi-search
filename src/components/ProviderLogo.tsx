'use client';

/**
 * ProviderLogo — 配信サービスロゴ共通コンポーネント
 *
 * 画像の取得優先順位:
 *  1. 管理画面登録 logoUrl  （Redis → /api/providers が最優先）
 *  2. TMDb logoPath          （tmdb_watch_provider データ）
 *  3. /providers/{slug}.png  （/public/providers/ ローカル画像）
 *  4. SVG フォールバックアイコン
 */

import { useState, useEffect, useRef } from 'react';
import { normalizeProviderName } from '@/lib/vod-dedup';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w92';

// ─── 管理画面登録ロゴのモジュールレベルキャッシュ（TTL: 30秒）────────────────
// 同一ページ内の全インスタンスで 1 回のフェッチを共有しつつ、
// 管理画面更新後 30 秒以内に公開ページへ反映させる。
const CACHE_TTL_MS = 30_000;
let _providersPromise: Promise<Record<string, string>> | null = null;
let _providersTimestamp = 0;

function fetchRegisteredProviders(): Promise<Record<string, string>> {
  const now = Date.now();
  // TTL を超えたキャッシュは破棄して再取得
  if (!_providersPromise || now - _providersTimestamp > CACHE_TTL_MS) {
    _providersTimestamp = now;
    _providersPromise = fetch('/api/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : Promise.resolve({} as Record<string, string>)))
      .then((raw) => {
        // 管理画面側の slug 入力揺れを吸収するため、
        // API から受け取ったキーも normalizeProviderName で正規化してから返す。
        // 例: 管理画面で "U-NEXT" と入力 → 保存値 "u-next" → 正規化後 "unext"
        const normalized: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (v) normalized[normalizeProviderName(k)] = v;
        }
        return normalized;
      })
      .catch((): Record<string, string> => ({}));
  }
  return _providersPromise;
}

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
  'fodpremium':         'fod',
  'abema':              'abema',
  'abemat':             'abema',
  'abematv':            'abema',
  'disneyplus':         'disney-plus',
  'tver':               'tver',
  'youtube':            'youtube',
  'youtubepremium':     'youtube',
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

// ─── サービスキー解決 ─────────────────────────────────────────────────────────
function resolveServiceKey(providerName: string): string {
  const norm = normalizeProviderName(providerName);

  // Amazon Channel → 親サービスキー
  if (AMAZON_CHANNEL_PARENT[norm]) return AMAZON_CHANNEL_PARENT[norm];
  if (norm.endsWith('amazonchannel')) {
    return norm.replace(/channel?amazonchannel$/, '').replace(/channel$/, '');
  }

  // "Hulu JP" → "hulujp" → "hulu"  /  "U-NEXT JP" → "unextjp" → "unext"
  // 末尾の "jp" を除去し、既知サービスキーにマッチすれば採用する
  if (norm.endsWith('jp') && norm.length > 4) {
    const base = norm.slice(0, -2);
    if (base in PROVIDER_SLUG || base in AMAZON_CHANNEL_PARENT) {
      return base;
    }
  }

  return norm;
}

function getLocalSlug(providerName: string): string | undefined {
  return PROVIDER_SLUG[resolveServiceKey(providerName)];
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
    <svg viewBox="0 0 40 40" fill="none" className="w-3/5 h-3/5" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#F3F4F6" />
      <path d="M16 13l12 7-12 7V13z" fill="#D1D5DB" />
    </svg>
  );
}

// ─── 状態マシン: registered → tmdb → local → fallback ────────────────────────
type ImgState = 'tmdb' | 'registered' | 'local' | 'fallback';

// ─── コンポーネント ───────────────────────────────────────────────────────────
interface Props {
  providerName: string;
  logoPath?: string;
  size?: Size;
  className?: string;
}

export default function ProviderLogo({
  providerName,
  logoPath,
  size = 'md',
  className = '',
}: Props) {
  const localSlug = getLocalSlug(providerName);

  // 初期状態: 登録ロゴ取得中は tmdb/local/fallback で先行表示
  const [imgState, setImgState] = useState<ImgState>(() => {
    if (logoPath) return 'tmdb';
    if (localSlug) return 'local';
    return 'fallback';
  });

  const [registeredUrl, setRegisteredUrl] = useState<string | null>(null);
  const registeredFailed = useRef(false);

  useEffect(() => {
    // TMDb の有無に関わらず常に管理画面登録ロゴを確認し、あれば最優先で上書きする
    fetchRegisteredProviders().then((providers) => {
      // providers のキーは全て normalizeProviderName 済みなので serviceKey で直接引ける
      const serviceKey = resolveServiceKey(providerName);
      const url = providers[serviceKey] ?? null;
      if (url) {
        setRegisteredUrl(url);
        setImgState('registered');
        registeredFailed.current = false;
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerName]);

  // 優先順位: registered → tmdb → local → fallback
  const handleError = () => {
    if (imgState === 'registered') {
      registeredFailed.current = true;
      if (logoPath) {
        setImgState('tmdb');
      } else if (localSlug) {
        setImgState('local');
      } else {
        setImgState('fallback');
      }
    } else if (imgState === 'tmdb') {
      setImgState(localSlug ? 'local' : 'fallback');
    } else {
      setImgState('fallback');
    }
  };

  const imgSrc =
    imgState === 'registered' ? registeredUrl :
    imgState === 'tmdb'       ? `${TMDB_LOGO_BASE}${logoPath}` :
    imgState === 'local'      ? `/providers/${localSlug}.png` :
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
