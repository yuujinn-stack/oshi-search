'use client';

import type { ReactNode } from 'react';

interface Props {
  href: string;
  service: string;
  className?: string;
  children: ReactNode;
}

export default function VodTrackLink({ href, service, className, children }: Props) {
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
      rel="noopener noreferrer"
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
