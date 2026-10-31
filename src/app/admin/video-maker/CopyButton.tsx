'use client';

import { useState } from 'react';

/** 動画生成の管理画面のコピーボタン（台本・音声用台本・タイトル等）。コピー後に1.5秒「コピーしました」と表示する */
export default function CopyButton({
  text,
  label,
  primary = false,
  disabled = false,
  disabledTitle,
}: {
  text: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      onClick={() => {
        if (disabled) return;
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={
        disabled
          ? 'text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
          : primary
            ? 'text-xs px-2 py-0.5 rounded border border-violet-500 bg-violet-600 text-white font-bold hover:bg-violet-700'
            : 'text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:border-violet-400 hover:text-violet-700'
      }
    >
      {copied ? 'コピーしました' : label}
    </button>
  );
}
