'use client';

// 共有リンク（/oshi-vod?p=...&sv=cute&sm=x）経由の訪問を計測する（GA4 diagnosis_share_visit）。
// - 計測後は sv / sm を URL から取り除く（再読み込みで二重に数えない・訪問者が URL をそのまま再共有しても
//   元の共有元が混ざらない）。診断に使う p 等はそのまま残す。
// - 同じタブで新しい診断を始めたときに共有経由と分かるよう、sessionStorage に引き継ぐ（OshiVodPersonPicker が読む）。
// - 結果を表示できたときは、ページ上部に「共有された結果であること」と「自分の推しで診断する」導線を出す
//   （結果の見出しは「あなたの推し…」のため、共有を受け取った人には自分の結果に見えてしまう。
//    診断する欄はページ下部にあるため、そこへ移動するボタンを置く）。クリックは GA4 diagnosis_share_visit_cta_click。
import { useEffect } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import {
  OSHI_VOD_SHARE_METHOD_PARAM,
  OSHI_VOD_SHARE_VARIANT_PARAM,
  rememberShareAttribution,
  type OshiVodShareAttribution,
} from '@/lib/oshi-vod/share';

/**
 * GA4（window.gtag）が使えるようになってから送る。
 * GA4 は AnalyticsGate のマウント後に読み込まれるため、ページを開いた直後（子の useEffect は親より先に動く）に
 * sendGaEvent を呼ぶと gtag がまだ無く、黙って捨てられる。共有リンク経由の訪問は必ずページを開いた直後なので、
 * 最大10秒待つ（GA4 を読み込まないホストでは送らずに終わる）。戻り値は待機の中止。
 */
function sendWhenGaReady(name: string, params: Parameters<typeof sendGaEvent>[1], timeoutMs = 10_000): () => void {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    if (typeof (window as unknown as { gtag?: unknown }).gtag === 'function') {
      sendGaEvent(name, params);
      return;
    }
    if (Date.now() - started < timeoutMs) timer = setTimeout(tick, 250);
  };
  tick();
  return () => { if (timer) clearTimeout(timer); };
}

interface Props {
  attribution: OshiVodShareAttribution;
  /** 共有された結果を表示できたか（人物が見つからない等で入口ページになった場合は false） */
  hasResult: boolean;
  personCount: number;
}

export default function OshiVodShareVisitTracker({ attribution, hasResult, personCount }: Props) {
  const { variant, method } = attribution;
  useEffect(() => {
    const cancel = sendWhenGaReady('diagnosis_share_visit', { variant, share_method: method, has_result: hasResult, person_count: personCount });
    rememberShareAttribution({ variant, method });
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(OSHI_VOD_SHARE_VARIANT_PARAM);
      url.searchParams.delete(OSHI_VOD_SHARE_METHOD_PARAM);
      // Next.js App Router は window.history.replaceState と同期する（ページの再取得は起きない）
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch { /* URL を整えられなくても計測には影響しない */ }
    return cancel;
  }, [variant, method, hasResult, personCount]);

  if (!hasResult) return null;
  return (
    <div className="ov-share-visit" role="note">
      <p className="ov-share-visit-text">
        <strong>共有された診断結果です。</strong>
        あなたの推しなら、どのサブスクが一番見られる？
      </p>
      <a
        href="#oshi-vod-picker"
        className="ov-share-visit-btn"
        onClick={() => sendGaEvent('diagnosis_share_visit_cta_click', { variant, share_method: method, person_count: personCount })}
      >
        自分の推しで診断する（無料・登録不要）↓
      </a>
    </div>
  );
}
