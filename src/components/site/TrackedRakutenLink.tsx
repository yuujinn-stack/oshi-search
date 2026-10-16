'use client';

import type { AnchorHTMLAttributes } from 'react';
import { trackRakutenClick, type RakutenClickInfo } from '@/lib/rakuten-click-track';

// サーバーコンポーネントのページ（トップ・グループ・作品）で、楽天リンクの <a> を
// そのまま置き換えるための薄いラッパー。href・target・rel・className・style・子要素は
// 受け取ったものをそのまま描画し（DOM・見た目・リンク先は従来と同一）、クリック時に
// trackRakutenClick を1回呼ぶだけ。
type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  track: RakutenClickInfo | null;
};

export default function TrackedRakutenLink({ track, onClick, children, ...rest }: Props) {
  return (
    <a
      {...rest}
      onClick={(e) => {
        if (track) trackRakutenClick(track);
        onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
