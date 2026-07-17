'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { PreviewRow } from '@/app/api/admin/people-membership-import/route';
import type { PersonMeta } from '@/lib/person-meta';
import { csvDownloadSection } from '@/lib/chatGptPromptUtil';
import { buildGenreRulesBlock, buildGenreExamplesBlock } from '@/lib/genre-prompt';
import { DEFAULT_GENRE_ORDER } from '@/lib/genre-utils';
import { normalizeTag } from '@/lib/person-display-tags';

// ─── フィールドラベル ─────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  activityStatus:   '活動状態',
  generation:       '期別',
  joinedAt:         '加入日',
  leftAt:           '卒業/脱退日',
  currentGroupName: '現在G',
  formerGroupNames: '過去G',
  membershipNote:   '備考',
  primaryGenre:     '主ジャンル',
  genres:           'ジャンル',
  titles:           '肩書き',
  publicRoles:      '役職',
  awards:           '受賞歴',
  careerStatus:     '活動状態(career)',
  roleNote:         '補足',
};
const STATUS_LABEL: Record<string, string> = {
  active:    '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus:    '休止中',
  retired:   '引退',
  unknown:   '不明',
};

function displayValue(field: string, value: string | undefined): string {
  if (!value) return '未設定';
  if (field === 'activityStatus') return STATUS_LABEL[value] ?? value;
  return value;
}

// ─── CSV 生成ユーティリティ ──────────────────────────────────────────────────
const CSV_HEADER = 'name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote,primaryGenre,genres,titles,publicRoles,awards,careerStatus,roleNote';

function csvCell(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return '';
  const s = arr.join(',');
  return s.includes(',') ? `"${s}"` : s;
}

function buildCsvRow(name: string, group: string, meta: PersonMeta | null): string {
  const m = meta ?? {};
  return [
    name, group,
    m.activityStatus ?? '',
    m.generation ?? '',
    m.joinedAt ?? '',
    m.leftAt ?? '',
    m.currentGroupName ?? group,
    csvCell(m.formerGroupNames),
    m.membershipNote ?? '',
    m.primaryGenre ?? '',
    csvCell(m.genres),
    csvCell(m.titles),
    csvCell(m.publicRoles),
    csvCell(m.awards),
    m.careerStatus ?? '',
    m.roleNote ?? '',
  ].join(',');
}

function generateCsvFromMembers(
  members: Array<{ name: string; group: string; meta: PersonMeta | null }>,
): string {
  return [CSV_HEADER, ...members.map((m) => buildCsvRow(m.name, m.group, m.meta))].join('\n');
}

// ─── CSV自動抽出 ─────────────────────────────────────────────────────────────
function extractCsv(raw: string): { csv: string; wasExtracted: boolean } {
  const text = raw.trim();
  if (!text) return { csv: '', wasExtracted: false };

  // Markdownコードブロック (```csv ... ``` or ``` ... ```)
  const codeBlock = text.match(/```(?:csv)?\s*\n([\s\S]*?)```/);
  if (codeBlock) {
    return { csv: codeBlock[1].trim(), wasExtracted: true };
  }

  // ヘッダー行 "name," を探して以降を抽出
  const lines = text.split('\n');
  const headerIdx = lines.findIndex((l) => /^name[,\t]/.test(l.trim()));
  if (headerIdx >= 0) {
    const csvLines: string[] = [];
    for (let i = headerIdx; i < lines.length; i++) {
      if (i > headerIdx && lines[i].trim() === '') break;
      csvLines.push(lines[i]);
    }
    const csv = csvLines.join('\n').trim();
    const wasExtracted = headerIdx > 0 || csvLines.length < lines.length;
    return { csv, wasExtracted };
  }

  return { csv: text, wasExtracted: false };
}

// ─── CSV履歴 (localStorage) ───────────────────────────────────────────────────
interface CsvHistoryItem {
  id: string;
  groupName: string;
  memberCount: number;
  csv: string;
  createdAt: number;
}

const HISTORY_KEY = 'membership-csv-history';
const HISTORY_MAX = 10;

function loadHistory(): CsvHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as CsvHistoryItem[]) : [];
  } catch { return []; }
}

function saveToHistory(item: Omit<CsvHistoryItem, 'id' | 'createdAt'>) {
  try {
    const history = loadHistory();
    const next: CsvHistoryItem = { ...item, id: Date.now().toString(), createdAt: Date.now() };
    const updated = [next, ...history].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

// ─── コピー用フック ───────────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);
  return { copied, copy };
}

// ─── ChatGPT送信用テキスト生成 ────────────────────────────────────────────────
function buildChatGptPrompt(groupName: string, memberNames: string[], csv: string): string {
  const memberList = memberNames.map((n) => `・${n}`).join('\n');
  return `以下の登録済み人物の空欄項目を調査・補完し、CSVとして返答してください。

対象グループ：${groupName}
対象人物数：${memberNames.length}人

対象人物一覧：
${memberList}

━━━━━━━━━━━━━━━━━━
厳守ルール
━━━━━━━━━━━━━━━━━━
・推測禁止。公式情報・公式サイト・公式プロフィールのみを使用してください
・2026年現在の情報のみ記載してください
・確認できない項目は空欄のままにしてください
・name 列は変更しないでください
・返答はCSVのみ（コードブロック可）。説明文・前置きは不要です
・ヘッダー行・人数は変更しないでください

━━ 値の制約 ━━
activityStatus: active / graduated / withdrawn / hiatus / retired / unknown
careerStatus:   active / inactive / retired / deceased / unknown
generation:     「1期生」「2期生」などで記載（不明は空欄）
joinedAt / leftAt: YYYY-MM-DD 形式（不明は空欄）
genres / titles / publicRoles / awards: カンマ区切りで記載

━━ 各フィールド補足 ━━
currentGroupName: 2026年現在も現役所属しているグループのみ記載。卒業済みは空欄。
formerGroupNames: 過去の所属グループをすべてカンマ区切りで記載。
roleNote: 現在の活動を簡潔に（例: 現在は女優・タレントとして活動。舞台・ドラマ・映画に出演。）

${buildGenreRulesBlock()}

${buildGenreExamplesBlock()}

━━━━━━━━━━━━━━━━━━
補完対象CSV（以下の空欄を埋めて、同じヘッダー・同じ行数で返してください）
━━━━━━━━━━━━━━━━━━

${csv}
${csvDownloadSection(`${groupName}_所属情報.csv`)}`;
}

// ─── ダウンロード ─────────────────────────────────────────────────────────────
function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── アコーディオン ───────────────────────────────────────────────────────────
function Accordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="font-bold text-slate-800 text-sm">{title}</span>
        <span className="text-gray-400 text-xs">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── CSV結果アクションボタン群（グループ・個人共通） ─────────────────────────
function CsvActions({
  csv,
  label,
  memberNames,
  onUseCsv,
}: {
  csv: string;
  label: string;
  memberNames: string[];
  onUseCsv: (csv: string) => void;
}) {
  const { copied: csvCopied, copy: copyCsv } = useCopy();
  const { copied: promptCopied, copy: copyPrompt } = useCopy();
  const [showPrompt, setShowPrompt] = useState(false);
  const groupName = memberNames.length === 1 ? memberNames[0] : label;
  const fullPrompt = buildChatGptPrompt(groupName, memberNames, csv);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 font-medium">{label}</p>

      {/* ── A. CSVテンプレート ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">A. CSVテンプレート</span>
          <span className="text-[11px] text-gray-400">空欄を補完してもらう元データ</span>
          <div className="ml-auto flex gap-2 flex-wrap">
            <button
              onClick={() => copyCsv(csv)}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {csvCopied ? '✓ コピー完了' : 'CSVをコピー'}
            </button>
            <button
              onClick={() => downloadCsv(csv, `${groupName}_membership.csv`)}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ダウンロード
            </button>
            <button
              onClick={() => onUseCsv(csv)}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors"
            >
              インポートに使う →
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={csv}
          rows={Math.min(memberNames.length + 2, 12)}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono bg-gray-50 focus:outline-none resize-none"
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
        />
      </div>

      {/* ── B. ChatGPT送信用プロンプト ── */}
      <div className="border border-indigo-200 rounded-xl overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-indigo-800">B. ChatGPT送信用プロンプト</p>
            <p className="text-[11px] text-indigo-500 mt-0.5">
              ジャンルルール・canonical一覧・表記ゆれ禁止・分類例 + CSVテンプレート込み
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowPrompt((v) => !v)}
              className="text-xs px-3 py-1.5 border border-indigo-300 rounded-lg text-indigo-600 hover:bg-indigo-100 transition-colors"
            >
              {showPrompt ? '▲ 閉じる' : '▼ 内容を確認する'}
            </button>
            <button
              onClick={() => copyPrompt(fullPrompt)}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition-colors"
            >
              {promptCopied ? '✓ コピー完了' : '📋 プロンプトをコピー（ChatGPTに送る）'}
            </button>
          </div>
        </div>

        {/* プロンプト全文プレビュー（展開時） */}
        {showPrompt && (
          <div className="px-4 py-3 bg-white border-t border-indigo-100 space-y-2">
            <p className="text-[11px] text-indigo-600 font-medium">
              ↓ ChatGPTに送られる内容の全文（「プロンプトをコピー」でこの全文がコピーされます）
            </p>
            <textarea
              readOnly
              value={fullPrompt}
              rows={24}
              className="w-full border border-indigo-200 rounded-xl px-4 py-3 text-xs font-mono bg-indigo-50/40 focus:outline-none resize-y"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
        )}

        {/* フッター */}
        <div className="px-4 py-2.5 bg-indigo-50/50 border-t border-indigo-100">
          <p className="text-[11px] text-indigo-500">
            手順: 「プロンプトをコピー」→ ChatGPTへ貼り付け → 返答CSVを「インポートに使う」か ② に貼り付け
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 複数人更新サブセクション ─────────────────────────────────────────────────
const MAX_MULTI_PERSONS = 100;

function MultiPersonTemplateSubsection({
  persons,
  onUseCsv,
}: {
  persons: Array<{ name: string; group: string; genre?: string; aliases?: string[] }>;
  onUseCsv: (csv: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Array<{ name: string; group: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');

  const selectedNames = useMemo(() => new Set(selected.map((s) => s.name)), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return persons
      .filter((p) => !selectedNames.has(p.name))
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          (p.genre?.toLowerCase().includes(q) ?? false) ||
          (p.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false),
      )
      .slice(0, 10);
  }, [query, persons, selectedNames]);

  function addPerson(p: { name: string; group: string }) {
    if (selectedNames.has(p.name)) return;
    if (selected.length >= MAX_MULTI_PERSONS) {
      setError(`最大${MAX_MULTI_PERSONS}人まで選択できます。一部解除してから追加してください。`);
      return;
    }
    setSelected((prev) => [...prev, { name: p.name, group: p.group }]);
    setQuery('');
    setCsv('');
    setError('');
  }

  function removePerson(name: string) {
    setSelected((prev) => prev.filter((s) => s.name !== name));
    setCsv('');
  }

  function clearAll() {
    setSelected([]);
    setCsv('');
    setError('');
  }

  async function generate() {
    if (selected.length === 0) return;
    setLoading(true); setError(''); setCsv('');
    try {
      const param = selected.map((s) => encodeURIComponent(s.name)).join(',');
      const res = await fetch(`/api/admin/people-membership-import?persons=${param}`);
      const data = await res.json() as {
        members?: Array<{ name: string; group: string; meta: PersonMeta | null }>;
        error?: string;
      };
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return; }
      const members = data.members ?? [];
      if (members.length === 0) { setError('人物データを取得できませんでした'); return; }
      setCsv(generateCsvFromMembers(members));
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  const atLimit = selected.length >= MAX_MULTI_PERSONS;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        グループや所属に関係なく複数人を選択してCSVテンプレートを生成します。
        ChatGPTで補完後、② にインポートします。
      </p>

      {/* 選択カウント + 全解除 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">
          選択中{' '}
          <span className={selected.length > 0 ? 'text-indigo-600' : 'text-gray-400'}>
            {selected.length}人
          </span>
          {atLimit && (
            <span className="ml-2 text-xs text-amber-600 font-normal">（上限）</span>
          )}
        </span>
        {selected.length > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-red-400 hover:text-red-600 transition-colors"
          >
            選択をすべて解除
          </button>
        )}
      </div>

      {/* 選択済みチップ */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
          {selected.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1 bg-white border border-indigo-200 text-indigo-800 text-xs font-medium px-2.5 py-1 rounded-full shadow-sm"
            >
              {p.name}
              {p.group && (
                <span className="text-indigo-400 text-[10px] hidden sm:inline">({p.group})</span>
              )}
              <button
                onClick={() => removePerson(p.name)}
                className="ml-0.5 text-indigo-300 hover:text-indigo-600 font-bold leading-none"
                aria-label={`${p.name}を解除`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 検索ボックス */}
      <div className="relative">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          人物を検索して追加（名前・別名・グループ・ジャンル）
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setError(''); }}
          placeholder="例: 橋本環奈 / 乃木坂 / アイドル / かんな"
          disabled={atLimit}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
        />
        {filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {filtered.map((p) => (
              <button
                key={p.name}
                onClick={() => addPerson(p)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-indigo-50 transition-colors"
              >
                <span className="font-medium text-slate-700">{p.name}</span>
                {p.group && <span className="text-xs text-gray-400">{p.group}</span>}
                {p.genre && !p.group && (
                  <span className="text-xs text-gray-300">{p.genre}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {atLimit && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          最大{MAX_MULTI_PERSONS}人に達しました。追加するには、選択済みから一部解除してください。
        </p>
      )}

      <button
        onClick={generate}
        disabled={loading || selected.length === 0}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? '生成中…' : 'テンプレートを生成'}
      </button>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {csv && selected.length > 0 && (
        <CsvActions
          csv={csv}
          label={`複数人更新 · ${selected.length}人`}
          memberNames={selected.map((s) => s.name)}
          onUseCsv={onUseCsv}
        />
      )}
    </div>
  );
}

// ─── 個人更新サブセクション ───────────────────────────────────────────────────
function PersonTemplateSubsection({
  persons,
  onUseCsv,
}: {
  persons: Array<{ name: string; group: string; genre?: string; aliases?: string[] }>;
  onUseCsv: (csv: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ name: string; group: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return persons.filter((p) => p.name.includes(q)).slice(0, 8);
  }, [query, persons]);

  function selectPerson(p: { name: string; group: string }) {
    setSelected(p);
    setQuery('');
    setCsv('');
    setError('');
  }

  async function generate() {
    if (!selected) return;
    setLoading(true); setError(''); setCsv('');
    try {
      const res = await fetch(
        `/api/admin/people-membership-import?person=${encodeURIComponent(selected.name)}`,
      );
      const data = await res.json() as {
        members?: Array<{ name: string; group: string; meta: PersonMeta | null }>;
        error?: string;
      };
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return; }
      const members = data.members ?? [];
      if (members.length === 0) { setError('人物データを取得できませんでした'); return; }
      setCsv(generateCsvFromMembers(members));
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        人物を1人選択してCSVテンプレートを生成します。ChatGPTで補完後、② にインポートします。
      </p>

      {/* 検索ボックス */}
      <div className="relative">
        <label className="block text-xs font-medium text-gray-600 mb-1">人物を検索</label>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setCsv(''); }}
          placeholder="名前を入力… 例: 菅井友香"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {filtered.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
            {filtered.map((p) => (
              <button
                key={p.name}
                onClick={() => selectPerson(p)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-indigo-50 transition-colors"
              >
                <span className="font-medium text-slate-700">{p.name}</span>
                {p.group && <span className="text-xs text-gray-400">{p.group}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 選択済み表示 */}
      {selected && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-semibold text-indigo-800">{selected.name}</span>
          {selected.group && <span className="text-xs text-indigo-500">{selected.group}</span>}
          <button
            onClick={() => { setSelected(null); setCsv(''); inputRef.current?.focus(); }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
          >
            ✕ 変更
          </button>
        </div>
      )}

      <button
        onClick={generate}
        disabled={loading || !selected}
        className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {loading ? '生成中…' : 'テンプレートを生成'}
      </button>

      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {csv && selected && (
        <CsvActions
          csv={csv}
          label={`${selected.name}${selected.group ? ` · ${selected.group}` : ''}`}
          memberNames={[selected.name]}
          onUseCsv={onUseCsv}
        />
      )}
    </div>
  );
}

// ─── ① テンプレート生成セクション ────────────────────────────────────────────
function TemplateSection({
  groups,
  persons,
  onUseCsv,
}: {
  groups: string[];
  persons: Array<{ name: string; group: string; genre?: string; aliases?: string[] }>;
  onUseCsv: (csv: string) => void;
}) {
  const [mode, setMode] = useState<'group' | 'person' | 'multi'>('group');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [csv, setCsv] = useState('');
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<CsvHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  async function generate() {
    if (!selectedGroup) { setError('グループを選択してください'); return; }
    setLoading(true); setError(''); setCsv(''); setMemberNames([]);
    try {
      const res = await fetch(
        `/api/admin/people-membership-import?group=${encodeURIComponent(selectedGroup)}`,
      );
      const data = await res.json() as {
        members?: Array<{ name: string; group: string; meta: PersonMeta | null }>;
        error?: string;
      };
      if (!res.ok) { setError(data.error ?? 'エラーが発生しました'); return; }
      const members = data.members ?? [];
      if (members.length === 0) { setError('このグループに登録済みのメンバーがいません'); return; }
      const names = members.map((m) => m.name);
      const generated = generateCsvFromMembers(members);
      setMemberNames(names);
      setCsv(generated);
      saveToHistory({ groupName: selectedGroup, memberCount: names.length, csv: generated });
      setHistory(loadHistory());
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        登録済みの人物データからCSVテンプレートを生成します。
        「ChatGPTに送る」でコピー → ChatGPTへ貼り付けて補完 → 返答を ② に貼り付けてインポートします。
      </p>

      {/* モード切替 */}
      <div className="flex gap-4 flex-wrap">
        {([
          ['group', 'グループ更新'],
          ['person', '個人更新'],
          ['multi', '複数人更新'],
        ] as const).map(([val, label]) => (
          <label key={val} className="flex items-center gap-1.5 cursor-pointer select-none text-sm font-medium text-slate-700">
            <input
              type="radio"
              name="templateMode"
              value={val}
              checked={mode === val}
              onChange={() => { setMode(val); setCsv(''); setError(''); setMemberNames([]); }}
              className="accent-indigo-600"
            />
            {label}
          </label>
        ))}
      </div>

      {/* 複数人更新モード */}
      {mode === 'multi' && (
        <MultiPersonTemplateSubsection persons={persons} onUseCsv={onUseCsv} />
      )}

      {/* 個人更新モード */}
      {mode === 'person' && (
        <PersonTemplateSubsection persons={persons} onUseCsv={onUseCsv} />
      )}

      {/* グループ更新モード */}
      {mode === 'group' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">グループを選択</label>
              <select
                value={selectedGroup}
                onChange={(e) => { setSelectedGroup(e.target.value); setCsv(''); setError(''); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">グループを選択…</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <button
              onClick={generate}
              disabled={loading || !selectedGroup}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? '生成中…' : 'テンプレートを生成'}
            </button>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          {csv && (
            <CsvActions
              csv={csv}
              label={`${selectedGroup} · ${memberNames.length}人`}
              memberNames={memberNames}
              onUseCsv={onUseCsv}
            />
          )}

          {/* CSV履歴 */}
          {history.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                {historyOpen ? '▲' : '▼'} 過去のCSV履歴 ({history.length}件)
              </button>
              {historyOpen && (
                <div className="mt-2 space-y-1.5">
                  {history.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-medium text-slate-700">{item.groupName}</span>
                      <span className="text-gray-400">{item.memberCount}人</span>
                      <span className="text-gray-300">{new Date(item.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <div className="ml-auto flex gap-2">
                        <button
                          onClick={() => downloadCsv(item.csv, `${item.groupName}_membership_${item.id}.csv`)}
                          className="text-indigo-600 hover:underline"
                        >
                          ダウンロード
                        </button>
                        <button
                          onClick={() => onUseCsv(item.csv)}
                          className="text-green-600 hover:underline"
                        >
                          インポートに使う
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ② CSVインポートセクション ─────────────────────────────────────────────
const CSV_EXAMPLE = `name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote
菅井友香,欅坂46,graduated,1期生,2015-08,2022-09,,欅坂46,
守屋茜,欅坂46,graduated,2期生,2017-08,2023-03,,欅坂46,
賀喜遥香,乃木坂46,active,4期生,2020-01-05,,乃木坂46,,`;

interface ApplyResult {
  updated: number;
  skipped: number;
  groupsCreated: number;
  errors: string[];
}

interface PreviewData {
  rows: PreviewRow[];
  summary: { total: number; toUpdate: number; toSkip: number };
}

type Step = 'input' | 'preview' | 'done';

// ── 人物ごとの差分カード ─────────────────────────────────────────────────────
function DiffCard({ row }: { row: PreviewRow }) {
  if (row.duplicate) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 opacity-70">
        <p className="text-xs font-medium text-amber-700">
          {row.name}
          {row.groupName && <span className="font-normal ml-1">({row.groupName})</span>}
          <span className="ml-2 text-[10px] bg-amber-200 text-amber-600 px-1.5 py-0.5 rounded-full">重複行・スキップ</span>
        </p>
      </div>
    );
  }

  if (!row.found) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 opacity-60">
        <p className="text-xs font-medium text-gray-400">
          {row.name}
          {row.groupName && <span className="font-normal ml-1">({row.groupName})</span>}
          <span className="ml-2 text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full">未登録・スキップ</span>
        </p>
      </div>
    );
  }

  if (!row.hasChanges) {
    return (
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-xs font-medium text-gray-400">
          {row.name}
          {row.groupName && <span className="font-normal ml-1">({row.groupName})</span>}
          <span className="ml-2 text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">変更なし</span>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3 space-y-2">
      <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
        {row.name}
        {row.groupName && <span className="font-normal text-gray-400">({row.groupName})</span>}
        <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">更新 {row.changes.length}件</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {row.changes.map((ch, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="text-gray-500 w-20 flex-shrink-0">{FIELD_LABEL[ch.field] ?? ch.field}</span>
            {ch.action === 'clear' ? (
              <span className="flex items-center gap-1">
                <span className="text-gray-400 bg-gray-100 px-1.5 rounded line-through">{ch.oldValue ?? '未設定'}</span>
                <span className="text-gray-300">→</span>
                <span className="text-red-500">削除</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 flex-wrap">
                <span className="text-gray-400 bg-gray-100 px-1.5 rounded">{displayValue(ch.field, ch.oldValue)}</span>
                <span className="text-gray-300">→</span>
                <span className="text-indigo-700 font-semibold bg-indigo-100 px-1.5 rounded">{displayValue(ch.field, ch.newValue)}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportSection({
  externalCsv,
  onCsvChange,
}: {
  externalCsv: string;
  onCsvChange: (v: string) => void;
}) {
  const [step, setStep] = useState<Step>('input');
  const [csv, setCsvLocal] = useState(externalCsv);
  const [extractedNotice, setExtractedNotice] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (externalCsv) {
      setCsvLocal(externalCsv);
      setStep('input');
      setPreview(null);
      setResult(null);
      setError('');
      setExtractedNotice('');
    }
  }, [externalCsv]);

  function setCsv(v: string) {
    setCsvLocal(v);
    onCsvChange(v);
  }

  function handleRawInput(raw: string) {
    const { csv: extracted, wasExtracted } = extractCsv(raw);
    if (wasExtracted) {
      setCsv(extracted);
      setExtractedNotice('CSVを自動抽出しました');
      setTimeout(() => setExtractedNotice(''), 3000);
    } else {
      setCsv(raw);
      setExtractedNotice('');
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => handleRawInput(ev.target?.result as string ?? '');
    reader.readAsText(file, 'utf-8');
  }

  async function handlePreview() {
    if (!csv.trim()) { setError('CSVを入力してください'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/people-membership-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, action: 'preview' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'プレビュー失敗'); return; }
      setPreview(data as PreviewData);
      setStep('preview');
      setShowSkipped(false);
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  async function handleApply() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/admin/people-membership-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, action: 'apply' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? '適用失敗'); return; }
      setResult(data as ApplyResult);
      setStep('done');
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep('input'); setCsv(''); setPreview(null); setResult(null);
    setError(''); setExtractedNotice('');
  }

  // ── 入力ステップ ──────────────────────────────────────────────────────────
  if (step === 'input') {
    const rowCount = csv.trim() ? csv.trim().split('\n').length - 1 : 0;
    return (
      <div className="space-y-5">
        {/* フォーマット説明 */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs space-y-2">
          <p className="font-semibold text-slate-700">CSVフォーマット</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-1">
            {[
              ['name', '人物名（必須・キー）'],
              ['groupName', '所属グループ（GroupMeta自動作成）'],
              ['activityStatus', 'active / graduated / withdrawn / hiatus / retired / unknown'],
              ['generation', '例: 1期生'],
              ['joinedAt', '加入日 例: 2020-01'],
              ['leftAt', '卒業/脱退日 例: 2023-03'],
              ['currentGroupName', '現在の所属G'],
              ['formerGroupNames', 'カンマ区切り 例: 欅坂46,日向坂46'],
              ['membershipNote', '備考テキスト'],
            ].map(([col, desc]) => (
              <div key={col} className="flex gap-2">
                <code className="text-indigo-700 bg-indigo-50 px-1 rounded flex-shrink-0">{col}</code>
                <span className="text-gray-500">{desc}</span>
              </div>
            ))}
          </div>
          <p className="text-amber-700 font-medium mt-1">
            空欄 → 既存値を保持 ／ <code className="bg-amber-50 px-1 rounded">**clear**</code> → 値を削除
          </p>
          <p className="text-green-700">
            ChatGPTの返答をそのまま貼り付けてもOKです。コードブロック・前後の文章も自動で除去します。
          </p>
        </div>

        {/* 入力エリア */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm font-semibold text-slate-700">CSV入力</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-indigo-600 hover:bg-indigo-50"
            >
              ファイルを選択
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            <button
              type="button"
              onClick={() => handleRawInput(CSV_EXAMPLE)}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              サンプルを挿入
            </button>
            {rowCount > 0 && <span className="text-xs text-gray-400 ml-auto">{rowCount}行</span>}
          </div>

          {extractedNotice && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
              <span>✓</span> {extractedNotice}
            </p>
          )}

          <textarea
            value={csv}
            onChange={(e) => handleRawInput(e.target.value)}
            rows={12}
            placeholder={`ChatGPTの返答をそのまま貼り付けてください。コードブロックや前後の文章は自動で除去されます。\n\n例:\n${CSV_HEADER}\n...`}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <button
          onClick={handlePreview}
          disabled={loading || !csv.trim()}
          className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'プレビュー中…' : 'プレビュー →'}
        </button>
      </div>
    );
  }

  // ── プレビューステップ ────────────────────────────────────────────────────
  if (step === 'preview' && preview) {
    const { rows, summary } = preview;
    const updateRows = rows.filter((r) => r.found && r.hasChanges);
    const skipRows = rows.filter((r) => !r.found || !r.hasChanges);

    return (
      <div className="space-y-5">
        {/* サマリーカード */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '合計行数', value: summary.total, cls: 'bg-gray-50 border-gray-200 text-slate-700' },
            { label: '更新予定', value: summary.toUpdate, cls: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
            { label: 'スキップ', value: summary.toSkip, cls: 'bg-amber-50 border-amber-200 text-amber-700' },
          ].map((s) => (
            <div key={s.label} className={`border rounded-xl px-4 py-3 text-center ${s.cls}`}>
              <p className="text-xs mb-1">{s.label}</p>
              <p className="text-2xl font-black">{s.value}</p>
            </div>
          ))}
        </div>

        {/* 更新予定の人物ごとの差分 */}
        {updateRows.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">更新内容</p>
            {updateRows.map((row, i) => <DiffCard key={i} row={row} />)}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-4">更新対象がありません</p>
        )}

        {/* スキップ行（折りたたみ） */}
        {skipRows.length > 0 && (
          <div>
            <button
              onClick={() => setShowSkipped((v) => !v)}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              {showSkipped ? '▲' : '▼'} スキップ・変更なし ({skipRows.length}件)
            </button>
            {showSkipped && (
              <div className="mt-2 space-y-1.5">
                {skipRows.map((row, i) => <DiffCard key={i} row={row} />)}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={handleApply}
            disabled={loading || summary.toUpdate === 0}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '適用中…' : `${summary.toUpdate}件を適用する`}
          </button>
          <button
            onClick={() => setStep('input')}
            className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50"
          >
            ← 修正する
          </button>
        </div>
      </div>
    );
  }

  // ── 完了ステップ ──────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '更新完了', value: result.updated, cls: 'bg-green-50 border-green-200 text-green-700' },
            { label: 'スキップ', value: result.skipped, cls: 'bg-gray-50 border-gray-200 text-gray-500' },
            { label: 'G自動作成', value: result.groupsCreated, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
            { label: 'エラー', value: result.errors.length, cls: result.errors.length > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-gray-200 text-gray-400' },
          ].map((s) => (
            <div key={s.label} className={`border rounded-xl px-4 py-3 text-center ${s.cls}`}>
              <p className="text-xs mb-1">{s.label}</p>
              <p className="text-2xl font-black">{s.value}</p>
            </div>
          ))}
        </div>

        {result.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs space-y-1">
            <p className="font-semibold text-red-700">エラー詳細</p>
            {result.errors.map((e, i) => <p key={i} className="text-red-600">{e}</p>)}
          </div>
        )}

        <div className="flex gap-3 flex-wrap">
          <a href="/admin/work-check" className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">
            作品管理で確認 →
          </a>
          <a href="/admin/groups" className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
            グループ管理 →
          </a>
          <button onClick={reset} className="px-4 py-2.5 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50">
            もう一度
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── ③ ジャンル直接編集セクション ───────────────────────────────────────────
function GenreEditSection({
  persons,
}: {
  persons: Array<{ name: string; group: string; genre?: string; aliases?: string[] }>;
}) {
  const [query, setQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<{ name: string; group: string } | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [primaryGenre, setPrimaryGenre] = useState('');
  const [genres, setGenres] = useState<string[]>([]);
  const [genreInput, setGenreInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<'saved' | null>(null);
  const [saveError, setSaveError] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || selectedPerson) return [];
    return persons
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.group.toLowerCase().includes(q) ||
          (p.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false),
      )
      .slice(0, 8);
  }, [query, persons, selectedPerson]);

  const genreSuggestions = useMemo(() => {
    const q = genreInput.trim().toLowerCase();
    const genreSet = new Set(genres);
    if (!q) return (DEFAULT_GENRE_ORDER as readonly string[]).filter((g) => !genreSet.has(g)).slice(0, 6);
    return (DEFAULT_GENRE_ORDER as readonly string[])
      .filter((g) => g.toLowerCase().includes(q) && !genreSet.has(g))
      .slice(0, 8);
  }, [genreInput, genres]);

  async function fetchMeta(name: string): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/admin/people-membership-import?person=${encodeURIComponent(name)}`,
      );
      const data = await res.json() as { members?: Array<{ meta: PersonMeta | null }> };
      const meta = data.members?.[0]?.meta ?? {};
      setPrimaryGenre(meta.primaryGenre ?? '');
      setGenres(meta.genres ?? []);
      return true;
    } catch {
      return false;
    }
  }

  async function loadMeta(person: { name: string; group: string }) {
    setSelectedPerson(person);
    setQuery('');
    setSaveResult(null);
    setSaveError('');
    setMetaLoading(true);
    const ok = await fetchMeta(person.name);
    if (!ok) setSaveError('メタデータの取得に失敗しました');
    setMetaLoading(false);
  }

  function clearPerson() {
    setSelectedPerson(null);
    setQuery('');
    setPrimaryGenre('');
    setGenres([]);
    setSaveResult(null);
    setSaveError('');
  }

  function addGenre(g: string) {
    const norm = normalizeTag(g.trim());
    if (!norm || genres.includes(norm)) return;
    setGenres((prev) => [...prev, norm]);
    setGenreInput('');
  }

  function removeGenre(g: string) {
    setGenres((prev) => prev.filter((x) => x !== g));
  }

  async function save() {
    if (!selectedPerson) return;
    setSaving(true);
    setSaveResult(null);
    setSaveError('');
    try {
      const res = await fetch('/api/admin/person-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: selectedPerson.name,
          primaryGenre: primaryGenre.trim() || undefined,
          genres,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setSaveError(d.error ?? '保存に失敗しました');
        return;
      }
      setSaveResult('saved');
      // 保存後に再取得して値を確認
      await fetchMeta(selectedPerson.name);
    } catch {
      setSaveError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        人物を選択して <code className="bg-gray-100 px-1 rounded">primaryGenre</code>・
        <code className="bg-gray-100 px-1 rounded">genres</code> を直接編集・保存します。
        検索結果カードのジャンル表示に即時反映されます。
      </p>

      {/* 人物検索 */}
      {!selectedPerson ? (
        <div className="relative">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            人物を検索（名前・グループ・別名）
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例: 平手友梨奈 / 乃木坂46"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {filtered.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {filtered.map((p) => (
                <button
                  key={p.name}
                  onClick={() => loadMeta(p)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-indigo-50 transition-colors"
                >
                  <span className="font-medium text-slate-700">{p.name}</span>
                  {p.group && <span className="text-xs text-gray-400">{p.group}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-semibold text-indigo-800">{selectedPerson.name}</span>
          {selectedPerson.group && (
            <span className="text-xs text-indigo-500">{selectedPerson.group}</span>
          )}
          <button
            onClick={clearPerson}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
          >
            ✕ 変更
          </button>
        </div>
      )}

      {metaLoading && <p className="text-xs text-gray-400 animate-pulse">読み込み中…</p>}

      {selectedPerson && !metaLoading && (
        <div className="space-y-4 border border-gray-200 rounded-xl p-4">
          {/* primaryGenre */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              primaryGenre
              <span className="ml-1 font-normal text-gray-400">（主ジャンル・1つだけ）</span>
            </label>
            <input
              type="text"
              value={primaryGenre}
              onChange={(e) => setPrimaryGenre(e.target.value)}
              placeholder="例: 女優 / アーティスト / 歌手"
              list="primary-genre-datalist"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <datalist id="primary-genre-datalist">
              {(DEFAULT_GENRE_ORDER as readonly string[]).map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <p className="text-[10px] text-gray-400 mt-1">
              空欄で保存すると primaryGenre を削除します
            </p>
          </div>

          {/* genres */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              genres
              <span className="ml-1 font-normal text-gray-400">（複数可・カンマ区切りで保存）</span>
            </label>

            {/* 現在のジャンルチップ */}
            {genres.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2 p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg">
                {genres.map((g) => (
                  <span
                    key={g}
                    className="inline-flex items-center gap-1 bg-white border border-indigo-200 text-indigo-800 text-xs font-medium px-2 py-0.5 rounded-full shadow-sm"
                  >
                    {g}
                    <button
                      onClick={() => removeGenre(g)}
                      className="text-indigo-300 hover:text-indigo-600 ml-0.5 font-bold leading-none"
                      aria-label={`${g}を削除`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => setGenres([])}
                  className="text-[10px] text-red-400 hover:text-red-600 ml-auto self-center"
                >
                  全クリア
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-400 mb-2 italic">ジャンル未設定</p>
            )}

            {/* ジャンル追加インput */}
            <div className="relative">
              <input
                type="text"
                value={genreInput}
                onChange={(e) => setGenreInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && genreInput.trim()) {
                    e.preventDefault();
                    addGenre(genreInput.trim());
                  }
                }}
                placeholder="ジャンルを入力してEnterで追加 / クリックでも追加"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              {genreInput.trim() && genreSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {genreSuggestions.map((g) => (
                    <button
                      key={g}
                      onClick={() => addGenre(g)}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-indigo-50 transition-colors text-slate-700"
                    >
                      {g}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Enterで追加。重複は自動除外。canonical表記（女優・俳優・歌手 など）が推奨されます。
            </p>
          </div>

          {/* 保存 */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中…' : 'ジャンルを保存'}
            </button>
            {saveResult === 'saved' && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 flex items-center gap-1">
                <span>✓</span> 保存しました（再取得済み）
              </p>
            )}
          </div>

          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── メインコンポーネント ────────────────────────────────────────────────────
interface Props {
  groups: string[];
  persons: Array<{ name: string; group: string; genre?: string; aliases?: string[] }>;
}

export default function MembershipImportClient({ groups, persons }: Props) {
  const [templateOpen, setTemplateOpen] = useState(true);
  const [importCsv, setImportCsv] = useState('');
  const importRef = useRef<HTMLDivElement>(null);

  function handleUseCsv(csv: string) {
    setImportCsv(csv);
    setTemplateOpen(false);
    setTimeout(() => {
      importRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }

  return (
    <div className="space-y-4">
      {/* ① テンプレート生成 + ChatGPTに送る */}
      <Accordion
        title="① 登録済み人物からCSVテンプレートを生成"
        open={templateOpen}
        onToggle={() => setTemplateOpen((v) => !v)}
      >
        <TemplateSection groups={groups} persons={persons} onUseCsv={handleUseCsv} />
      </Accordion>

      {/* ② CSVインポート */}
      <div ref={importRef}>
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <p className="font-bold text-slate-800 text-sm">② CSVインポート</p>
            <p className="text-xs text-gray-400 mt-0.5">
              ChatGPTの返答をそのまま貼り付けてください。コードブロックや前後の文章は自動で除去されます。
            </p>
          </div>
          <div className="px-5 py-5">
            <ImportSection externalCsv={importCsv} onCsvChange={setImportCsv} />
          </div>
        </div>
      </div>

      {/* ③ ジャンル直接編集 */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <p className="font-bold text-slate-800 text-sm">③ ジャンル直接編集</p>
          <p className="text-xs text-gray-400 mt-0.5">
            人物ごとに primaryGenre・genres を直接編集します。CSVなしで即時保存できます。
          </p>
        </div>
        <div className="px-5 py-5">
          <GenreEditSection persons={persons} />
        </div>
      </div>
    </div>
  );
}
