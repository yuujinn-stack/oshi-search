'use client';

import { SCHEDULABLE_TEMPLATES } from '@/lib/instagram-templates';

export type TemplateMethod = 'rotation' | 'manual';
/** 手動選択の入力方法：時刻ごとに指定（1日分の並び）／順番に並べる（テンプレ列。同じテンプレの重複も可） */
export type ManualStyle = 'slot' | 'sequence';

interface Props {
  method: TemplateMethod;
  onMethodChange: (m: TemplateMethod) => void;
  /** 手動選択の入力方法（「最大7日分まで予約」とは連動しない） */
  manualStyle: ManualStyle;
  onManualStyleChange: (s: ManualStyle) => void;
  /** 1日の投稿時刻（例: ['09:00', '15:00']） */
  dailySlots: readonly string[];
  rotation: string[];
  onRotationChange: (next: string[]) => void;
  bySlot: Record<string, string>;
  onBySlotChange: (next: Record<string, string>) => void;
  sequence: string[];
  onSequenceChange: (next: string[]) => void;
}

const TEMPLATES = SCHEDULABLE_TEMPLATES;

function TemplateSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm border rounded-lg px-3 py-1.5 min-w-0 max-w-full ${value ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`}
    >
      <option value="">選択してください</option>
      {TEMPLATES.map((t) => (
        <option key={t.id} value={t.id}>{t.label}</option>
      ))}
    </select>
  );
}

/**
 * 一括予約「人物固定・テンプレを変える」のテンプレート設定（1人の人物に使うテンプレートの並び）。
 * 人物ごとにこの並びをすべて使ってから次の人物へ進む（instagram-template-plan.ts の planFixedPersonSchedule）。
 * 自動ローテーション＝使うテンプレートを複数選び、選んだ順。
 * 手動で選択＝「時刻ごとに指定」（時刻順の並び）か「順番に並べる」（テンプレート列）を選ぶ。
 * 選択肢は予約できる全テンプレート（既存4テンプレート＋H）。
 */
export default function TemplatePlanSettings({
  method, onMethodChange, manualStyle, onManualStyleChange, dailySlots, rotation, onRotationChange, bySlot, onBySlotChange, sequence, onSequenceChange,
}: Props) {
  function toggleRotation(id: string) {
    onRotationChange(rotation.includes(id) ? rotation.filter((x) => x !== id) : [...rotation, id]);
  }
  function moveSeq(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= sequence.length) return;
    const next = [...sequence];
    [next[i], next[j]] = [next[j], next[i]];
    onSequenceChange(next);
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-1.5">テンプレート設定方法</p>
        <div className="flex gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
          {([['rotation', '自動ローテーション'], ['manual', '手動で選択']] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => onMethodChange(m)}
              className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
                method === m ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {method === 'rotation' && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            使うテンプレートを選んでください（1個以上）。人物ごとに、選んだ順番（番号）ですべて使ってから次の人物へ進みます。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {TEMPLATES.map((t) => {
              const order = rotation.indexOf(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 px-3 py-2 text-xs border rounded-lg cursor-pointer ${
                    order >= 0 ? 'border-violet-300 bg-violet-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <input type="checkbox" checked={order >= 0} onChange={() => toggleRotation(t.id)} className="shrink-0" />
                  <span className={`w-5 h-5 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    order >= 0 ? 'bg-violet-600 text-white' : 'bg-gray-100 text-transparent'
                  }`}
                  >
                    {order >= 0 ? order + 1 : '-'}
                  </span>
                  <span className="text-slate-700">{t.label}</span>
                  {t.requiresPersonPhoto && <span className="text-[10px] text-amber-600 ml-auto shrink-0">人物写真が必要</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {method === 'manual' && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">手動の指定方法</p>
          <div className="flex flex-wrap gap-1.5 bg-gray-100 rounded-lg p-1 w-fit">
            {([['slot', '時刻ごとに指定'], ['sequence', '順番に並べる']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => onManualStyleChange(v)}
                className={`text-xs font-semibold px-4 py-1.5 rounded-md transition-colors ${
                  manualStyle === v ? 'bg-white text-slate-800 shadow-sm' : 'text-gray-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {method === 'manual' && manualStyle === 'slot' && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            投稿時刻ごとにテンプレートを指定してください（すべての枠で必須）。人物ごとにこの並び（1日分）を使い、次の人物は次の空き枠から続けます（予約済み・過去の枠があると時刻は後ろへずれます）。
          </p>
          <div className="space-y-1.5">
            {dailySlots.map((time) => (
              <div key={time} className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-700 w-12 shrink-0">{time}</span>
                <TemplateSelect label={`${time}のテンプレート`} value={bySlot[time] ?? ''} onChange={(v) => onBySlotChange({ ...bySlot, [time]: v })} />
              </div>
            ))}
          </div>
        </div>
      )}

      {method === 'manual' && manualStyle === 'sequence' && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            使うテンプレートを順番に並べてください。人物ごとにこの並びをすべて使ってから次の人物へ進み、空き枠の順（{dailySlots.join(' → ')} → 翌日…）に割り当てます（同じテンプレートを複数回入れることもできます）。
          </p>
          <div className="space-y-1.5">
            {sequence.map((id, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400 w-5 shrink-0 text-right">{i + 1}.</span>
                <TemplateSelect label={`${i + 1}番目のテンプレート`} value={id} onChange={(v) => onSequenceChange(sequence.map((x, k) => (k === i ? v : x)))} />
                <button type="button" onClick={() => moveSeq(i, -1)} disabled={i === 0} className="text-xs px-1.5 text-gray-400 hover:text-slate-700 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => moveSeq(i, 1)} disabled={i === sequence.length - 1} className="text-xs px-1.5 text-gray-400 hover:text-slate-700 disabled:opacity-30">↓</button>
                <button type="button" onClick={() => onSequenceChange(sequence.filter((_, k) => k !== i))} className="text-xs px-1.5 text-gray-400 hover:text-red-500">×</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onSequenceChange([...sequence, ''])}
            className="mt-2 text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
          >
            ＋ テンプレートを追加
          </button>
        </div>
      )}
    </div>
  );
}
