'use client';

import { useState } from 'react';
import { csvDownloadSection } from '@/lib/chatGptPromptUtil';

type TargetType = 'group' | 'individual' | 'multiple' | 'free';

const TARGET_TYPE_OPTIONS: { value: TargetType; label: string }[] = [
  { value: 'group',      label: 'グループ（全メンバー）' },
  { value: 'individual', label: '個人' },
  { value: 'multiple',   label: '複数人物（名前リスト）' },
  { value: 'free',       label: '自由入力' },
];

interface PromptOptions {
  activeOnly:        boolean;
  includeGraduated:  boolean;
  includeGeneration: boolean;
  includeMembership: boolean;
  includeAliases:    boolean;
  includeReading:    boolean;
}

function buildPrompt(target: string, targetType: TargetType, opts: PromptOptions): string {
  const conditions: string[] = [];
  if (opts.activeOnly && !opts.includeGraduated) conditions.push('現役メンバーのみ（卒業・脱退メンバーは除外）');
  if (opts.includeGraduated)  conditions.push('卒業・脱退メンバーも含める');
  if (opts.includeGeneration) conditions.push('期別（何期生か）を含める');
  if (opts.includeMembership) conditions.push('所属履歴（加入日・脱退日・活動状態）を含める');
  if (opts.includeAliases)    conditions.push('別名・愛称を aliases 列に含める');
  if (opts.includeReading)    conditions.push('読み仮名を aliases 列に含める');

  const cols = ['name', 'groupName', 'genre', 'aliases'];
  const colNotes: string[] = [];

  if (opts.includeGeneration) {
    cols.push('generation');
    colNotes.push('- generation: 期別 例: 4期生（不明の場合は空欄）');
  }
  if (opts.includeMembership) {
    cols.push('activityStatus');
    cols.push('joinedAt');
    cols.push('leftAt');
    colNotes.push(
      '- activityStatus: 活動状態（active=現役 / graduated=卒業 / withdrawn=脱退 / hiatus=活動休止 / retired=引退）',
    );
    colNotes.push('- joinedAt: 加入日 形式: YYYY-MM-DD 例: 2023-03-15（不明は空欄）');
    colNotes.push('- leftAt: 卒業・脱退日 形式: YYYY-MM-DD（現役・不明は空欄）');
  }
  cols.push('description');

  const typeLabel = TARGET_TYPE_OPTIONS.find((o) => o.value === targetType)?.label ?? targetType;
  const filename = target.split('\n')[0].trim().replace(/\s+/g, '_').replace(/[^\w぀-鿿＀-￯-]/g, '') || '人物登録';

  const lines: string[] = [
    '以下の対象について、人物登録用CSVを作成してください。',
    '',
    '対象：',
    target.trim(),
    '',
    `対象タイプ：${typeLabel}`,
    '',
  ];

  if (conditions.length > 0) {
    lines.push('条件：');
    for (const c of conditions) lines.push(`・${c}`);
    lines.push('');
  }

  lines.push(
    '━━━━━━━━━━━━━━━━━━',
    '出力CSVのフォーマット',
    '━━━━━━━━━━━━━━━━━━',
    '',
    '以下のヘッダー行から始まるCSVを出力してください：',
    '',
    cols.join(','),
    '',
    '各列の説明：',
    '- name: 人物名（必須） 例: 賀喜遥香',
    '- groupName: 所属グループ名 例: 乃木坂46',
    '  ※ グループ名は正式名称で統一してください',
    '- genre: ジャンル（以下のいずれかを使用）',
    '  坂道 / 芸人 / テレビ / アーティスト / 俳優',
    '  ※ 坂道グループ（乃木坂46・櫻坂46・日向坂46等）は「坂道」を使用',
    '- aliases: 別名・読み仮名（複数ある場合はカンマ区切りでダブルクォートで囲む）',
    '  例: "かっきー,賀喜ちゃん,かきちゃん"',
    ...colNotes,
    '- description: 補足説明（任意）',
    '',
    csvDownloadSection(`${filename}_人物登録.csv`),
  );

  return lines.join('\n');
}

export default function ChatGptPersonPromptSection() {
  const [open, setOpen]   = useState(false);
  const [target, setTarget] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('group');
  const [opts, setOpts] = useState<PromptOptions>({
    activeOnly:        true,
    includeGraduated:  false,
    includeGeneration: false,
    includeMembership: false,
    includeAliases:    true,
    includeReading:    true,
  });
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  function toggleOpt(key: keyof PromptOptions) {
    setOpts((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleGenerate() {
    if (!target.trim()) return;
    setPrompt(buildPrompt(target, targetType, opts));
    setCopied(false);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* フォールバック: テキストエリア選択 */ }
  }

  return (
    <div className="border border-indigo-200 rounded-2xl overflow-hidden mb-8">
      {/* アコーディオンヘッダー */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 bg-indigo-50 hover:bg-indigo-100 transition-colors text-left"
      >
        <div>
          <span className="font-bold text-indigo-800 text-sm">
            🤖 ChatGPT 人物CSV作成プロンプト生成
          </span>
          <p className="text-xs text-indigo-600 mt-0.5">
            グループ名や人物名を入力して、ChatGPTに貼り付けられるプロンプトを自動生成します
          </p>
        </div>
        <span className="text-indigo-400 text-sm ml-4 flex-shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-5 bg-white space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 追加したい対象 */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                追加したい対象 <span className="text-red-500">*</span>
              </label>
              <textarea
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={'例：\n櫻坂46 四期生\n\nまたは複数人物の場合：\n松本和子\n浅井恋乃未\n山川宇衣'}
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none font-mono"
              />
            </div>

            {/* 対象タイプ */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">対象タイプ</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as TargetType)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {TARGET_TYPE_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* 取得範囲 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">取得範囲</label>
              <div className="space-y-1.5">
                {([
                  { key: 'activeOnly',        label: '現役メンバーのみ' },
                  { key: 'includeGraduated',  label: '卒業・脱退メンバーも含める' },
                  { key: 'includeGeneration', label: '期別を含める' },
                  { key: 'includeMembership', label: '所属履歴を含める（加入日・脱退日）' },
                  { key: 'includeAliases',    label: '別名・愛称を含める' },
                  { key: 'includeReading',    label: '読み仮名を含める' },
                ] as { key: keyof PromptOptions; label: string }[]).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={opts[key]}
                      onChange={() => toggleOpt(key)}
                      className="w-3.5 h-3.5 accent-indigo-600"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* 生成ボタン */}
          <button
            onClick={handleGenerate}
            disabled={!target.trim()}
            className="px-5 py-2.5 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            プロンプトを生成
          </button>

          {/* 生成済みプロンプト */}
          {prompt && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">生成されたプロンプト</label>
                <button
                  onClick={handleCopy}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    copied
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }`}
                >
                  {copied ? '✓ コピー済み' : 'クリップボードにコピー'}
                </button>
              </div>
              <textarea
                readOnly
                value={prompt}
                rows={16}
                className="w-full text-xs border border-gray-200 rounded-xl px-3 py-3 font-mono text-gray-700 bg-gray-50 focus:outline-none resize-y"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
              <p className="text-[11px] text-gray-400">
                ※ このプロンプトをChatGPTに貼り付け、返ってきたCSVを「人物CSV登録」フォームにインポートしてください。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
