'use client';

// 完成した布教カードのプレビューと共有（画像つきでシェア・X・LINE・リンクコピー・画像保存）。
// サブスク診断の共有（OshiVodShare）と同じ作り：画像を重ね、切り替えは表示の入れ替えだけで即時。
// デザインが複数あるため、最初は選択中のデザインだけを読み込み、一度選んだデザインの画像は残しておく（再選択は即時）。
// トレカ風（ベーシック／SSR／レジェンド）の画像は 63:88（1260×1760）。カスタマイズ（名前・特性等）はデザインを変えても引き継ぐ。
// 共有URLには人物・作品・順序・デザイン・ひとことと、共有方法（sm）を付ける。
// 計測（GA4 oshi_card_share）は「共有ボタンを押した」ことで、SNS への投稿完了ではない（投稿されたかはこちらでは分からない）。
import { useEffect, useState } from 'react';
import { copyTextWithFallback } from '@/lib/clipboard-utils';
import { sendGaEvent } from '@/lib/ga-event';
import { buildLineShareUrl, buildXShareUrl } from '@/lib/oshi-vod/share';
import { buildOshiCardShareText } from '@/lib/oshi-card/core';
import {
  buildOshiCardImagePath,
  buildOshiCardResultPath,
  buildOshiCardSharedUrl,
  oshiCardImageDimensions,
  type OshiCardSelection,
  type OshiCardShareMethod,
  type OshiCardVariant,
} from '@/lib/oshi-card/params';
import { isOshiCardTcgVariant } from '@/lib/oshi-card/tcg';
import OshiCardVariantToggle, { oshiCardVariantLabel } from './OshiCardVariantToggle';

interface Props {
  selection: OshiCardSelection;
  titles: string[];
}

const SITE_ORIGIN_FALLBACK = 'https://oshi-search.jp';

export default function OshiCardShare({ selection, titles }: Props) {
  const [origin, setOrigin] = useState(SITE_ORIGIN_FALLBACK);
  const [variant, setVariant] = useState<OshiCardVariant>(selection.variant);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [failed, setFailed] = useState<Partial<Record<OshiCardVariant, boolean>>>({});
  // 読み込んだ（一度でも選んだ）デザイン。従来の2デザインは最初から両方読み込む（以前と同じ即時切り替え）
  const [loaded, setLoaded] = useState<OshiCardVariant[]>(() => (isOshiCardTcgVariant(selection.variant) ? [selection.variant] : ['cool', 'cute']));
  const tcgVariant = isOshiCardTcgVariant(variant);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const sel: OshiCardSelection = { ...selection, variant };
  const text = buildOshiCardShareText(selection.person, titles.map((title) => ({ title })));
  const shared = (m: OshiCardShareMethod) => buildOshiCardSharedUrl(origin, sel, m);
  const feedPath = buildOshiCardImagePath(sel, 'feed');
  const storyPath = buildOshiCardImagePath(sel, 'story');
  const track = (method: string) => sendGaEvent('oshi_card_share', { method, variant, work_count: selection.workIds.length });

  const chooseVariant = (v: OshiCardVariant) => {
    if (v === variant) return;
    sendGaEvent('oshi_card_variant_select', { variant: v, from_variant: variant, stage: 'card' });
    setVariant(v);
    setLoaded((cur) => (cur.includes(v) ? cur : [...cur, v]));
    // アドレスバーの URL も選んだデザインにそろえる（そのままコピーされても同じカードになる）
    try { window.history.replaceState(null, '', buildOshiCardResultPath({ ...selection, variant: v })); } catch { /* 表示には影響しない */ }
  };

  const copy = async () => {
    const ok = await copyTextWithFallback(shared('copy'));
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
    track('copy');
  };

  const nativeShare = async () => {
    track('native');
    try {
      let files: File[] | undefined;
      try {
        const res = await fetch(feedPath);
        if (res.ok) {
          const file = new File([await res.blob()], `oshi-card-${variant}.png`, { type: 'image/png' });
          if (navigator.canShare?.({ files: [file] })) files = [file];
        }
      } catch { /* 画像なしで共有 */ }
      await navigator.share({ title: `${selection.person}の布教カード`, text, url: shared('native'), ...(files ? { files } : {}) });
    } catch { /* キャンセル等は無視 */ }
  };

  return (
    <div className="oc-share" data-variant={variant}>
      <OshiCardVariantToggle value={variant} onChange={chooseVariant} />
      <div className="oc-share-preview" data-shape={tcgVariant ? 'tcg' : 'feed'}>
        {loaded.map((v) => (
          failed[v] ? (
            v === variant && <p key={v} className="oc-note">画像を表示できませんでした。時間をおいて再度お試しください。</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={v}
              src={buildOshiCardImagePath({ ...selection, variant: v }, 'feed')}
              alt={`${selection.person}の布教カード（${oshiCardVariantLabel(v)}デザイン）`}
              width={oshiCardImageDimensions('feed', v).width}
              height={oshiCardImageDimensions('feed', v).height}
              data-shape={isOshiCardTcgVariant(v) ? 'tcg' : 'feed'}
              className={`oc-share-image${v === variant ? ' is-active' : ''}`}
              aria-hidden={v !== variant}
              onError={() => setFailed((f) => ({ ...f, [v]: true }))}
            />
          )
        ))}
      </div>
      <div className="oc-share-buttons">
        {canNativeShare && <button type="button" className="oc-share-btn oc-share-btn--main" onClick={nativeShare}>画像つきでシェア</button>}
        <a className="oc-share-btn oc-share-btn--x" href={buildXShareUrl(text, shared('x'))} target="_blank" rel="noopener noreferrer" onClick={() => track('x')}>Xでポスト</a>
        <a className="oc-share-btn oc-share-btn--line" href={buildLineShareUrl(shared('line'))} target="_blank" rel="noopener noreferrer" onClick={() => track('line')}>LINEで送る</a>
        <button type="button" className="oc-share-btn" onClick={copy}>{copied ? 'コピーしました' : 'リンクをコピー'}</button>
      </div>
      <div className="oc-share-downloads">
        <a href={feedPath} download={`oshi-card-${variant}.png`} className="theme-text-link" onClick={() => track('image_save_feed')}>{tcgVariant ? 'カード画像を保存（63:88）' : '画像を保存（投稿用 4:5）'}</a>
        <a href={storyPath} download={`oshi-card-${variant}-story.png`} className="theme-text-link" onClick={() => track('image_save_story')}>画像を保存（ストーリーズ用 9:16）</a>
      </div>
      <p className="oc-note oc-center">X・LINE に貼ったリンクのカードにも、このデザインが表示されます。</p>
    </div>
  );
}
