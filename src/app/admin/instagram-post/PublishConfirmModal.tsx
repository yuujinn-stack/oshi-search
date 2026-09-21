'use client';

import { useState } from 'react';
import { safeFetchJson } from './safe-fetch-json';

interface PostImage {
  order: 1 | 2 | 3;
  url: string;
  fileName: string;
}

interface Props {
  personName: string;
  images: [PostImage, PostImage, PostImage];
  caption: string;
  onClose: () => void;
  onPublished: (result: { mediaId: string; publishedAt: string }) => void;
}

type Phase = 'confirm' | 'publishing' | 'error';

export default function PublishConfirmModal({ personName, images, caption, onClose, onPublished }: Props) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [errorMsg, setErrorMsg] = useState('');

  async function handlePublish() {
    setPhase('publishing');
    try {
      const data = await safeFetchJson<{ mediaId: string; publishedAt: string }>('/api/admin/instagram-post/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName,
          imageUrls: images.map((img) => img.url),
          caption,
        }),
      });
      onPublished(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">Instagramへの投稿確認</h2>
            <p className="text-sm text-violet-600 font-medium mt-0.5">{personName}</p>
          </div>
          {phase !== 'publishing' && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
              ✕
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'confirm' && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-800">
                この内容をInstagramに公開します。よろしいですか？
              </p>
              <div className="flex gap-2">
                {images.map((img) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.order}
                    src={img.url}
                    alt={`投稿画像${img.order}枚目`}
                    className="w-1/3 rounded-lg border border-gray-200 object-cover aspect-[4/5]"
                  />
                ))}
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto">
                {caption}
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                ⚠️ 「投稿する」を押すと、Instagramに実際に公開されます。取り消せません。
              </div>
            </div>
          )}

          {phase === 'publishing' && (
            <div className="text-center py-12 space-y-4">
              <div className="text-5xl animate-pulse">📤</div>
              <p className="text-slate-700 font-semibold">Instagramへ投稿中...</p>
              <p className="text-xs text-gray-500">
                コンテナ作成〜公開まで数十秒かかる場合があります。このタブを閉じないでください。
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              <p className="font-semibold mb-1">投稿に失敗しました</p>
              <p className="text-xs">{errorMsg}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={phase === 'publishing'}
            className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          {(phase === 'confirm' || phase === 'error') && (
            <button
              onClick={handlePublish}
              className="text-sm px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold transition-colors"
            >
              投稿する
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
