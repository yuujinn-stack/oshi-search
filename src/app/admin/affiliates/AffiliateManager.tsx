'use client';

import { useState } from 'react';
import type {
  AffiliateProgramWithCreatives,
  AffiliateCreative,
  AffiliatePlacement,
  AffiliateProgramStatus,
  AffiliateCreativeType,
  AffiliateDevice,
} from '@/lib/affiliate-store';
import { KNOWN_SLOT_KEYS } from '@/lib/affiliate-constants';

const SLOT_LABELS: Record<string, string> = {
  work_provider: '作品詳細の配信サービス欄',
  vod_hero: 'VODサービスページ 上部',
  vod_mid: 'VODサービスページ 中部',
  vod_bottom: 'VODサービスページ 下部',
  person_vod: '人物ページ VOD欄',
};

const STATUS_LABELS: Record<AffiliateProgramStatus, string> = {
  active: '稼働中', paused: '一時停止', pending: '準備中', ended: '終了',
};

const TYPE_LABELS: Record<AffiliateCreativeType, string> = {
  raw_html: 'HTML広告コード', direct_url: 'URLのみ', banner: '画像バナー', text: 'テキストリンク', embed: '埋め込み(iframe等)',
};

const DEVICE_LABELS: Record<AffiliateDevice, string> = { all: '全端末', desktop: 'PCのみ', mobile: 'スマホのみ' };

type Creative = AffiliateCreative & { placements: AffiliatePlacement[] };
type Program = AffiliateProgramWithCreatives;

function toDateTimeLocal(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(s: string): number | null {
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

// ─── 広告プレビュー（誤クリック防止: pointer-events無効 + 透明オーバーレイ） ────
function CreativePreview({ creative }: { creative: Creative }) {
  let body: React.ReactNode = null;
  if (creative.type === 'raw_html' || creative.type === 'embed') {
    body = creative.rawCode
      // eslint-disable-next-line react/no-danger -- 管理画面プレビュー。クリックは下記オーバーレイで無効化
      ? <div dangerouslySetInnerHTML={{ __html: creative.rawCode }} />
      : <p className="text-xs text-gray-400">HTMLコード未入力</p>;
  } else if (creative.type === 'banner') {
    body = creative.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={creative.imageUrl} alt={creative.altText ?? ''} width={creative.width ?? undefined} height={creative.height ?? undefined} className="max-w-full h-auto rounded-lg" />
    ) : <p className="text-xs text-gray-400">画像URL未入力</p>;
  } else {
    body = creative.destinationUrl ? (
      <span className="text-sm font-semibold text-indigo-600">{creative.altText || creative.name}</span>
    ) : <p className="text-xs text-gray-400">URL未入力</p>;
  }

  return (
    <div className="relative border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 overflow-x-auto">
      <div style={{ pointerEvents: 'none' }}>{body}</div>
      {/* 透明オーバーレイでクリック・タップを完全に無効化する（表示確認専用） */}
      <div className="absolute inset-0" aria-hidden="true" />
      <p className="text-[10px] text-gray-400 mt-2">※ プレビューです。リンク・広告コードはクリックできません。</p>
    </div>
  );
}

// ─── 掲載位置チェックボックス群 ────────────────────────────────────────────────
function PlacementEditor({ creative, onChange }: { creative: Creative; onChange: (placements: AffiliatePlacement[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const slotKeys = Array.from(new Set([...KNOWN_SLOT_KEYS, ...creative.placements.map((p) => p.slotKey)]));

  async function toggleSlot(slotKey: string) {
    const existing = creative.placements.find((p) => p.slotKey === slotKey);
    setBusy(slotKey);
    try {
      if (existing) {
        await fetch(`/api/admin/affiliates/placements/${existing.id}`, { method: 'DELETE' });
        onChange(creative.placements.filter((p) => p.id !== existing.id));
      } else {
        const res = await fetch(`/api/admin/affiliates/creatives/${creative.id}/placements`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slotKey }),
        });
        if (res.ok) {
          const record = (await res.json()) as AffiliatePlacement;
          onChange([...creative.placements, record]);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  async function togglePlacementActive(placement: AffiliatePlacement) {
    setBusy(placement.slotKey);
    try {
      const res = await fetch(`/api/admin/affiliates/placements/${placement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !placement.isActive }),
      });
      if (res.ok) {
        const updated = (await res.json()) as AffiliatePlacement;
        onChange(creative.placements.map((p) => (p.id === updated.id ? updated : p)));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-gray-600">掲載位置</p>
      {slotKeys.map((slotKey) => {
        const placement = creative.placements.find((p) => p.slotKey === slotKey);
        return (
          <div key={slotKey} className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!placement}
                disabled={busy === slotKey}
                onChange={() => toggleSlot(slotKey)}
                className="rounded"
              />
              {SLOT_LABELS[slotKey] ?? slotKey}
            </label>
            {placement && (
              <button
                type="button"
                onClick={() => togglePlacementActive(placement)}
                disabled={busy === slotKey}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  placement.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {placement.isActive ? '掲載中' : '一時停止中'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 広告素材フォーム（追加・編集共用） ────────────────────────────────────────
interface CreativeFormState {
  name: string;
  type: AffiliateCreativeType;
  rawCode: string;
  destinationUrl: string;
  imageUrl: string;
  altText: string;
  width: string;
  height: string;
  device: AffiliateDevice;
  priority: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
}

function emptyCreativeForm(): CreativeFormState {
  return { name: '', type: 'raw_html', rawCode: '', destinationUrl: '', imageUrl: '', altText: '', width: '', height: '', device: 'all', priority: '0', isActive: true, startsAt: '', endsAt: '' };
}

function creativeToForm(c: Creative): CreativeFormState {
  return {
    name: c.name, type: c.type, rawCode: c.rawCode ?? '', destinationUrl: c.destinationUrl ?? '',
    imageUrl: c.imageUrl ?? '', altText: c.altText ?? '', width: c.width != null ? String(c.width) : '',
    height: c.height != null ? String(c.height) : '', device: c.device, priority: String(c.priority),
    isActive: c.isActive, startsAt: toDateTimeLocal(c.startsAt), endsAt: toDateTimeLocal(c.endsAt),
  };
}

function CreativeFormFields({ form, setForm }: { form: CreativeFormState; setForm: (f: CreativeFormState) => void }) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">素材名</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例: Hulu公式バナー(2026-08)" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">種類</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AffiliateCreativeType })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      {(form.type === 'raw_html' || form.type === 'embed') && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ASP提供のHTML広告コード（そのまま貼り付けてください。内容は改変されません）</label>
          <textarea value={form.rawCode} onChange={(e) => setForm({ ...form, rawCode: e.target.value })} rows={5} placeholder="<a href=...>...</a> をそのまま貼り付け" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-mono text-xs" />
        </div>
      )}

      {(form.type === 'direct_url' || form.type === 'text' || form.type === 'banner') && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">リンク先URL（ASPのアフィリエイトリンク）</label>
          <input value={form.destinationUrl} onChange={(e) => setForm({ ...form, destinationUrl: e.target.value })} placeholder="https://..." className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
      )}

      {form.type === 'banner' && (
        <div className="grid grid-cols-2 gap-2.5">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">画像URL</label>
            <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://..." className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">幅(px)</label>
            <input type="number" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">高さ(px)</label>
            <input type="number" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
          </div>
        </div>
      )}

      {(form.type === 'banner' || form.type === 'text' || form.type === 'direct_url') && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">alt / リンク文言</label>
          <input value={form.altText} onChange={(e) => setForm({ ...form, altText: e.target.value })} placeholder="例: Huluで見る" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">対象端末</label>
          <select value={form.device} onChange={(e) => setForm({ ...form, device: e.target.value as AffiliateDevice })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            {Object.entries(DEVICE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">優先度（大きいほど優先）</label>
          <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
            有効
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">開始日時（未指定なら制限なし）</label>
          <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">終了日時（未指定なら制限なし）</label>
          <input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
      </div>

      <CreativePreview creative={{
        id: -1, programId: -1, name: form.name || '(プレビュー)', type: form.type,
        rawCode: form.rawCode || null, destinationUrl: form.destinationUrl || null, imageUrl: form.imageUrl || null,
        altText: form.altText || null, width: form.width ? Number(form.width) : null, height: form.height ? Number(form.height) : null,
        device: form.device, priority: Number(form.priority) || 0, isActive: form.isActive,
        startsAt: fromDateTimeLocal(form.startsAt), endsAt: fromDateTimeLocal(form.endsAt),
        createdAt: 0, updatedAt: 0, placements: [],
      }} />
    </div>
  );
}

// ─── 広告素材カード（既存素材の編集・削除・掲載位置） ─────────────────────────
function CreativeCard({ creative, onUpdated, onDeleted }: {
  creative: Creative;
  onUpdated: (c: Creative) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CreativeFormState>(() => creativeToForm(creative));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/affiliates/creatives/${creative.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), type: form.type,
          rawCode: form.rawCode || null, destinationUrl: form.destinationUrl.trim() || null,
          imageUrl: form.imageUrl.trim() || null, altText: form.altText.trim() || null,
          width: form.width ? Number(form.width) : null, height: form.height ? Number(form.height) : null,
          device: form.device, priority: Number(form.priority) || 0, isActive: form.isActive,
          startsAt: fromDateTimeLocal(form.startsAt), endsAt: fromDateTimeLocal(form.endsAt),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '保存に失敗しました');
        return;
      }
      const updated = (await res.json()) as AffiliateCreative;
      onUpdated({ ...updated, placements: creative.placements });
      setEditing(false);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    await fetch(`/api/admin/affiliates/creatives/${creative.id}`, { method: 'DELETE' });
    onDeleted();
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-700 truncate">{creative.name}</p>
          <p className="text-[11px] text-gray-400">
            {TYPE_LABELS[creative.type]} ・ {DEVICE_LABELS[creative.device]} ・ 優先度{creative.priority}
            {' ・ '}
            <span className={creative.isActive ? 'text-green-600' : 'text-gray-400'}>{creative.isActive ? '有効' : '無効'}</span>
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button onClick={() => setEditing((v) => !v)} className="px-2 py-1 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">
            {editing ? '閉じる' : '編集'}
          </button>
          <button
            onClick={handleDelete}
            className={`px-2 py-1 text-xs rounded-lg border ${confirmingDelete ? 'bg-red-600 text-white border-red-600' : 'text-red-400 border-red-200 hover:bg-red-50'}`}
          >
            {confirmingDelete ? '確認: 削除' : '削除'}
          </button>
          {confirmingDelete && (
            <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg">取消</button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2.5 pt-1 border-t border-gray-100">
          <CreativeFormFields form={form} setForm={setForm} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      ) : (
        <PlacementEditor creative={creative} onChange={(placements) => onUpdated({ ...creative, placements })} />
      )}
    </div>
  );
}

// ─── 案件（プログラム）カード ──────────────────────────────────────────────────
interface ProgramFormState {
  vodService: string; aspName: string; programName: string; status: AffiliateProgramStatus;
  rulesNote: string; directUrlAllowed: boolean; customCreativeAllowed: boolean; isActive: boolean;
}

function programToForm(p: Program): ProgramFormState {
  return {
    vodService: p.vodService, aspName: p.aspName, programName: p.programName, status: p.status,
    rulesNote: p.rulesNote ?? '', directUrlAllowed: p.directUrlAllowed, customCreativeAllowed: p.customCreativeAllowed, isActive: p.isActive,
  };
}

function ProgramFormFields({ form, setForm }: { form: ProgramFormState; setForm: (f: ProgramFormState) => void }) {
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            VODサービス識別子
            <span className="ml-1 text-gray-400 font-normal">（例: hulu, lemino, unext, disneyplus, dmmtv, fod, telasa, abema）</span>
          </label>
          <input value={form.vodService} onChange={(e) => setForm({ ...form, vodService: e.target.value })} placeholder="hulu" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ASP名</label>
          <input value={form.aspName} onChange={(e) => setForm({ ...form, aspName: e.target.value })} placeholder="例: バリューコマース" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">案件名</label>
        <input value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} placeholder="例: Hulu 無料トライアル訴求" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">ステータス</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AffiliateProgramStatus })} className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm">
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-5">
          <input type="checkbox" checked={form.directUrlAllowed} onChange={(e) => setForm({ ...form, directUrlAllowed: e.target.checked })} className="rounded" />
          URL単体利用可
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mt-5">
          <input type="checkbox" checked={form.customCreativeAllowed} onChange={(e) => setForm({ ...form, customCreativeAllowed: e.target.checked })} className="rounded" />
          独自クリエイティブ可
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">規約メモ（管理者用・公開されません）</label>
        <textarea value={form.rulesNote} onChange={(e) => setForm({ ...form, rulesNote: e.target.value })} rows={2} placeholder="例: 広告コード改変禁止／画像素材のみ使用可" className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="rounded" />
        有効（この案件に紐づく広告素材を公開ページに表示する）
      </label>
    </div>
  );
}

function ProgramCard({ program, onUpdated, onDeleted }: {
  program: Program;
  onUpdated: (p: Program) => void;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingProgram, setEditingProgram] = useState(false);
  const [form, setForm] = useState<ProgramFormState>(() => programToForm(program));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingCreative, setAddingCreative] = useState(false);
  const [newCreativeForm, setNewCreativeForm] = useState<CreativeFormState>(emptyCreativeForm());
  const [creativeError, setCreativeError] = useState('');
  const [creativeSaving, setCreativeSaving] = useState(false);

  async function handleSaveProgram() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/affiliates/${program.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodService: form.vodService.trim(), aspName: form.aspName.trim(), programName: form.programName.trim(),
          status: form.status, rulesNote: form.rulesNote.trim() || null,
          directUrlAllowed: form.directUrlAllowed, customCreativeAllowed: form.customCreativeAllowed, isActive: form.isActive,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '保存に失敗しました');
        return;
      }
      const updated = await res.json();
      onUpdated({ ...program, ...updated });
      setEditingProgram(false);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteProgram() {
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    await fetch(`/api/admin/affiliates/${program.id}`, { method: 'DELETE' });
    onDeleted();
  }

  async function handleAddCreative() {
    if (!newCreativeForm.name.trim()) {
      setCreativeError('素材名を入力してください');
      return;
    }
    setCreativeSaving(true);
    setCreativeError('');
    try {
      const res = await fetch(`/api/admin/affiliates/${program.id}/creatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCreativeForm.name.trim(), type: newCreativeForm.type,
          rawCode: newCreativeForm.rawCode || null, destinationUrl: newCreativeForm.destinationUrl.trim() || null,
          imageUrl: newCreativeForm.imageUrl.trim() || null, altText: newCreativeForm.altText.trim() || null,
          width: newCreativeForm.width ? Number(newCreativeForm.width) : null,
          height: newCreativeForm.height ? Number(newCreativeForm.height) : null,
          device: newCreativeForm.device, priority: Number(newCreativeForm.priority) || 0,
          isActive: newCreativeForm.isActive,
          startsAt: fromDateTimeLocal(newCreativeForm.startsAt), endsAt: fromDateTimeLocal(newCreativeForm.endsAt),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setCreativeError(d.error ?? '登録に失敗しました');
        return;
      }
      const created = (await res.json()) as AffiliateCreative;
      onUpdated({ ...program, creatives: [...program.creatives, { ...created, placements: [] }] });
      setNewCreativeForm(emptyCreativeForm());
      setAddingCreative(false);
    } catch {
      setCreativeError('通信エラーが発生しました');
    } finally {
      setCreativeSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-[100px]">
          <p className="text-[10px] text-gray-400">VODサービス</p>
          <p className="text-sm font-mono font-semibold text-slate-700">{program.vodService}</p>
        </div>
        <div className="min-w-[100px]">
          <p className="text-[10px] text-gray-400">ASP名</p>
          <p className="text-sm text-slate-700">{program.aspName}</p>
        </div>
        <div className="min-w-[140px] flex-1">
          <p className="text-[10px] text-gray-400">案件名</p>
          <p className="text-sm text-slate-700 truncate">{program.programName}</p>
        </div>
        <div>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{STATUS_LABELS[program.status]}</span>
        </div>
        <div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${program.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
            {program.isActive ? '有効' : '無効'}
          </span>
        </div>
        <div className="text-xs text-gray-400">素材 {program.creatives.length}件</div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => setExpanded((v) => !v)} className="px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">
            {expanded ? '閉じる' : '管理する'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-4 bg-gray-50">
          {/* 案件編集 */}
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-700">案件設定</h3>
              <div className="flex gap-2">
                <button onClick={() => setEditingProgram((v) => !v)} className="px-2 py-1 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">
                  {editingProgram ? '閉じる' : '編集'}
                </button>
                <button
                  onClick={handleDeleteProgram}
                  className={`px-2 py-1 text-xs rounded-lg border ${confirmingDelete ? 'bg-red-600 text-white border-red-600' : 'text-red-400 border-red-200 hover:bg-red-50'}`}
                >
                  {confirmingDelete ? '確認: 案件を削除' : '案件を削除'}
                </button>
                {confirmingDelete && (
                  <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg">取消</button>
                )}
              </div>
            </div>
            {editingProgram ? (
              <div className="space-y-2.5">
                <ProgramFormFields form={form} setForm={setForm} />
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button onClick={handleSaveProgram} disabled={saving} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? '保存中…' : '保存する'}
                </button>
              </div>
            ) : (
              program.rulesNote && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">📝 {program.rulesNote}</p>
            )}
          </div>

          {/* 広告素材一覧 */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700">広告素材</h3>
              <button onClick={() => setAddingCreative((v) => !v)} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                {addingCreative ? '閉じる' : '+ 素材を追加'}
              </button>
            </div>

            {addingCreative && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 space-y-2.5">
                <CreativeFormFields form={newCreativeForm} setForm={setNewCreativeForm} />
                {creativeError && <p className="text-xs text-red-600">{creativeError}</p>}
                <button onClick={handleAddCreative} disabled={creativeSaving} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {creativeSaving ? '登録中…' : '登録する'}
                </button>
              </div>
            )}

            {program.creatives.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">まだ広告素材が登録されていません。</p>
            ) : (
              <div className="space-y-2.5">
                {program.creatives.map((c) => (
                  <CreativeCard
                    key={c.id}
                    creative={c}
                    onUpdated={(updated) => onUpdated({ ...program, creatives: program.creatives.map((x) => (x.id === updated.id ? updated : x)) })}
                    onDeleted={() => onUpdated({ ...program, creatives: program.creatives.filter((x) => x.id !== c.id) })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 新規案件登録フォーム ──────────────────────────────────────────────────────
function AddProgramForm({ onAdded }: { onAdded: (p: Program) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProgramFormState>({ vodService: '', aspName: '', programName: '', status: 'active', rulesNote: '', directUrlAllowed: true, customCreativeAllowed: true, isActive: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.vodService.trim() || !form.aspName.trim() || !form.programName.trim()) {
      setError('VODサービス・ASP名・案件名は必須です');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/affiliates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vodService: form.vodService.trim(), aspName: form.aspName.trim(), programName: form.programName.trim(),
          status: form.status, rulesNote: form.rulesNote.trim() || null,
          directUrlAllowed: form.directUrlAllowed, customCreativeAllowed: form.customCreativeAllowed, isActive: form.isActive,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '登録に失敗しました');
        return;
      }
      const record = await res.json();
      onAdded({ ...record, creatives: [] });
      setForm({ vodService: '', aspName: '', programName: '', status: 'active', rulesNote: '', directUrlAllowed: true, customCreativeAllowed: true, isActive: true });
      setOpen(false);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
        + 新規案件登録
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
      <h2 className="font-bold text-indigo-900 text-sm">新規アフィリエイト案件登録</h2>
      <ProgramFormFields form={form} setForm={setForm} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => { setOpen(false); setError(''); }} className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50">
          キャンセル
        </button>
        <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50">
          {saving ? '登録中…' : '登録する'}
        </button>
      </div>
    </form>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
export default function AffiliateManager({ initialPrograms }: { initialPrograms: Program[] }) {
  const [programs, setPrograms] = useState<Program[]>(initialPrograms);

  return (
    <>
      <AddProgramForm onAdded={(p) => setPrograms((prev) => [p, ...prev])} />

      {programs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-4 py-12 text-center text-gray-400 text-sm">
          まだアフィリエイト案件が登録されていません。「+ 新規案件登録」から追加してください。
          <br />
          未登録の間は、これまで通り既存のVOD配信リンクが全ページでそのまま表示されます。
        </div>
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <ProgramCard
              key={p.id}
              program={p}
              onUpdated={(updated) => setPrograms((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
              onDeleted={() => setPrograms((prev) => prev.filter((x) => x.id !== p.id))}
            />
          ))}
        </div>
      )}
    </>
  );
}
