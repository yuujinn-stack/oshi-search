'use client';

import { useState } from 'react';
import type { WorkRecord } from '@/types/work';

const VOD_TYPE_LABEL: Record<string, string> = {
  flatrate: '見放題',
  rent: 'レンタル',
  buy: '購入',
  free: '無料',
  ads: '広告付き',
  unknown: '不明',
};

function buildPrompt(work: WorkRecord): string {
  const vodList = (work.vodProviders ?? [])
    .filter((p) => p.providerName !== '配信確認できず')
    .map((p) => `- ${p.providerName}（${VOD_TYPE_LABEL[p.type] ?? p.type}）[${p.source}]`)
    .join('\n');
  const currentVodList = vodList || '（登録なし）';

  return `以下の作品について、日本国内で現在視聴可能な配信サービスを調査してください。

調査対象作品：
workId: ${work.id}
personName: ${work.personName}
workTitle: ${work.title}
workType: ${work.type}
releaseYear: ${work.releaseYear ?? '不明'}
roleName: ${work.roleName ?? '不明'}

現在登録されている配信情報：
${currentVodList}

調査対象サービス：
Hulu
U-NEXT
Lemino
Netflix
Prime Video
DMM TV
TELASA
FOD
ABEMA
TVer
Disney+
YouTube
NHKオンデマンド

調査ルール：
- 推測禁止
- 日本国内で現在視聴可能な情報のみ
- 公式サイト、配信サービス公式、番組公式、信頼できる情報のみ
- 過去配信のみの場合は登録しない
- 配信確認できない場合は vodService=unknown
- 1サービス1行
- workId は必ず保持
- CSV以外の文章は出力しない

出力形式：
CSVのみ

workId,vodService,availabilityType,confidence,sourceUrl,note

availabilityType は以下を使用：
flatrate
rent
buy
free
unknown`;
}

interface Props {
  work: WorkRecord;
  onClose: () => void;
}

export default function VodResearchModal({ work, onClose }: Props) {
  const prompt = buildPrompt(work);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-bold text-slate-800">配信再調査プロンプト</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate max-w-[480px]" title={work.title}>
              {work.personName} ／ {work.title}
              {work.releaseYear ? ` (${work.releaseYear})` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none ml-4 shrink-0"
          >
            ✕
          </button>
        </div>

        {/* プロンプト */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <textarea
            readOnly
            value={prompt}
            rows={20}
            className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-none focus:outline-none"
            onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          />
        </div>

        {/* フッター */}
        <div className="flex items-center gap-3 px-5 py-3 border-t border-gray-100">
          <button
            onClick={handleCopy}
            className="text-xs px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors"
          >
            {copied ? '✓ コピーしました' : 'クリップボードへコピー'}
          </button>
          <p className="text-[11px] text-gray-400 flex-1">
            ChatGPTに貼り付けてください。返却CSVはVOD CSVインポートで取り込めます。
          </p>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
