'use client';

import { useState } from 'react';

interface PersonInfo {
  name: string;
  group: string;
}

interface WorkPreview {
  title: string;
  releaseYear: number | null;
}

export default function ChatGptPromptSection({ persons }: { persons: PersonInfo[] }) {
  const [selectedPerson, setSelectedPerson] = useState('');
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [workCount, setWorkCount] = useState(0);
  const [error, setError] = useState('');

  function reset() {
    setPrompt('');
    setError('');
    setWorkCount(0);
  }

  async function handleGenerate() {
    if (!selectedPerson) { setError('人物を選択してください'); return; }
    setLoading(true);
    reset();
    try {
      const res = await fetch(
        `/api/admin/csv-export?person=${encodeURIComponent(selectedPerson)}&mode=preview&filter=all`,
      );
      const data = await res.json() as { works?: WorkPreview[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? '作品データの取得に失敗しました');
        setLoading(false);
        return;
      }

      const works: WorkPreview[] = data.works ?? [];
      setWorkCount(works.length);

      const workLines = works.length > 0
        ? works
            .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))
            .map((w) => w.releaseYear ? `- ${w.title}（${w.releaseYear}）` : `- ${w.title}`)
            .join('\n')
        : '（なし）';

      setPrompt(buildPrompt(selectedPerson, workLines));
    } catch {
      setError('通信エラーが発生しました');
    }
    setLoading(false);
  }

  async function handleCopy() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border border-gray-200 rounded-xl p-4 mb-6 bg-white space-y-4">
      <div>
        <h2 className="text-sm font-bold text-slate-700">ChatGPT調査プロンプト生成</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          登録済み作品を除いた新規作品調査用のプロンプトを生成します。ChatGPTに貼り付けてCSVを返させてください。
        </p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={selectedPerson}
          onChange={(e) => { setSelectedPerson(e.target.value); reset(); }}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-slate-700"
        >
          <option value="">人物を選択してください</option>
          {persons.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={loading || !selectedPerson}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 font-medium"
        >
          {loading ? '生成中...' : 'プロンプト生成'}
        </button>
        {prompt && (
          <button
            onClick={handleCopy}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-700 transition-colors font-medium"
          >
            {copied ? '✓ コピー完了' : 'クリップボードへコピー'}
          </button>
        )}
        {prompt && (
          <span className="text-[11px] text-gray-400">登録済み {workCount}件 を除外済み</span>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
      )}

      {prompt && (
        <textarea
          readOnly
          value={prompt}
          rows={24}
          className="w-full text-[11px] font-mono border border-gray-200 rounded-lg p-3 bg-gray-50 resize-y focus:outline-none"
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      )}
    </div>
  );
}

function buildPrompt(personName: string, workList: string): string {
  return `対象人物：
${personName}

人物ID：
${personName}

現在登録済み作品：
${workList}

以下の人物について、TMDbで取得できていない可能性がある出演作品を調査してください。

調査対象

* ドラマ
* 映画
* バラエティ
* 配信限定番組
* アイドル番組
* 特番
* ドキュメンタリー
* 舞台映像作品
* Web配信コンテンツ

調査ルール

* 推測禁止
* 確認できた情報のみ
* 同姓同名の別人作品は除外
* 現在登録済み作品は除外
* TMDbに載っているかどうかは気にしない
* 日本国内で確認できる情報を優先
* 重複していても構わないので網羅性を優先

出力形式

CSVのみ

personName,workTitle,workType,releaseYear,roleName,vodService,availabilityType,sourceUrl,confidence,note

workTypeは以下を使用：
movie / drama / variety / documentary / special / web / stage`;
}
