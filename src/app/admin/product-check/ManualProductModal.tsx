'use client';

import { useState } from 'react';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';

const CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: '写真集', label: '写真集' },
  { value: '本・雑誌', label: '本・雑誌' },
  { value: 'CD', label: 'CD' },
  { value: 'Blu-ray・DVD', label: 'Blu-ray・DVD' },
  { value: 'グッズ', label: 'グッズ' },
  { value: '中古', label: '中古' },
];

interface Props {
  personName: string;
  editProduct?: RakutenItem & { catLabel: ProductCategory };
  onClose: () => void;
  onSaved: () => void;
  allPersons?: PersonOption[];
  personGroup?: string;
}

export default function ManualProductModal({
  personName,
  editProduct,
  onClose,
  onSaved,
  allPersons = [],
  personGroup,
}: Props) {
  const isEdit = !!editProduct;

  // ── 商品フィールド ────────────────────────────────────────────────────────
  const [title, setTitle]       = useState(editProduct?.title ?? '');
  const [itemUrl, setItemUrl]   = useState(editProduct?.itemUrl ?? '');
  const [imageUrl, setImageUrl] = useState(editProduct?.imageUrl ?? '');
  const [category, setCategory] = useState<ProductCategory>(editProduct?.catLabel ?? '写真集');
  const [price, setPrice]       = useState(editProduct?.price ? String(editProduct.price) : '');
  const [shopName, setShopName] = useState(editProduct?.shopName ?? '');
  const [isUsed, setIsUsed]     = useState(editProduct?.isUsed ?? false);
  const [description, setDescription] = useState(editProduct?.description ?? '');

  // ── 追加先人物（追加モードのみ）────────────────────────────────────────
  const [selectedNames, setSelectedNames] = useState<string[]>([personName]);
  const [comboKey, setComboKey]           = useState(0);
  const [csvText, setCsvText]             = useState('');
  const [csvOpen, setCsvOpen]             = useState(false);

  // ── 送信状態 ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [result, setResult] = useState<{ created: string[]; duplicates: string[] } | null>(null);

  // ── 追加先人物操作 ────────────────────────────────────────────────────────
  function addName(name: string) {
    if (!name || selectedNames.includes(name)) return;
    setSelectedNames((prev) => [...prev, name]);
    setComboKey((k) => k + 1);
  }
  function removeName(name: string) {
    setSelectedNames((prev) => prev.filter((n) => n !== name));
  }
  function addGroupMembers(activeOnly: boolean) {
    const members = allPersons
      .filter((p) => p.group === personGroup && (!activeOnly || p.activityStatus === 'active'))
      .map((p) => p.name);
    setSelectedNames((prev) => [...new Set([...prev, ...members])]);
  }
  function applyCSV() {
    const names = csvText.split(/[\n,、]/).map((s) => s.trim()).filter(Boolean);
    const valid = names.filter((n) => allPersons.some((p) => p.name === n));
    setSelectedNames((prev) => [...new Set([...prev, ...valid])]);
    setCsvText('');
    setCsvOpen(false);
  }

  // ── 送信 ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim() || !itemUrl.trim()) { setError('商品名とURLは必須です'); return; }
    if (!isEdit && selectedNames.length === 0) { setError('追加先を1人以上選択してください'); return; }
    setSaving(true);
    setError('');
    setResult(null);

    if (isEdit) {
      // 編集モード: 既存の単一人物PUT
      const res = await fetch('/api/admin/product-manual', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName,
          productId: editProduct!.id,
          title: title.trim(),
          itemUrl: itemUrl.trim(),
          imageUrl: imageUrl.trim(),
          category,
          price: price ? Number(price) : 0,
          shopName: shopName.trim() || undefined,
          isUsed,
          description: description.trim() || undefined,
        }),
      });
      if (res.ok) { onSaved(); onClose(); }
      else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? '保存に失敗しました');
      }
    } else {
      // 追加モード: 複数人物POST
      const res = await fetch('/api/admin/product-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personNames: selectedNames,
          title: title.trim(),
          itemUrl: itemUrl.trim(),
          imageUrl: imageUrl.trim(),
          category,
          price: price ? Number(price) : 0,
          shopName: shopName.trim() || undefined,
          isUsed,
          description: description.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json() as { created: string[]; duplicates: string[] };
        setResult(data);
        onSaved();
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? '保存に失敗しました');
      }
    }
    setSaving(false);
  }

  // ── コンボボックスに渡す人物（選択済みを除く） ──────────────────────────
  const availableForCombo = allPersons.filter((p) => !selectedNames.includes(p.name));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-slate-800 text-base">
            {isEdit ? '商品を編集' : '＋ 商品を手動追加'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* 結果表示（追加完了後） */}
        {result && (
          <div className="p-6 space-y-3">
            <p className="text-sm font-bold text-green-700">
              {result.created.length > 0
                ? `✓ ${result.created.length}人に追加しました`
                : '追加できた人物がいませんでした'}
            </p>
            {result.created.length > 0 && (
              <ul className="text-xs text-green-600 space-y-0.5 pl-3">
                {result.created.map((n) => <li key={n}>・{n}</li>)}
              </ul>
            )}
            {result.duplicates.length > 0 && (
              <>
                <p className="text-xs text-amber-600 font-medium">スキップ（重複）</p>
                <ul className="text-xs text-amber-500 space-y-0.5 pl-3">
                  {result.duplicates.map((n) => <li key={n}>・{n}</li>)}
                </ul>
              </>
            )}
            <button
              onClick={onClose}
              className="mt-2 text-sm px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium transition-colors"
            >
              閉じる
            </button>
          </div>
        )}

        {/* フォーム（結果表示時は非表示） */}
        {!result && (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">

            {/* 追加先人物（追加モードのみ） */}
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  追加先人物 <span className="text-red-500">*</span>
                </label>

                {/* 選択済みチップ */}
                {selectedNames.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedNames.map((name) => (
                      <span
                        key={name}
                        className="flex items-center gap-1 text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-1"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => removeName(name)}
                          className="text-gray-400 hover:text-red-500 transition-colors ml-0.5 leading-none"
                          title="削除"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* PersonCombobox */}
                {allPersons.length > 0 && (
                  <PersonCombobox
                    key={comboKey}
                    persons={availableForCombo}
                    value=""
                    onChange={addName}
                    placeholder="人物を検索して追加..."
                    allowEmpty
                    emptyLabel="人物を検索して追加..."
                  />
                )}

                {/* グループ一括追加 */}
                {personGroup && allPersons.some((p) => p.group === personGroup) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addGroupMembers(true)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors"
                    >
                      {personGroup} 現役メンバーを追加
                    </button>
                    <button
                      type="button"
                      onClick={() => addGroupMembers(false)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                    >
                      {personGroup} 全メンバーを追加
                    </button>
                  </div>
                )}

                {/* CSV貼り付け */}
                <button
                  type="button"
                  onClick={() => setCsvOpen((v) => !v)}
                  className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 underline"
                >
                  {csvOpen ? '▲ 閉じる' : '▼ 名前を改行区切りで貼り付け'}
                </button>
                {csvOpen && (
                  <div className="mt-1.5 space-y-1.5">
                    <textarea
                      value={csvText}
                      onChange={(e) => setCsvText(e.target.value)}
                      placeholder={'賀喜遥香\n冨里奈央\n奥田いろは'}
                      rows={4}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={applyCSV}
                      className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors"
                    >
                      追加する
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 商品名 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                商品名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 乃木坂46 生田絵梨花 写真集"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                required
              />
            </div>

            {/* 商品URL */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                商品URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={itemUrl}
                onChange={(e) => setItemUrl(e.target.value)}
                placeholder="https://item.rakuten.co.jp/..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                required
              />
            </div>

            {/* 商品画像URL + プレビュー */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">商品画像URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                {imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt=""
                    className="w-10 h-12 object-cover rounded border border-gray-200 flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
              </div>
            </div>

            {/* カテゴリ */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                カテゴリ <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(({ value, label }) => (
                  <label
                    key={value}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                      category === value
                        ? 'bg-slate-700 text-white border-slate-700'
                        : 'border-gray-200 text-gray-500 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={value}
                      checked={category === value}
                      onChange={() => setCategory(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* 価格・ショップ */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">価格（円）</label>
                <input
                  type="number"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                  min={0}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">ショップ名</label>
                <input
                  type="text"
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="楽天ブックス"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>

            {/* 中古チェック */}
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600">
              <input
                type="checkbox"
                checked={isUsed}
                onChange={(e) => setIsUsed(e.target.checked)}
                className="w-4 h-4 accent-slate-600"
              />
              中古商品として登録
            </label>

            {/* 説明 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明・メモ</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="任意のメモや商品説明"
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-sm px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium transition-colors disabled:opacity-50"
              >
                {saving
                  ? '保存中...'
                  : isEdit
                  ? '変更を保存'
                  : selectedNames.length > 1
                  ? `${selectedNames.length}人に追加する`
                  : '追加する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
