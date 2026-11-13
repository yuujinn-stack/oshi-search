'use client';

// 推し布教カードの画像ができるまでの待機表示（作成画面の全画面表示・カード画面の画像の場所の両方で使う）。
// - 人物名・デザイン名・カード型の枠（デザインごとの色）と、「あなただけの推しカードを制作中！」「完成まで通常10〜15秒程度」を出す。
// - 実際の処理の進み具合は取得できないため、進捗率や処理の段階は表示しない。経過時間で文言だけを切り替える
//   （短い案内を順に表示し、15秒を過ぎたら「いつもより少し時間がかかっています」）。
// - SSR は枠の周りに金・紫・ピンクの控えめな光。動きを減らす設定（prefers-reduced-motion）では動かさない（CSS）。
// - エラー・タイムアウトのときだけ「もう一度ためす」を出す（それ以外は待機を続ける）。
// - 画像が届いてカードの画面へ移り始めたら（done）、「完成しました。表示しています…」にし、「編集に戻る」は出さない
//   （移動は取り消せないため。ボタンの場所の高さは残し、表示がずれないようにする）。
import { useEffect, useState } from 'react';
import type { OshiCardVariant } from '@/lib/oshi-card/params';
import { isOshiCardTcgVariant } from '@/lib/oshi-card/tcg';
import { oshiCardVariantLabel } from './OshiCardVariantToggle';

/** この時間を過ぎたら「いつもより少し時間がかかっています」を出す */
export const OSHI_CARD_WAIT_SLOW_MS = 15_000;
/** この時間を過ぎても画像が届かなければ、タイムアウトとして再試行を出す（通常は10〜15秒。関数の上限よりは短く） */
export const OSHI_CARD_WAIT_TIMEOUT_MS = 120_000;
/** 待っている間に順に出す短い案内（処理の段階を表すものではない） */
/** 画像が届き、カードの画面へ移っている間の文言 */
export const OSHI_CARD_WAIT_DONE_MESSAGE = '完成しました。表示しています…';
export const OSHI_CARD_WAIT_MESSAGES = ['推しの魅力をカードに込めています', '完成したら自動で表示されます', 'このままお待ちください'] as const;
const MESSAGE_INTERVAL_MS = 4_000;

export type OshiCardWaitError = 'timeout' | 'busy' | 'failed';

export function oshiCardWaitErrorText(e: OshiCardWaitError): string {
  if (e === 'timeout') return '時間がかかりすぎたため、いったん止めました。もう一度お試しください。';
  if (e === 'busy') return 'アクセスが集中しています。少し待ってから、もう一度お試しください。';
  return 'カードを作れませんでした。通信状況を確認して、もう一度お試しください。';
}

/** 待機を始めてからの経過時間（ms）。1秒ごとに更新 */
function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active, startedAt]);
  return Math.max(0, now - startedAt);
}

interface Props {
  person: string;
  variant: OshiCardVariant;
  /** 待機を始めた時刻（Date.now()）。再試行のたびに新しくする */
  startedAt: number;
  /** overlay＝作成画面の全画面表示、inline＝カード画面の画像の場所 */
  mode: 'overlay' | 'inline';
  error?: OshiCardWaitError | null;
  /** 画像が届き、カードの画面へ移動中（「編集に戻る」は出さない） */
  done?: boolean;
  onRetry?: () => void;
  onBack?: () => void;
}

export default function OshiCardWaiting({ person, variant, startedAt, mode, error = null, done = false, onRetry, onBack }: Props) {
  const waiting = !error && !done;
  const elapsed = useElapsed(startedAt, waiting);
  const slow = waiting && elapsed >= OSHI_CARD_WAIT_SLOW_MS;
  const message = OSHI_CARD_WAIT_MESSAGES[Math.floor(elapsed / MESSAGE_INTERVAL_MS) % OSHI_CARD_WAIT_MESSAGES.length];
  const label = oshiCardVariantLabel(variant);
  const shape = isOshiCardTcgVariant(variant) ? 'tcg' : 'feed';

  const body = (
    <div className={`oc-wait oc-wait--${mode}`} data-variant={variant} data-state={error ? 'error' : done ? 'done' : slow ? 'slow' : 'waiting'} aria-busy={!error}>
      <div className="oc-wait-card" data-shape={shape} aria-hidden="true">
        <div className="oc-wait-card-face">
          {variant === 'ssr' && (
            // SSR だけの飾り（完成カードの雰囲気に寄せる）：光の粒（2層）・内側の金の細い線・上の宝石・名前を囲む光の輪・下の淡い情報欄
            <>
              <span className="oc-wait-ssr-sparkles" />
              <span className="oc-wait-ssr-sparkles oc-wait-ssr-sparkles--far" />
              <span className="oc-wait-ssr-panel" />
              <span className="oc-wait-ssr-orbit" />
              <span className="oc-wait-ssr-inner" />
              <span className="oc-wait-ssr-gem" />
            </>
          )}
          <span className="oc-wait-card-badge">{label}</span>
          <span className="oc-wait-card-name">{person}</span>
          <span className="oc-wait-card-shine" />
        </div>
      </div>
      <div className="oc-wait-text">
        <p className="oc-wait-meta">{person}・{label}</p>
        {error ? (
          <div role="alert">
            <p className="oc-wait-title">カードを表示できませんでした</p>
            <p className="oc-wait-message">{oshiCardWaitErrorText(error)}</p>
            <div className="oc-wait-actions">
              {onRetry && <button type="button" className="oc-btn-main oc-wait-retry" onClick={onRetry}>もう一度ためす</button>}
              {onBack && <button type="button" className="oc-btn-sub" onClick={onBack}>編集に戻る</button>}
            </div>
          </div>
        ) : (
          <div role="status" aria-live="polite">
            <p className="oc-wait-title">あなただけの推しカードを制作中！</p>
            <p className="oc-wait-sub">完成まで通常10〜15秒程度</p>
            <p className="oc-wait-message" key={done ? 'done' : slow ? 'slow' : message}>
              {done ? OSHI_CARD_WAIT_DONE_MESSAGE : slow ? 'いつもより少し時間がかかっています。このままお待ちください' : message}
            </p>
            <span className="oc-wait-dots" aria-hidden="true"><i /><i /><i /></span>
            {onBack && <div className="oc-wait-back">{!done && <button type="button" className="oc-wait-back-btn" onClick={onBack}>編集に戻る</button>}</div>}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === 'inline') return body;
  return (
    <div className="oc-wait-overlay" role="dialog" aria-modal="true" aria-label="推しカードを制作中">
      {body}
    </div>
  );
}
