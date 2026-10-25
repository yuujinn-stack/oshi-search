'use client';

// 診断結果の共有（X・LINE・リンクコピー・端末の共有・画像保存）と結果画像のプレビュー。
// 共有URLは /oshi-vod?p=... の結果ページそのもの（検索エンジン向けには noindex＋canonical）に、
// 共有元のデザイン・方法（sv / sm。share.ts）を付けたもの。
//
// 画像デザインは「かっこいい（cool）／可愛い（cute）」から選べる。違うのは見た目だけで、
// 画像に載せる情報・数値は同じ（server/oshi-vod/result-image.tsx）。
// - 初期デザインは、以前に選んだもの（localStorage）→ なければ無作為に割り当てる
//   （デザインごとの共有率を比べるため、最初に見せるデザインを偏らせない）。
// - 2枚のプレビューは欄が画面に近づいた時点でまとめて読み込み、同じ位置に重ねて visibility だけを切り替える
//   （display:none の画像はブラウザが読み込みを後回しにし、切り替え直後に空白になるため使わない）。
// - 計測（GA4）はすべて variant と variant_chosen（利用者が自分で選んだか）を付ける。
import { useEffect, useRef, useState } from 'react';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import { sendGaEvent } from '@/lib/ga-event';
import { buildOshiVodImagePath } from '@/lib/oshi-vod/params';
import {
  buildLineShareUrl,
  buildShareText,
  buildSharedResultUrl,
  buildXShareUrl,
  type OshiVodShareLinkMethod,
} from '@/lib/oshi-vod/share';
import {
  OSHI_VOD_DEFAULT_SHARE_VARIANT,
  OSHI_VOD_SHARE_VARIANTS,
  OSHI_VOD_SHARE_VARIANT_LABELS,
  isOshiVodShareVariant,
  type OshiVodShareVariant,
} from '@/lib/oshi-vod/share-variant';

interface Props {
  personNames: string[];
  topServiceLabel: string | null;
  resultPath: string;
}

const SITE_ORIGIN_FALLBACK = 'https://oshi-search.jp';
const VARIANT_STORAGE_KEY = 'oshi-vod-share-variant';

const VARIANT_HINTS: Record<OshiVodShareVariant, string> = {
  cool: '雑誌風・ダーク',
  cute: 'シール風・ポップ',
};

function loadInitialVariant(): { variant: OshiVodShareVariant; chosen: boolean } {
  try {
    const saved = localStorage.getItem(VARIANT_STORAGE_KEY);
    if (isOshiVodShareVariant(saved)) return { variant: saved, chosen: true };
  } catch { /* localStorage 不可なら割り当てのみ */ }
  return { variant: Math.random() < 0.5 ? 'cool' : 'cute', chosen: false };
}

export default function OshiVodShare({ personNames, topServiceLabel, resultPath }: Props) {
  const [origin, setOrigin] = useState(SITE_ORIGIN_FALLBACK);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [variant, setVariant] = useState<OshiVodShareVariant>(OSHI_VOD_DEFAULT_SHARE_VARIANT);
  const [chosen, setChosen] = useState(false);
  const [ready, setReady] = useState(false);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState<Partial<Record<OshiVodShareVariant, boolean>>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const viewSent = useRef(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    const init = loadInitialVariant();
    setVariant(init.variant);
    setChosen(init.chosen);
    setReady(true);
  }, []);

  // シェア欄の表示計測（1ページ表示につき1回）とプレビュー画像の先読み
  useEffect(() => {
    if (!ready) return;
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setPreviewLoaded(true);
      return;
    }
    const preload = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setPreviewLoaded(true);
        preload.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    const view = new IntersectionObserver((entries) => {
      if (viewSent.current || !entries.some((e) => e.isIntersecting)) return;
      viewSent.current = true;
      view.disconnect();
      sendGaEvent('diagnosis_share_view', { variant, variant_chosen: chosen, person_count: personNames.length });
    }, { threshold: 0.3 });
    preload.observe(el);
    view.observe(el);
    return () => { preload.disconnect(); view.disconnect(); };
    // 表示計測は最初に見えた時点のデザインで1回だけ送る（切り替えで再送しない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const imageFeedPath = buildOshiVodImagePath(personNames, 'feed', variant);
  const imageStoryPath = buildOshiVodImagePath(personNames, 'story', variant);
  const resultUrl = `${origin}${resultPath}`;
  const sharedUrl = (method: OshiVodShareLinkMethod) => buildSharedResultUrl(resultUrl, { variant, method });
  const text = buildShareText({ personNames, topServiceLabel });
  const track = (method: string) =>
    sendGaEvent('diagnosis_share', { method, variant, variant_chosen: chosen, person_count: personNames.length });

  const selectVariant = (next: OshiVodShareVariant) => {
    if (next === variant) return;
    sendGaEvent('diagnosis_share_variant_select', { variant: next, from_variant: variant, person_count: personNames.length });
    setVariant(next);
    setChosen(true);
    try { localStorage.setItem(VARIANT_STORAGE_KEY, next); } catch { /* 保存できなくても切り替えは有効 */ }
  };

  const copy = async () => {
    const ok = await copyTextWithFallback(sharedUrl('copy'));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    track('copy');
  };

  const nativeShare = async () => {
    track('native');
    try {
      // 対応端末では選択中のデザインの結果画像も添付する（非対応ならテキスト＋URLのみ）
      let files: File[] | undefined;
      try {
        const res = await fetch(imageFeedPath);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `oshi-vod-result-${variant}.png`, { type: 'image/png' });
          if (navigator.canShare?.({ files: [file] })) files = [file];
        }
      } catch { /* 画像なしで共有 */ }
      await navigator.share({ title: '推しに合うサブスク診断', text, url: sharedUrl('native'), ...(files ? { files } : {}) });
    } catch {
      // ユーザーによるキャンセル等は無視
    }
  };

  return (
    <div className="ov-share" ref={rootRef} data-share-variant={variant}>
      <div className="ov-share-variant" role="radiogroup" aria-label="シェア画像のデザイン">
        {OSHI_VOD_SHARE_VARIANTS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={variant === v}
            className={`ov-share-variant-btn ov-share-variant-btn--${v}`}
            onClick={() => selectVariant(v)}
          >
            <span className="ov-share-variant-swatch" aria-hidden="true" />
            <span className="ov-share-variant-text">
              <span className="ov-share-variant-label">{OSHI_VOD_SHARE_VARIANT_LABELS[v]}</span>
              <span className="ov-share-variant-hint">{VARIANT_HINTS[v]}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="ov-share-preview">
        {previewLoaded ? (
          OSHI_VOD_SHARE_VARIANTS.map((v) => (
            imageFailed[v] ? (
              v === variant && <p key={v} className="ov-share-image-error">画像を表示できませんでした</p>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={v}
                src={buildOshiVodImagePath(personNames, 'feed', v)}
                alt={`診断結果の画像（${OSHI_VOD_SHARE_VARIANT_LABELS[v]}デザイン）`}
                width={1080}
                height={1350}
                className={`ov-share-image${v === variant ? ' is-active' : ''}`}
                aria-hidden={v !== variant}
                onError={() => setImageFailed((f) => ({ ...f, [v]: true }))}
              />
            )
          ))
        ) : (
          <div className="ov-share-image ov-share-image--placeholder" aria-hidden="true" />
        )}
      </div>

      <div className="ov-share-buttons">
        {canNativeShare && (
          <button type="button" className="ov-share-btn ov-share-btn--main" onClick={nativeShare}>画像つきでシェア</button>
        )}
        <a className="ov-share-btn ov-share-btn--x" href={buildXShareUrl(text, sharedUrl('x'))} target="_blank" rel="noopener noreferrer" onClick={() => track('x')}>
          Xでポスト
        </a>
        <a className="ov-share-btn ov-share-btn--line" href={buildLineShareUrl(sharedUrl('line'))} target="_blank" rel="noopener noreferrer" onClick={() => track('line')}>
          LINEで送る
        </a>
        <button type="button" className="ov-share-btn" onClick={copy}>{copied ? 'コピーしました' : '結果のURLをコピー'}</button>
      </div>
      <p className="ov-share-note">X・LINE に貼ったリンクのカードも、選んだデザインで表示されます。</p>
      <div className="ov-share-downloads">
        <a href={imageFeedPath} download={`oshi-vod-result-${variant}.png`} className="theme-text-link" onClick={() => track('image_save_feed')}>画像を保存（投稿用 4:5）</a>
        <a href={imageStoryPath} download={`oshi-vod-result-${variant}-story.png`} className="theme-text-link" onClick={() => track('image_save_story')}>画像を保存（ストーリーズ用 9:16）</a>
      </div>
    </div>
  );
}
