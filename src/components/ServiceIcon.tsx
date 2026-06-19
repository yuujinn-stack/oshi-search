'use client';

import { useState } from 'react';
import { normalizeProviderName } from '@/lib/vod-dedup';

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';

// Amazon Channel 系 → 親サービスのキーへマッピング
const AMAZON_CHANNEL_PARENT: Record<string, string> = {
  'fodchannelamazonchannel':        'fod',
  'telasaamazonchannel':            'telasa',
  'nhkondemandamazonchannel':       'nhkondemand',
  'danimeamazonchannel':            'danimestore',
  'danimestoreamazonchannel':       'danimestore',
  'paraviamoplusamazonchannel':     'paravi',
  'wowowamazonchannel':             'wowow',
  'wowowondemandamazonchannel':     'wowow',
  'niconicochannelplusamazonchannel': 'niconico',
};

// 正規化済みキー → 代替表示テキスト（ロゴ読み込み失敗時）
const SERVICE_ABBR: Record<string, string> = {
  'hulu':               'HU',
  'unext':              'U-N',
  'lemino':             'Le',
  'netflix':            'NF',
  'primevideo':         'PV',
  'amazonprimevideo':   'PV',
  'prime':              'PV',
  'dmmtv':              'DMM',
  'telasa':             'TE',
  'fod':                'FOD',
  'abema':              'AB',
  'abemat':             'AB',
  'disneyplus':         'D+',
  'tver':               'TVer',
  'youtube':            'YT',
  'nhkondemand':        'NHK',
  'nhkone':             'NHK',
  'nhk':                'NHK',
  'appletvplus':        'TV+',
  'appletv':            'TV+',
  'wowowondemand':      'WW',
  'wowow':              'WW',
  'bandaichannel':      'BC',
  'niconico':           'NN',
  'danimestore':        'dA',
  'danime':             'dA',
  'paravi':             'PA',
  'rakutentv':          'RT',
  'tversionrakuten':    'RT',
  'tversionrakutentv':  'RT',
  'hikari':             'HK',
  'jcomtv':             'J:C',
  'gyao':               'GY',
  'videomarket':        'VM',
  'milplus':            'mil',
  'u-next':             'U-N',
};

/** 正規化名から Amazon Channel 等の親サービスを解決したキーを返す */
function resolveServiceKey(providerName: string): string {
  const norm = normalizeProviderName(providerName);
  if (AMAZON_CHANNEL_PARENT[norm]) return AMAZON_CHANNEL_PARENT[norm];
  // 末尾に "amazonchannel" があれば汎用的に除去
  if (norm.endsWith('amazonchannel')) {
    return norm.replace(/channel?amazonchannel$/, '').replace(/channel$/, '');
  }
  return norm;
}

/** 代替テキストを返す（ロゴ読み込み失敗 / logoPath なし のとき表示） */
function getAbbr(providerName: string): string {
  const key = resolveServiceKey(providerName);
  if (SERVICE_ABBR[key]) return SERVICE_ABBR[key];
  // フォールバック: "|" 以前の先頭3文字
  const clean = providerName.replace(/\s*[|｜].*$/, '').trim();
  return clean.slice(0, 3);
}

// サイズ定義（Tailwind の JIT purge 対策: 文字列をここに集約）
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CONFIG: Record<Size, { outer: string; text: string }> = {
  xs: { outer: 'w-4 h-4',   text: 'text-[7px]' },
  sm: { outer: 'w-6 h-6',   text: 'text-[8px]' },
  md: { outer: 'w-8 h-8',   text: 'text-[9px]' },
  lg: { outer: 'w-10 h-10', text: 'text-[10px]' },
  xl: { outer: 'w-11 h-11', text: 'text-[10px]' },
};

interface Props {
  providerName: string;
  logoPath?: string;
  size?: Size;
  /** 外側 div に追加する Tailwind クラス（rounded-xl shadow など） */
  className?: string;
}

/**
 * 配信サービスアイコン（共通コンポーネント）
 *
 * - logoPath があれば TMDb 画像を表示
 * - 画像読み込み失敗時・logoPath なし → 代替テキスト（略称）を表示
 * - onError でクライアント側フォールバック処理
 */
export default function ServiceIcon({ providerName, logoPath, size = 'md', className = '' }: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const { outer, text } = SIZE_CONFIG[size];
  const abbr = getAbbr(providerName);

  return (
    <div
      className={`${outer} rounded-lg bg-white border border-gray-100 overflow-hidden flex items-center justify-center flex-shrink-0 ${className}`}
    >
      {logoPath && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${TMDB_LOGO_BASE}${logoPath}`}
          alt={providerName}
          onError={() => setImgFailed(true)}
          className="w-full h-full object-contain p-0.5"
        />
      ) : (
        <span
          className={`${text} font-bold text-gray-500 text-center leading-tight px-0.5 select-none`}
        >
          {abbr}
        </span>
      )}
    </div>
  );
}
