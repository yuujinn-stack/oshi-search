'use client';

import { INSTAGRAM_CAPTION_MAX_LENGTH, validateCaption } from '@/lib/instagram-caption-rules';

interface Props {
  value: string;
  /** 生成時のキャプション（「生成時のキャプションに戻す」用） */
  original: string;
  onChange: (next: string) => void;
  rows?: number;
}

/**
 * 予約前のキャプション編集欄（通常予約・一括予約で共通）。保存されたキャプションがそのまま投稿される。
 * 上限（文字数・ハッシュタグ数）の判定は予約APIと同じ validateCaption を使う。
 */
export default function CaptionEditor({ value, original, onChange, rows = 8 }: Props) {
  const error = validateCaption(value);
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full text-sm border border-gray-300 rounded-lg p-3 font-sans text-slate-700"
      />
      <div className="flex items-center justify-between gap-3 mt-1">
        <button
          type="button"
          onClick={() => onChange(original)}
          disabled={value === original}
          className="text-xs text-gray-500 hover:text-violet-600 disabled:opacity-40 disabled:hover:text-gray-500"
        >
          生成時のキャプションに戻す
        </button>
        <span className={`text-[11px] ${error ? 'text-red-600' : 'text-gray-400'}`}>
          {error ?? `${value.length} / ${INSTAGRAM_CAPTION_MAX_LENGTH}`}
        </span>
      </div>
    </div>
  );
}
