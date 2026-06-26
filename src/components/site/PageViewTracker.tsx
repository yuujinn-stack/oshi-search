'use client';

import { useEffect } from 'react';

const DEDUP_MS = 30 * 60 * 1000; // 30分

interface Props {
  entity: 'person' | 'group';
  slug: string;
}

export default function PageViewTracker({ entity, slug }: Props) {
  useEffect(() => {
    const key = `view-tracked:${entity}:${slug}`;
    try {
      const last = parseInt(localStorage.getItem(key) ?? '0', 10);
      if (Date.now() - last < DEDUP_MS) return;
      localStorage.setItem(key, String(Date.now()));
    } catch {
      // localStorage 使用不可の場合も記録は続行
    }

    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view', entity, slug }),
    }).catch(() => {});
  }, [entity, slug]);

  return null;
}
