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
import OshiCardWaiting, { OSHI_CARD_WAIT_TIMEOUT_MS } from './OshiCardWaiting';

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
  // 画像ができるまでの待機表示：表示できた（読み込み済みの）デザイン・待ち始めた時刻・再試行の回数（img を作り直して再取得）
  const [ready, setReady] = useState<Partial<Record<OshiCardVariant, boolean>>>({});
  const [waitSince, setWaitSince] = useState<Partial<Record<OshiCardVariant, number>>>(() => ({ [selection.variant]: Date.now() }));
  const [attempt, setAttempt] = useState<Partial<Record<OshiCardVariant, number>>>({});
  const [timedOut, setTimedOut] = useState<Partial<Record<OshiCardVariant, boolean>>>({});
  const markReady = (v: OshiCardVariant) => setReady((r) => (r[v] ? r : { ...r, [v]: true }));
  // サーバーで描いた画面では待機表示・透明化をしない（画像が先に届いていれば、そのまま見せる＝表示を遅らせない）
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const activeWaiting = hydrated && !ready[variant] && !failed[variant] && !timedOut[variant];
  // 長く待っても届かないときだけ、再試行を出す（届けば表示する）
  useEffect(() => {
    if (!activeWaiting) return;
    const since = waitSince[variant] ?? Date.now();
    const t = setTimeout(() => setTimedOut((x) => ({ ...x, [variant]: true })), Math.max(0, since + OSHI_CARD_WAIT_TIMEOUT_MS - Date.now()));
    return () => clearTimeout(t);
  }, [activeWaiting, variant, waitSince]);
  const retry = (v: OshiCardVariant) => {
    setFailed((f) => ({ ...f, [v]: false }));
    setTimedOut((x) => ({ ...x, [v]: false }));
    setWaitSince((w) => ({ ...w, [v]: Date.now() }));
    setAttempt((a) => ({ ...a, [v]: (a[v] ?? 0) + 1 }));
  };

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
    setWaitSince((w) => (w[v] ? w : { ...w, [v]: Date.now() }));
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
          // 読み込みに失敗しても img は残す（見えない状態で、画像の場所の大きさを保つ。上に待機・再試行の表示を重ねる）
          (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${v}-${attempt[v] ?? 0}`}
              src={buildOshiCardImagePath({ ...selection, variant: v }, 'feed')}
              alt={`${selection.person}の布教カード（${oshiCardVariantLabel(v)}デザイン）`}
              width={oshiCardImageDimensions('feed', v).width}
              height={oshiCardImageDimensions('feed', v).height}
              data-shape={isOshiCardTcgVariant(v) ? 'tcg' : 'feed'}
              className={`oc-share-image${v === variant ? ' is-active' : ''}${hydrated && !ready[v] ? ' is-waiting' : ''}`}
              aria-hidden={v !== variant}
              // 表示より先に読み込みが終わっていた場合（サーバーで描いた img）も取りこぼさない
              ref={(el) => { if (el && el.complete && el.naturalWidth > 0) markReady(v); }}
              onLoad={() => markReady(v)}
              onError={() => setFailed((f) => ({ ...f, [v]: true }))}
            />
          )
        ))}
        {/* 画像ができるまで：カード型の待機表示。エラー・タイムアウトのときだけ再試行 */}
        {hydrated && !ready[variant] && (
          <OshiCardWaiting
            key={`wait-${variant}-${attempt[variant] ?? 0}`}
            mode="inline"
            person={selection.person}
            variant={variant}
            startedAt={waitSince[variant] ?? Date.now()}
            error={failed[variant] ? 'failed' : timedOut[variant] ? 'timeout' : null}
            onRetry={() => retry(variant)}
          />
        )}
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
