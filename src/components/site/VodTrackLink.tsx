'use client';

import type { CSSProperties, ReactNode } from 'react';

interface Props {
  href: string;
  service: string;
  className?: string;
  /** サービス別CTA配色（vod-cta.ts の getVodServiceStyle）をそのまま渡すためのstyle */
  style?: CSSProperties;
  children: ReactNode;
  /**
   * リンク先がアフィリエイトリンクの場合に true を渡すと rel に "sponsored" を付与する。
   * 未指定（false）の場合は従来どおり "noopener noreferrer" のみ（現在は全VODサービスとも
   * 未承認のためfalseで、挙動は変更していない）。承認済みのアフィリエイトリンクを設定する際に
   * 呼び出し側でtrueを渡せばよい。
   */
  sponsored?: boolean;
}

export default function VodTrackLink({ href, service, className, style, children, sponsored = false }: Props) {
  const handleClick = () => {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'vod', service }),
    }).catch(() => {});
  };

  return (
    <a
      href={href}
      target="_blank"
      rel={sponsored ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
      className={className}
      style={style}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
