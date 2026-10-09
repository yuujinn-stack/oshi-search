'use client';

// 診断結果の共有（X・LINE・リンクコピー・端末の共有・画像保存）と結果画像のプレビュー。
// 共有URLは /oshi-vod?p=... の結果ページそのもの（検索エンジン向けには noindex＋canonical）。
import { useEffect, useState } from 'react';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import { sendGaEvent } from '@/lib/ga-event';
import { buildLineShareUrl, buildShareText, buildXShareUrl } from '@/lib/oshi-vod/share';

interface Props {
  personNames: string[];
  topServiceLabel: string | null;
  resultPath: string;
  imageFeedPath: string;
  imageStoryPath: string;
}

const SITE_ORIGIN_FALLBACK = 'https://oshi-search.jp';

export default function OshiVodShare({ personNames, topServiceLabel, resultPath, imageFeedPath, imageStoryPath }: Props) {
  const [origin, setOrigin] = useState(SITE_ORIGIN_FALLBACK);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const url = `${origin}${resultPath}`;
  const text = buildShareText({ personNames, topServiceLabel });
  const track = (method: string) => sendGaEvent('diagnosis_share', { method, person_count: personNames.length });

  const copy = async () => {
    const ok = await copyTextWithFallback(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    track('copy');
  };

  const nativeShare = async () => {
    track('native');
    try {
      // 対応端末では結果画像も添付する（非対応ならテキスト＋URLのみ）
      let files: File[] | undefined;
      try {
        const res = await fetch(imageFeedPath);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], 'oshi-vod-result.png', { type: 'image/png' });
          if (navigator.canShare?.({ files: [file] })) files = [file];
        }
      } catch { /* 画像なしで共有 */ }
      await navigator.share({ title: '推しに合うサブスク診断', text, url, ...(files ? { files } : {}) });
    } catch {
      // ユーザーによるキャンセル等は無視
    }
  };

  return (
    <div className="ov-share">
      {!imageFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageFeedPath}
          alt="診断結果の画像"
          width={1080}
          height={1350}
          className="ov-share-image"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      )}
      <div className="ov-share-buttons">
        {canNativeShare && (
          <button type="button" className="ov-share-btn ov-share-btn--main" onClick={nativeShare}>画像つきでシェア</button>
        )}
        <a className="ov-share-btn ov-share-btn--x" href={buildXShareUrl(text, url)} target="_blank" rel="noopener noreferrer" onClick={() => track('x')}>
          Xでポスト
        </a>
        <a className="ov-share-btn ov-share-btn--line" href={buildLineShareUrl(url)} target="_blank" rel="noopener noreferrer" onClick={() => track('line')}>
          LINEで送る
        </a>
        <button type="button" className="ov-share-btn" onClick={copy}>{copied ? 'コピーしました' : '結果のURLをコピー'}</button>
      </div>
      <div className="ov-share-downloads">
        <a href={imageFeedPath} download="oshi-vod-result.png" className="theme-text-link" onClick={() => track('image_save_feed')}>画像を保存（投稿用 4:5）</a>
        <a href={imageStoryPath} download="oshi-vod-result-story.png" className="theme-text-link" onClick={() => track('image_save_story')}>画像を保存（ストーリーズ用 9:16）</a>
      </div>
    </div>
  );
}
