'use client';

import { useState, useEffect, useCallback } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import PublishConfirmModal from './PublishConfirmModal';
import { safeFetchJson } from './safe-fetch-json';
import { INSTAGRAM_TEMPLATES, DEFAULT_INSTAGRAM_TEMPLATE_ID, getInstagramTemplateMeta } from '@/lib/instagram-templates';

interface PostImage {
  order: 1 | 2 | 3;
  url: string;
  fileName: string;
}

interface PostWork {
  title: string;
  vod: string;
}

interface BuildPostResult {
  personName: string;
  personPhotoUrl: string;
  images: [PostImage, PostImage, PostImage];
  works: PostWork[];
  caption: string;
  hashtags: string;
}

interface DuplicateInfo {
  alreadyPosted: boolean;
  records: { mediaId: string; publishedAt: string }[];
}

interface PublishResult {
  mediaId: string;
  publishedAt: string;
}

interface Props {
  persons: PersonOption[];
}

export default function InstagramPostClient({ persons }: Props) {
  const [personName, setPersonName] = useState('');
  const [templateId, setTemplateId] = useState(DEFAULT_INSTAGRAM_TEMPLATE_ID);
  const selectedTemplate = getInstagramTemplateMeta(templateId);

  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoChecking, setPhotoChecking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [post, setPost] = useState<BuildPostResult | null>(null);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // 人物・テンプレートを選び直したら、それまでのプレビュー・投稿結果はリセットする
  useEffect(() => {
    setPost(null);
    setGenerateError(null);
    setPublishResult(null);
    setPhotoUrl(null);
    setPhotoError(null);
    setDuplicateInfo(null);

    if (!personName) return;

    // 重複投稿チェックはテンプレートによらず常に行う
    safeFetchJson<DuplicateInfo>(`/api/admin/instagram-post/duplicate-check?personName=${encodeURIComponent(personName)}`)
      .then(setDuplicateInfo)
      .catch(() => {});

    // 人物写真の確認は「人物写真が必須のテンプレート」のときだけ行う
    if (!selectedTemplate?.requiresPersonPhoto) return;

    setPhotoChecking(true);
    safeFetchJson<{ photoUrl: string | null }>(`/api/admin/instagram-post/photo?personName=${encodeURIComponent(personName)}`)
      .then((data) => setPhotoUrl(data.photoUrl ?? null))
      .catch((err) => setPhotoError(String(err instanceof Error ? err.message : err)))
      .finally(() => setPhotoChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personName, templateId]);

  const handlePhotoFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !personName) return;

      setUploadingPhoto(true);
      setPhotoError(null);
      try {
        const formData = new FormData();
        formData.append('personName', personName);
        formData.append('file', file);
        const data = await safeFetchJson<{ photoUrl: string }>('/api/admin/instagram-post/photo', {
          method: 'POST',
          body: formData,
        });
        setPhotoUrl(data.photoUrl);
      } catch (err) {
        setPhotoError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploadingPhoto(false);
      }
    },
    [personName],
  );

  async function handleGenerate() {
    if (!personName) return;
    setGenerating(true);
    setGenerateError(null);
    setPost(null);
    setPublishResult(null);
    try {
      const data = await safeFetchJson<BuildPostResult>('/api/admin/instagram-post/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName, templateId }),
      });
      setPost(data);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  const canGenerate = !!personName && !generating && (!selectedTemplate?.requiresPersonPhoto || (!!photoUrl && !photoChecking && !uploadingPhoto));
  const previewAspectClass = templateId === 'works-only' ? 'aspect-square' : 'aspect-[4/5]';

  return (
    <div className="space-y-6">
      {/* 人物・テンプレート選択 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">1. 人物・テンプレートを選択</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">人物</label>
            <PersonCombobox
              persons={persons}
              value={personName}
              onChange={setPersonName}
              placeholder="人物名で検索..."
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">投稿テンプレート</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
            >
              {INSTAGRAM_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {duplicateInfo?.alreadyPosted && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            ⚠️ この人物は以前Instagramへ投稿されています
            （最終投稿: {new Date(duplicateInfo.records[0].publishedAt).toLocaleString('ja-JP')}）。
            再投稿する場合はこのまま進めてください。
          </div>
        )}

        {personName && selectedTemplate?.requiresPersonPhoto && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-2">人物写真</p>
            {photoChecking ? (
              <p className="text-xs text-gray-400">確認中...</p>
            ) : photoUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="人物写真" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
                <label className="text-xs text-indigo-600 hover:underline cursor-pointer">
                  {uploadingPhoto ? 'アップロード中...' : '写真を差し替える'}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} disabled={uploadingPhoto} />
                </label>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-2">
                <p>この人物の写真がまだありません。投稿画像を生成するには写真のアップロードが必要です。</p>
                <label className="inline-block text-sm px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium transition-colors cursor-pointer">
                  {uploadingPhoto ? 'アップロード中...' : '人物写真をアップロード'}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} disabled={uploadingPhoto} />
                </label>
              </div>
            )}
            {photoError && <p className="text-xs text-red-600 mt-2">{photoError}</p>}
          </div>
        )}

        {personName && selectedTemplate && !selectedTemplate.requiresPersonPhoto && (
          <p className="mt-4 pt-4 border-t border-gray-100 text-xs text-emerald-600">
            このテンプレートは人物写真を使用しません。人物写真の登録なしで生成できます。
          </p>
        )}
      </section>

      {/* 投稿を作成 */}
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-bold text-slate-700 mb-3">2. 投稿を作成</h2>
        <p className="text-xs text-gray-500 mb-3">
          作品・配信先の取得、投稿画像3枚の生成、JPEG変換、Vercel Blobへのアップロード、キャプション生成までを行います。
          <strong>この段階ではInstagramへの投稿は行いません。</strong>
        </p>
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="text-sm px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {generating ? '生成中...（数十秒かかります）' : post ? '🔄 画像を再生成' : '投稿を作成'}
        </button>
        {generateError && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            <p className="font-semibold mb-1">生成に失敗しました</p>
            <p className="text-xs">{generateError}</p>
          </div>
        )}
      </section>

      {/* プレビュー */}
      {post && !publishResult && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
          <h2 className="text-sm font-bold text-slate-700">3. プレビュー確認</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {post.images.map((img) => (
              <div key={img.order} className="space-y-1">
                <p className="text-xs font-semibold text-gray-500">{img.order}枚目</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={`投稿画像${img.order}枚目`}
                  className={`w-full rounded-lg border border-gray-200 object-cover ${previewAspectClass}`}
                />
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">使用している作品・配信サービス</p>
            <ul className="text-sm text-slate-700 space-y-1">
              {post.works.map((w) => (
                <li key={w.title}>
                  ・{w.title}（<span className="text-gray-500">{w.vod}</span>）
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">キャプション</p>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-slate-700 whitespace-pre-wrap">
              {post.caption}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">ハッシュタグ</p>
            <p className="text-sm text-indigo-600">{post.hashtags}</p>
          </div>

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowConfirmModal(true)}
              className="text-sm px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors"
            >
              Instagramに投稿
            </button>
          </div>
        </section>
      )}

      {/* 投稿完了 */}
      {publishResult && post && (
        <section className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="text-center py-6 space-y-4">
            <div className="text-5xl">✅</div>
            <p className="text-xl font-bold text-slate-800">投稿が完了しました</p>
            <div className="text-sm text-gray-600 space-y-1">
              <p>人物名: <span className="font-semibold text-slate-800">{post.personName}</span></p>
              <p>media_id: <span className="font-mono text-xs">{publishResult.mediaId}</span></p>
              <p>投稿日時: {new Date(publishResult.publishedAt).toLocaleString('ja-JP')}</p>
            </div>
            <div className="flex justify-center gap-2 pt-2">
              {post.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.order} src={img.url} alt={`投稿画像${img.order}枚目`} className="w-20 h-20 rounded-lg object-cover border border-gray-200" />
              ))}
            </div>
          </div>
        </section>
      )}

      {showConfirmModal && post && (
        <PublishConfirmModal
          personName={post.personName}
          images={post.images}
          caption={post.caption}
          onClose={() => setShowConfirmModal(false)}
          onPublished={(result) => {
            setPublishResult(result);
            setShowConfirmModal(false);
          }}
        />
      )}
    </div>
  );
}
