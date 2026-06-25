'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { PreviewRow } from '@/app/api/admin/people-membership-import/route';
import type { PersonMeta } from '@/lib/person-meta';

// ─── フィールドラベル ─────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  activityStatus:   '活動状態',
  generation:       '期別',
  joinedAt:         '加入日',
  leftAt:           '卒業/脱退日',
  currentGroupName: '現在G',
  formerGroupNames: '過去G',
  membershipNote:   '備考',
};
const STATUS_LABEL: Record<string, string> = {
  active:    '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus:    '休止中',
  retired:   '引退',
  unknown:   '不明',
};

// ─── CSV 生成ユーティリティ ──────────────────────────────────────────────────
const CSV_HEADER = 'name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote';

function buildCsvRow(
  name: string,
  group: string,
  meta: PersonMeta | null,
): string {
  const m = meta ?? {};
  const formerStr = (m.formerGroupNames ?? []).join(',');
  const formerCell = formerStr.includes(',') ? `"${formerStr}"` : formerStr;
  return [
    name,
    group,
    m.activityStatus ?? '',
    m.generation ?? '',
    m.joinedAt ?? '',
    m.leftAt ?? '',
    m.currentGroupName ?? group,
    formerCell,
    m.membershipNote ?? '',
  ].join(',');
}

function generateCsvFromMembers(
  members: Array<{ name: string; group: string; meta: PersonMeta | null }>,
): string {
  return [CSV_HEADER, ...members.map((m) => buildCsvRow(m.name, m.group, m.meta))].join('\n');
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
function buildChatGptPrompt(csv: string): string {
  return `以下のCSVについて、
所属情報を最新情報で補完してください。

ルール

・推測禁止
・2026年現在の情報のみ
・必ず公式発表・公式サイト・公式プロフィールを優先
・存在しない情報は空欄
・name列は変更しない
・CSV以外の文章は出力しない

activityStatusは

active
graduated
withdrawn
hiatus
retired
unknown

のみ使用してください。

generationは

1期生
2期生
3期生

などで記載してください。

joinedAt
leftAt

は

YYYY-MM-DD

形式で記載してください。

formerGroupNamesは

カンマ区切りで記載してください。

${csv}`;
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
  badge,
  open,
  onToggle,
  children,
}: {
  title: string;
  badge?: string;
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
        <span className="font-bold text-slate-800 text-sm flex items-center gap-2">
          {title}
          {badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
              {badge}
            </span>
          )}
        </span>
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
  const [memberCount, setMemberCount] = useState(0);
  const [error, setError] = useState('');
  const { copied: csvCopied, copy: copyCsv } = useCopy();
  const { copied: promptCopied, copy: copyPrompt } = useCopy();

  async function generate() {
    if (!selectedGroup) { setError('グループを選択してください'); return; }
    setLoading(true); setError(''); setCsv('');
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
      setMemberCount(members.length);
      setCsv(generateCsvFromMembers(members));
    } catch { setError('通信エラーが発生しました'); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        登録済みの人物データから選択グループのメンバーを抽出し、既存の所属情報を反映したCSVテンプレートを生成します。
        「ChatGPTに送る」でコピーし、返答CSVをインポート欄に貼り付けてください。
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
            <span className="text-xs text-gray-500">{selectedGroup} · {memberCount}人</span>
            <div className="ml-auto flex gap-2 flex-wrap">
              <button
                onClick={() => copyCsv(csv)}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {csvCopied ? 'コピー完了!' : 'CSVをコピー'}
              </button>
              <button
                onClick={() => downloadCsv(csv, `${selectedGroup}_membership.csv`)}
                className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                ダウンロード
              </button>
              <button
                onClick={() => copyPrompt(buildChatGptPrompt(csv))}
                className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-semibold transition-colors"
              >
                {promptCopied ? 'コピー完了!' : 'ChatGPTに送る'}
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
            rows={Math.min(memberCount + 2, 14)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono bg-gray-50 focus:outline-none resize-none"
          />
          <p className="text-xs text-gray-400">
            ① テンプレートを生成 → ② 「ChatGPTに送る」でコピー → ③ ChatGPTへ貼り付けて補完 → ④ 返答CSVを「インポートに使う」
          </p>
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

function ImportSection({
  externalCsv,
  onCsvChange,
}: {
  externalCsv: string;
  onCsvChange: (v: string) => void;
}) {
  const [step, setStep] = useState<Step>('input');
  const [csv, setCsvLocal] = useState(externalCsv);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // externalCsv が変わったら取り込む
  useEffect(() => {
    if (externalCsv) {
      setCsvLocal(externalCsv);
      setStep('input');
      setPreview(null);
      setResult(null);
      setError('');
    }
  }, [externalCsv]);

  function setCsv(v: string) {
    setCsvLocal(v);
    onCsvChange(v);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv(ev.target?.result as string ?? '');
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
    setStep('input'); setCsv(''); setPreview(null); setResult(null); setError('');
  }

  // ── 入力ステップ ──────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="space-y-5">
        {/* フォーマット説明 */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs space-y-2">
          <p className="font-semibold text-slate-700">CSVフォーマット</p>
          <p className="text-gray-500">1行目はヘッダー行（列名）。<code className="bg-white px-1 rounded border border-gray-200">name</code> をキーに人物を特定します。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2">
            {[
              ['name', '人物名（必須・キー）'],
              ['groupName', '所属グループ（GroupMeta自動作成に使用）'],
              ['activityStatus', 'active / graduated / withdrawn / hiatus / retired / unknown'],
              ['generation', '例: 1期生、2期'],
              ['joinedAt', '加入日 例: 2020-01'],
              ['leftAt', '卒業/脱退日 例: 2023-03'],
              ['currentGroupName', '現在の所属G（GroupMeta自動作成）'],
              ['formerGroupNames', 'カンマ区切り 例: 欅坂46,日向坂46'],
              ['membershipNote', '備考テキスト'],
            ].map(([col, desc]) => (
              <div key={col} className="flex gap-2">
                <code className="text-indigo-700 bg-indigo-50 px-1 rounded flex-shrink-0">{col}</code>
                <span className="text-gray-500">{desc}</span>
              </div>
            ))}
          </div>
          <p className="text-amber-700 font-medium mt-2">
            空欄 → 既存値を保持 ／ <code className="bg-amber-50 px-1 rounded">**clear**</code> → 値を削除
          </p>
        </div>

        {/* 入力エリア */}
        <div className="space-y-3">
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
              onClick={() => setCsv(CSV_EXAMPLE)}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-50"
            >
              サンプルを挿入
            </button>
            {csv && (
              <span className="text-xs text-gray-400 ml-auto">
                {csv.trim().split('\n').length - 1}行
              </span>
            )}
          </div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={12}
            placeholder={`name,groupName,activityStatus,...\n（① でChatGPTに送り、返ってきたCSVをここに貼り付けてください）`}
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
    return (
      <div className="space-y-5">
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

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-4 py-2 font-medium">名前</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 font-medium">変更内容</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row, i) => (
                  <tr key={i} className={!row.found ? 'bg-gray-50 opacity-60' : row.hasChanges ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-slate-700 whitespace-nowrap">
                      {row.name}
                      {row.groupName && <span className="text-gray-400 font-normal ml-1">({row.groupName})</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {!row.found ? (
                        <span className="text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">スキップ</span>
                      ) : !row.hasChanges ? (
                        <span className="text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">変更なし</span>
                      ) : (
                        <span className="text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">更新</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.hasChanges ? (
                        <div className="flex flex-wrap gap-1.5">
                          {row.changes.map((ch, j) => (
                            <span key={j} className="flex items-center gap-1 text-[11px]">
                              <span className="text-gray-500">{FIELD_LABEL[ch.field] ?? ch.field}:</span>
                              {ch.action === 'clear' ? (
                                <span className="line-through text-red-400">{ch.oldValue}</span>
                              ) : (
                                <>
                                  {ch.oldValue && (
                                    <span className="line-through text-gray-300">
                                      {ch.field === 'activityStatus' ? (STATUS_LABEL[ch.oldValue] ?? ch.oldValue) : ch.oldValue}
                                    </span>
                                  )}
                                  <span className="text-indigo-700 font-medium">
                                    {ch.field === 'activityStatus' ? (STATUS_LABEL[ch.newValue ?? ''] ?? ch.newValue) : ch.newValue}
                                  </span>
                                </>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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
              ①でテンプレートを生成 → 「ChatGPTに送る」でコピー → ChatGPTへ貼り付けて補完 → 返答CSVをここに貼り付けてインポート
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
