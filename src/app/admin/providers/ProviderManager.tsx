'use client';

import { useState } from 'react';
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { ProviderRecord } from '@/lib/provider-store';

// ─── ロゴプレビュー ────────────────────────────────────────────────────────────
function LogoPreview({ url }: { url: string }) {
  const [ok, setOk] = useState(true);
  if (!url || !ok) {
    return (
      <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-300 text-xs flex-shrink-0">
        ?
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="logo preview"
      onError={() => setOk(false)}
      className="w-10 h-10 rounded-lg border border-gray-200 object-contain bg-white p-0.5 flex-shrink-0"
    />
  );
}

// ─── 追加フォーム ──────────────────────────────────────────────────────────────
interface AddFormProps {
  onAdded: (record: ProviderRecord) => void;
}

function AddForm({ onAdded }: AddFormProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function autoSlug() {
    setSlug(normalizeProviderName(name));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || !logoUrl.trim()) {
      setError('名前・slug・logoUrl を入力してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim(), logoUrl: logoUrl.trim(), isActive }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '登録に失敗しました');
        return;
      }
      const record = await res.json() as ProviderRecord;
      onAdded(record);
      setName(''); setSlug(''); setLogoUrl(''); setIsActive(true);
      setOpen(false);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
      >
        + 新規登録
      </button>
    );
  }

  return (
    <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
      <h2 className="font-bold text-indigo-900 text-sm mb-3">新規サービス登録</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">サービス名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: Hulu"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              slug
              <span className="ml-1 text-gray-400 font-normal">（ProviderLogo の検索キー）</span>
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="例: hulu"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                type="button"
                onClick={autoSlug}
                title="名前から自動生成"
                className="px-2 py-2 text-xs text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50"
              >
                自動
              </button>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            logoUrl
            <span className="ml-1 text-gray-400 font-normal">（絶対URL または /providers/hulu.png）</span>
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://... または /providers/hulu.png"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <LogoPreview url={logoUrl} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded"
            />
            有効（ページに反映）
          </label>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(''); }}
              className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '登録中…' : '登録する'}
            </button>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}

// ─── 行編集フォーム ────────────────────────────────────────────────────────────
interface EditRowProps {
  record: ProviderRecord;
  onSaved: (updated: ProviderRecord) => void;
  onCancel: () => void;
}

function EditRow({ record, onSaved, onCancel }: EditRowProps) {
  const [name, setName] = useState(record.name);
  const [logoUrl, setLogoUrl] = useState(record.logoUrl);
  const [isActive, setIsActive] = useState(record.isActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/providers/${encodeURIComponent(record.slug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), logoUrl: logoUrl.trim(), isActive }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '保存に失敗しました');
        return;
      }
      const updated = await res.json() as ProviderRecord;
      onSaved(updated);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-indigo-50">
      <td className="px-4 py-3">
        <LogoPreview url={logoUrl} />
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </td>
      <td className="px-4 py-3 text-xs font-mono text-gray-500">
        {record.slug}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 min-w-0"
          />
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-gray-600">有効</span>
        </label>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            取消
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
interface Props {
  initialProviders: ProviderRecord[];
}

export default function ProviderManager({ initialProviders }: Props) {
  const [providers, setProviders] = useState<ProviderRecord[]>(initialProviders);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);

  function handleAdded(record: ProviderRecord) {
    setProviders((prev) => {
      const filtered = prev.filter((p) => p.slug !== record.slug);
      return [...filtered, record].sort((a, b) => a.slug.localeCompare(b.slug));
    });
  }

  function handleSaved(updated: ProviderRecord) {
    setProviders((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
    setEditingSlug(null);
  }

  async function handleDelete(slug: string) {
    if (deletingSlug !== slug) {
      setDeletingSlug(slug);
      return;
    }
    try {
      await fetch(`/api/admin/providers/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      setProviders((prev) => prev.filter((p) => p.slug !== slug));
    } catch {
      // ignore
    } finally {
      setDeletingSlug(null);
    }
  }

  return (
    <>
      <AddForm onAdded={handleAdded} />

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-700 text-sm">
            登録済みサービス
            <span className="ml-2 text-gray-400 font-normal text-xs">{providers.length}件</span>
          </h2>
          {providers.length > 0 && (
            <p className="text-xs text-gray-400">
              slug はコードの <code className="bg-gray-100 px-1 rounded">PROVIDER_SLUG</code> キーまたは正規化名と一致させてください
            </p>
          )}
        </div>

        {providers.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            まだ登録されていません。「+ 新規登録」から追加してください。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-4 py-2 font-medium">ロゴ</th>
                  <th className="px-4 py-2 font-medium">サービス名</th>
                  <th className="px-4 py-2 font-medium">slug</th>
                  <th className="px-4 py-2 font-medium">logoUrl</th>
                  <th className="px-4 py-2 font-medium">状態</th>
                  <th className="px-4 py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {providers.map((p) =>
                  editingSlug === p.slug ? (
                    <EditRow
                      key={p.slug}
                      record={p}
                      onSaved={handleSaved}
                      onCancel={() => setEditingSlug(null)}
                    />
                  ) : (
                    <tr key={p.slug} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <LogoPreview url={p.logoUrl} />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{p.name}</td>
                      <td className="px-4 py-3">
                        <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                          {p.slug}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                        <span className="truncate block" title={p.logoUrl}>
                          {p.logoUrl}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            p.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {p.isActive ? '有効' : '無効'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingSlug(p.slug)}
                            className="px-2 py-1 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(p.slug)}
                            className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                              deletingSlug === p.slug
                                ? 'bg-red-600 text-white border-red-600'
                                : 'text-red-400 border-red-200 hover:bg-red-50'
                            }`}
                          >
                            {deletingSlug === p.slug ? '確認: 削除' : '削除'}
                          </button>
                          {deletingSlug === p.slug && (
                            <button
                              onClick={() => setDeletingSlug(null)}
                              className="px-2 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                              取消
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 space-y-1">
        <p className="font-semibold">slug の設定ガイド</p>
        <p>slug は <code className="bg-amber-100 px-1 rounded">ProviderLogo</code> がロゴを探すときのキーです。以下のどちらかを使用してください：</p>
        <ul className="list-disc list-inside space-y-0.5 ml-2">
          <li>
            <strong>コード内の PROVIDER_SLUG 値</strong>（例: hulu / prime-video / unext）
          </li>
          <li>
            <strong>正規化キー</strong>（サービス名を小文字・記号除去した形。例: netflix / disneyplus / abema）
          </li>
        </ul>
        <p className="mt-1">変更は次回ページロード時から全ページに自動反映されます。</p>
      </div>
    </>
  );
}
