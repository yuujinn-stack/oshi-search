'use client';

// 診断結果URLのコピー・共有（結果は URL パラメータだけで再現できる）。
import { useState } from 'react';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import { sendGaEvent } from '@/lib/ga-event';

export default function OshiShoppingShare({ path, text }: { path: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}${path}`;

  const copy = async () => {
    if (await copyTextWithFallback(url())) {
      setCopied(true);
      sendGaEvent('oshi_shopping_share', { method: 'copy' });
      setTimeout(() => setCopied(false), 2000);
    }
  };
  const shareX = () => {
    sendGaEvent('oshi_shopping_share', { method: 'x' });
    const intent = `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url: url() })}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="os-share">
      <button type="button" className="os-btn-sub" onClick={copy}>{copied ? 'コピーしました' : '結果のURLをコピー'}</button>
      <button type="button" className="os-btn-sub" onClick={shareX}>Xでシェア</button>
    </div>
  );
}
