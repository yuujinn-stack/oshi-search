'use client';

// 動画「推しでサブスク比較」（人物3人で1本）の人物選択。従来のテンプレートの人物選択（PersonMultiSelect）とは別に、
// このテンプレート（Worker報告の templateInputKind が oshi-vod-compare-persons）を選んだときだけ表示する。
// 人物の検索は既存の PersonCombobox をそのまま使い、内部値は推しサーチDBの人物slug（personVideoSlug）にする。

import { useEffect, useMemo, useState } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import { OSHI_VOD_COMPARE_PERSON_COUNT } from '@/lib/video-template-input';

export type TrioSlots = Array<string | null>;

export const EMPTY_TRIO: TrioSlots = Array.from({ length: OSHI_VOD_COMPARE_PERSON_COUNT }, () => null);

/** 3人そろっていて重複が無ければ slug の配列（選択順）、そうでなければ null */
export function completeTrio(slots: TrioSlots): [string, string, string] | null {
  if (slots.length !== OSHI_VOD_COMPARE_PERSON_COUNT || slots.some((s) => !s)) return null;
  if (new Set(slots).size !== slots.length) return null;
  return slots as [string, string, string];
}

interface Preview {
  headline: string;
  totals: { registered: number; paid: number };
  top: { displayName: string; fractionText: string } | null;
  bestPair: { services: string[]; fractionText: string } | null;
}

export default function VodCompareTrioPicker({
  persons,
  slugByName,
  value,
  onChange,
}: {
  persons: PersonOption[];
  slugByName: Record<string, string>;
  value: TrioSlots;
  onChange: (next: TrioSlots) => void;
}) {
  const nameBySlug = useMemo(() => new Map(Object.entries(slugByName).map(([n, s]) => [s, n])), [slugByName]);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const trio = completeTrio(value);
  const trioKey = trio?.join(',') ?? '';

  // 3人そろったら、生成前の確認として診断結果の件数・1位を取得する（読み取りのみ）
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!trioKey) return;
    let cancelled = false;
    setPreviewLoading(true);
    void fetch('/api/admin/video-jobs/vod-compare-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personSlugs: trioKey.split(',') }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setPreviewError(String(data.error ?? `HTTP ${res.status}`));
        else setPreview(data as Preview);
      })
      .catch((err) => !cancelled && setPreviewError(String(err)))
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [trioKey]);

  function choose(index: number, name: string) {
    const slug = name ? slugByName[name] ?? null : null;
    if (name && !slug) {
      setNotice(`「${name}」の人物slugが見つかりません。`);
      return;
    }
    if (slug && value.some((s, i) => i !== index && s === slug)) {
      setNotice(`「${name}」はすでに選ばれています。同じ人物は選べません。`);
      return;
    }
    setNotice(null);
    onChange(value.map((s, i) => (i === index ? slug : s)));
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        3人の推しで「推しに合うサブスク診断」を行い、その結果で1本の動画を作ります（3人そろうまで生成できません）。
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {value.map((slug, i) => {
          // 他の枠で選ばれている人物は候補から外す（重複選択不可）
          const others = new Set(value.filter((s, j) => j !== i && s).map((s) => nameBySlug.get(s!)));
          return (
            <div key={i}>
              <p className="text-xs font-bold text-slate-600 mb-1">人物{i + 1}</p>
              <PersonCombobox
                persons={persons.filter((p) => !others.has(p.name))}
                value={slug ? nameBySlug.get(slug) ?? '' : ''}
                onChange={(name) => choose(i, name)}
                placeholder="人物名・グループ名で検索"
                allowEmpty
                emptyLabel="未選択"
              />
            </div>
          );
        })}
      </div>
      {notice && <p className="text-xs text-red-600">{notice}</p>}
      <div className="text-sm rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1">
        <p>
          <span className="font-bold text-slate-700">選択中：</span>
          {value.map((s, i) => (
            <span key={i} className={s ? 'text-slate-800' : 'text-gray-400'}>
              {i > 0 && ' ／ '}
              {s ? nameBySlug.get(s) ?? s : `人物${i + 1}未選択`}
            </span>
          ))}
        </p>
        {trio && previewLoading && <p className="text-xs text-gray-500">診断結果を確認中...</p>}
        {preview && (
          <p className="text-xs text-gray-600">
            比較対象作品 {preview.totals.paid}件（登録出演作品 {preview.totals.registered}件）
            {preview.top && <>・作品数1位 {preview.top.displayName}（{preview.top.fractionText}）</>}
            {preview.bestPair && preview.bestPair.services.length > 1 && (
              <>・組み合わせ {preview.bestPair.services.join('＋')}（{preview.bestPair.fractionText}）</>
            )}
          </p>
        )}
        {previewError && <p className="text-xs text-red-600">⚠ {previewError}</p>}
      </div>
    </div>
  );
}
