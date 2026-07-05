'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { PreviewRow } from '@/app/api/admin/people-membership-import/route';
import type { PersonMeta } from '@/lib/person-meta';
import { csvDownloadSection } from '@/lib/chatGptPromptUtil';

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
  return `以下の登録済み人物について、所属情報・活動情報を補完してください。

対象グループ：${groupName}
登録済み人物数：${memberNames.length}人

対象人物一覧：
${memberList}

補完対象項目：
・activityStatus（グループ活動状態）
・generation（期別）
・joinedAt（加入日）
・leftAt（卒業/脱退日）
・currentGroupName（現在のグループ名）
・formerGroupNames（過去のグループ名）
・membershipNote（所属備考）
・primaryGenre（現在の主な活動ジャンル）
・genres（複数ジャンル）
・titles（世間的な肩書き・称号）
・publicRoles（役職）
・awards（主な受賞歴）
・careerStatus（芸能活動状態）
・roleNote（活動補足）

厳守ルール：
・推測禁止
・2026年現在の情報のみ
・必ず公式発表・公式サイト・公式プロフィールを優先
・確認できない項目は空欄
・name列は変更しない

activityStatusは以下のみ使用：
active / graduated / withdrawn / hiatus / retired / unknown

careerStatusは以下のみ使用：
active / inactive / retired / deceased / unknown

generationは「1期生」「2期生」などで記載。

joinedAt / leftAt は YYYY-MM-DD 形式（不明は空欄）。

genres / titles / publicRoles / awards はカンマ区切りで記載。

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

// ─── ① テンプレート生成セクション ────────────────────────────────────────────
function TemplateSection({
  groups,
  onUseCsv,
}: {
  groups: string[];
  onUseCsv: (csv: string) => void;
}) {
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(false);
  const [csv, setCsv] = useState('');
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<CsvHistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { copied: csvCopied, copy: copyCsv } = useCopy();
  const { copied: promptCopied, copy: copyPrompt } = useCopy();

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
        登録済みの人物データからメンバーを抽出し、CSVテンプレートを生成します。
        「ChatGPTに送る」でコピー → ChatGPTへ貼り付けて補完 → 返答を ② に貼り付けてインポートします。
      </p>

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
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">{selectedGroup} · {memberNames.length}人</span>
            <div className="ml-auto flex gap-2 flex-wrap">
              <button onClick={() => copyCsv(csv)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                {csvCopied ? 'コピー完了!' : 'CSVをコピー'}
              </button>
              <button onClick={() => downloadCsv(csv, `${selectedGroup}_membership.csv`)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                ダウンロード
              </button>
              <button onClick={() => copyPrompt(buildChatGptPrompt(selectedGroup, memberNames, csv))} className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition-colors">
                {promptCopied ? 'コピー完了!' : 'ChatGPTに送る'}
              </button>
              <button onClick={() => onUseCsv(csv)} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold transition-colors">
                インポートに使う →
              </button>
            </div>
          </div>
          <textarea
            readOnly
            value={csv}
            rows={Math.min(memberNames.length + 2, 14)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono bg-gray-50 focus:outline-none resize-none"
          />
          <p className="text-xs text-gray-400">
            テンプレート生成 → 「ChatGPTに送る」でコピー → ChatGPTへ貼り付け → 返答CSVを「インポートに使う」か ② に貼り付け
          </p>
        </div>
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

// ─── メインコンポーネント ────────────────────────────────────────────────────
interface Props {
  groups: string[];
}

export default function MembershipImportClient({ groups }: Props) {
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
        <TemplateSection groups={groups} onUseCsv={handleUseCsv} />
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
    </div>
  );
}
