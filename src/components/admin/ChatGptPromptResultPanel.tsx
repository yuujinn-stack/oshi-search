'use client';

// ChatGPT調査用プロンプトの生成結果表示・操作パネル（共通コンポーネント）。
// work-check（人物単位の一括配信調査）と vod-recheck（選択作品の配信再調査）の両方から
// 利用し、コピー・全選択・保存の実装を二重化しない。
// コピー対象・保存対象は常に prop で渡された prompt 文字列そのもの（DOMから再構築しない）。
import { useRef, useState } from 'react';
import { copyTextWithFallback, downloadTextFile } from '@/lib/clipboard-utils';

export interface ChatGptPromptResultPanelProps {
  prompt: string;
  /** 成功メッセージに表示する作品数 */
  workCount: number;
  /** 「テキストファイルで保存」時のファイル名 */
  filename: string;
  /** 指定するとテキストエリアが編集可能になる（未指定なら読み取り専用） */
  onChangePrompt?: (text: string) => void;
}

export default function ChatGptPromptResultPanel({ prompt, workCount, filename, onChangePrompt }: ChatGptPromptResultPanelProps) {
  const [copyMsg, setCopyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleCopy() {
    const ok = await copyTextWithFallback(prompt);
    setCopyMsg(
      ok
        ? { type: 'success', text: `調査プロンプト全文をコピーしました（${workCount}作品）` }
        : { type: 'error', text: 'コピーできませんでした。下のテキストを選択してコピーしてください' },
    );
    setTimeout(() => setCopyMsg(null), 5000);
  }

  function handleSelectAll() {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  function handleSave() {
    downloadTextFile(prompt, filename);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors font-medium"
        >
          調査プロンプトをすべてコピー
        </button>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
        >
          すべて選択
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
        >
          テキストファイルで保存
        </button>
      </div>
      {copyMsg && (
        <div className={
          copyMsg.type === 'success'
            ? 'text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2'
            : 'text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2'
        }>
          {copyMsg.text}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={prompt}
        readOnly={!onChangePrompt}
        onChange={onChangePrompt ? (e) => onChangePrompt(e.target.value) : undefined}
        rows={20}
        className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-y focus:outline-none overflow-y-auto"
      />
    </div>
  );
}
