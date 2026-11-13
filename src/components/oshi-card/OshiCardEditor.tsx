'use client';

// 推し布教カードの作成画面：② おすすめ作品を選ぶ → ③ 並べ替え → ④ デザイン（＋トレカ風のカスタマイズ）・ひとこと・プレビュー → 作成。
// 作品はその人物の公開作品（サーバーで作った候補）からだけ選べる。「おすすめ」は利用者の主観であることを画面にも明記する。
// 作品数：ノーマル・デコは1〜3件、トレカ風（ベーシック／SSR／レジェンド）は0〜3件（名前が主役のため作品なしでも作れる）。
// プレビューは本番と同じ画像API（/api/oshi-card/image）の画像そのもの（保存画像と見た目が一致する）。選択を変えると少し待ってから更新する。
// トレカ風の入力（名前・特性・沼ポイント・推し力・推し色）はデザインを切り替えても保持する。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { secLabel } from '@/components/oshi-vod/sec-label';
import type { OshiCardWork } from '@/lib/oshi-card/core';
import {
  OSHI_CARD_MAX_WORKS,
  OSHI_CARD_PATH,
  OSHI_CARD_PHRASES,
  buildOshiCardImagePath,
  buildOshiCardResultPath,
  oshiCardImageDimensions,
  oshiCardMinWorks,
  type OshiCardPhraseId,
  type OshiCardSelection,
  type OshiCardVariant,
} from '@/lib/oshi-card/params';
import { isOshiCardColorId, isOshiCardTcgVariant, oshiCardColor, oshiCardTcgDraftFrom, oshiCardTcgFromDraft, OSHI_CARD_TCG_TEMPLATES, type OshiCardColorId, type OshiCardTcgDraft, type OshiCardTcgOptions, type OshiCardTcgVariant } from '@/lib/oshi-card/tcg';
import { oshiCardShareParams } from '@/lib/oshi-card/attribution';
import { sendGaEvent } from '@/lib/ga-event';
import OshiCardVariantToggle, { oshiCardVariantLabel } from './OshiCardVariantToggle';
import OshiCardWaiting, { OSHI_CARD_WAIT_TIMEOUT_MS, type OshiCardWaitError } from './OshiCardWaiting';
import OshiCardTcgFields from './OshiCardTcgFields';

interface Props {
  person: { name: string; group: string };
  candidates: OshiCardWork[];
  initial: { workIds: string[]; variant: OshiCardVariant; phrase: OshiCardPhraseId; tcg: OshiCardTcgOptions };
}

const PAGE_SIZE = 30;

export default function OshiCardEditor({ person, candidates, initial }: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const [selected, setSelected] = useState<string[]>(initial.workIds.filter((id) => byId.has(id)).slice(0, OSHI_CARD_MAX_WORKS));
  // 出演作品が未登録の人物は、作品なしで作れるトレカ風のデザインだけを選べる
  const noWorks = candidates.length === 0;
  const [variant, setVariant] = useState<OshiCardVariant>(noWorks && !isOshiCardTcgVariant(initial.variant) ? 'basic' : initial.variant);
  const [phrase, setPhrase] = useState<OshiCardPhraseId>(initial.phrase);
  const [tcgDraft, setTcgDraft] = useState<OshiCardTcgDraft>(() => oshiCardTcgDraftFrom(initial.tcg));
  const isTcg = isOshiCardTcgVariant(variant);
  const minWorks = oshiCardMinWorks(variant);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [submitting, setSubmitting] = useState(false);
  // 「このカードを作る」を押した後の待機：カード画像（カードの画面が表示するものと同じ URL）を先に取得し、届いたらカードの画面へ移る。
  // 画像の生成そのもの（API）は変えない。取得した画像はブラウザ・CDN のキャッシュに入るため、カードの画面ではすぐ表示される。
  // id：生成の回ごとの番号（作り直し・再試行のたびに新しくする）。古い回の取得結果は、画面を書き換えず・移動もしない
  // done：画像が届き、カードの画面への移動を始めた（移動は取り消せないため、「編集に戻る」は出さない）
  const [wait, setWait] = useState<{ id: number; imagePath: string; resultPath: string; variant: OshiCardVariant; startedAt: number; error: OshiCardWaitError | null; done: boolean } | null>(null);
  const waitSeq = useRef(0);
  const activeWaitId = useRef(0);

  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.typeLabel, (counts.get(c.typeLabel) ?? 0) + 1);
    return [...counts.entries()];
  }, [candidates]);

  const filtered = useMemo(() => {
    const q = query.trim().normalize('NFKC').toLowerCase();
    return candidates.filter((c) => (typeFilter === 'all' || c.typeLabel === typeFilter) && (!q || c.title.normalize('NFKC').toLowerCase().includes(q)));
  }, [candidates, typeFilter, query]);

  const tcg = useMemo(() => oshiCardTcgFromDraft(tcgDraft, person.name), [tcgDraft, person.name]);
  const selection: OshiCardSelection | null = selected.length >= minWorks
    ? { person: person.name, workIds: selected, variant, phrase, ...(isTcg ? { tcg } : {}) }
    : null;
  const previewPath = selection ? buildOshiCardImagePath(selection) : null;
  const previewSize = oshiCardImageDimensions('feed', variant);
  // 選択・入力を変えるたびに画像を作り直さないよう、少し待ってから更新する（文字入力中は少し長めに待つ）
  const [shownPreview, setShownPreview] = useState<string | null>(previewPath);
  const [lastTyped, setLastTyped] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShownPreview(previewPath), Date.now() - lastTyped < 1000 ? 700 : 250);
    return () => clearTimeout(t);
  }, [previewPath, lastTyped]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  // 表示できた最後の画像（更新に失敗したときは、これを表示したままにする）
  const [goodPreview, setGoodPreview] = useState<string | null>(null);
  useEffect(() => { if (shownPreview) { setPreviewLoading(true); setPreviewError(false); } }, [shownPreview]);
  const changeTcg = (next: OshiCardTcgDraft) => { setLastTyped(Date.now()); setTcgDraft(next); };
  // 推し色：選んだ瞬間にプレビューの周りを選んだ色で光らせ、「反映中」を出す（画像の作り直しは従来どおり裏で行い、届いたら消える）。
  // 表示中の画像の推し色（URL の c）と、これから表示する画像の推し色が違う間だけ出す。
  // 色は画像の URL で比べる（SSR は「紫を明示」と「省略＝既定」が別の画像のため、色名ではなく c の有無まで比べる）
  const oshiColor: OshiCardColorId | null = isOshiCardTcgVariant(variant) ? tcg.color ?? OSHI_CARD_TCG_TEMPLATES[variant].defaultColor : null;
  const wantColor = isOshiCardTcgVariant(variant) ? previewColorParamOf(previewPath, variant) : undefined;
  const shownColor = isOshiCardTcgVariant(variant) ? previewColorParamOf(goodPreview, variant) : undefined;
  const oshiPending = !!oshiColor && !previewError && wantColor !== undefined && shownColor !== undefined && shownColor !== wantColor;

  const full = selected.length >= OSHI_CARD_MAX_WORKS;

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      sendGaEvent('oshi_card_work_select', { action: 'remove', work_count: selected.length - 1 });
      setSelected(selected.filter((x) => x !== id));
    } else if (selected.length < OSHI_CARD_MAX_WORKS) {
      sendGaEvent('oshi_card_work_select', { action: 'add', work_count: selected.length + 1 });
      setSelected([...selected, id]);
    }
  };
  const move = (i: number, dir: -1 | 1) => {
    setSelected((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const chooseVariant = (v: OshiCardVariant) => {
    if (v === variant) return;
    sendGaEvent('oshi_card_variant_select', { variant: v, from_variant: variant, stage: 'edit' });
    setVariant(v);
  };

  const submit = () => {
    if (!selection || submitting || wait) return;
    sendGaEvent('oshi_card_generate', { variant, phrase, work_count: selected.length, ...(isTcg ? { tcg_color: tcg.color ?? 'default', tcg_custom_name: !!tcg.name } : {}), ...oshiCardShareParams() });
    setSubmitting(true);
    setWait({ id: ++waitSeq.current, imagePath: buildOshiCardImagePath(selection), resultPath: buildOshiCardResultPath(selection), variant, startedAt: Date.now(), error: null, done: false });
  };

  // 待機中：画像を取得 → 届いたらカードの画面へ。エラー・タイムアウトのときだけ再試行を出す
  const waitId = wait?.id ?? 0;
  const waitError = wait?.error ?? null;
  useEffect(() => {
    activeWaitId.current = wait && !waitError ? waitId : 0;
    if (!wait || waitError) return;
    const id = waitId;
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, OSHI_CARD_WAIT_TIMEOUT_MS);
    fetch(wait.imagePath, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
        await res.blob();
        clearTimeout(timer);
        // 「編集に戻る」・作り直しの後に届いた古い結果では移動しない（この判定と移動の開始の間に他の処理は入らない）
        if (ac.signal.aborted || activeWaitId.current !== id) return;
        // ここから先は移動を取り消せないため、待機表示を「完成しました」にして「編集に戻る」を消してから移動する
        setWait((w) => (w && w.id === id ? { ...w, done: true } : w));
        router.push(wait.resultPath);
      })
      .catch((e: { status?: number }) => {
        clearTimeout(timer);
        if (ac.signal.aborted && !timedOut) return; // 「編集に戻る」・画面を離れたときなど
        if (activeWaitId.current !== id) return;
        const error: OshiCardWaitError = timedOut ? 'timeout' : e?.status === 429 ? 'busy' : 'failed';
        setWait((w) => (w && w.id === id ? { ...w, error } : w));
      });
    return () => { clearTimeout(timer); ac.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 生成の回（id）ごとにだけ取得し直す
  }, [waitId, waitError]);

  // 待機中は後ろの画面をスクロールさせない
  const waiting = !!wait;
  useEffect(() => {
    if (!waiting) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [waiting]);

  return (
    <div className="oc-editor">
      {wait && (
        <OshiCardWaiting
          mode="overlay"
          person={person.name}
          variant={wait.variant}
          startedAt={wait.startedAt}
          error={wait.error}
          done={wait.done}
          onRetry={() => setWait((w) => (w ? { ...w, id: ++waitSeq.current, error: null, startedAt: Date.now() } : w))}
          // 待機中・エラーのどちらでも押せる。進行中の取得は中止し、後から届いた結果では画面を変えない
          onBack={() => {
            if (wait.done) return; // 移動を始めた後は戻さない（ボタンも出していない）
            activeWaitId.current = 0; setWait(null); setSubmitting(false);
          }}
        />
      )}
      {noWorks && (
        <div className="oc-panel">
          <p className="oc-empty-title">{person.name}の出演作品は、まだ推しサーチに登録されていません。</p>
          <p className="oc-note">ノーマル・デコのカードは、推しサーチに登録されている出演作品から作ります。作品が登録されたら作れるようになります。名前が主役のトレカ風デザイン（ベーシック・SSR）は、作品なしで作れます。</p>
          <div className="oc-row-buttons">
            <Link href={`/person/${encodeURIComponent(person.name)}`} className="oc-btn-sub">{person.name}のページを見る</Link>
            <Link href={OSHI_CARD_PATH} className="oc-btn-sub">ほかの推しで作る</Link>
          </div>
        </div>
      )}
      {!noWorks && (<>
      {/* ② 作品を選ぶ */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-works">
        <h2 id="oc-step-works" className="oc-step-title">{isTcg ? 'おすすめしたい作品を選ぶ（0〜3作品）' : 'おすすめしたい作品を選ぶ（1〜3作品）'}</h2>
        <p className="oc-note">あなたが好きな作品を選んでください。カードには「投稿者のおすすめ」として表示され、公式の順位にはなりません。</p>
        {isTcg && <p className="oc-note">トレカ風のデザイン（ベーシック・SSR）は、作品を選ばなくても作れます。</p>}
        {types.length > 1 && (
          <div className="oc-chips" role="radiogroup" aria-label="作品の分類">
            <button type="button" role="radio" aria-checked={typeFilter === 'all'} className={`oc-chip${typeFilter === 'all' ? ' is-on' : ''}`} onClick={() => { setTypeFilter('all'); setLimit(PAGE_SIZE); }}>すべて {candidates.length}</button>
            {types.map(([label, count]) => (
              <button key={label} type="button" role="radio" aria-checked={typeFilter === label} className={`oc-chip${typeFilter === label ? ' is-on' : ''}`} onClick={() => { setTypeFilter(label); setLimit(PAGE_SIZE); }}>{label} {count}</button>
            ))}
          </div>
        )}
        {candidates.length > 8 && (
          <input
            type="search"
            className="oc-input oc-input--sm"
            placeholder="作品名でしぼりこむ"
            aria-label="作品名でしぼりこむ"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }}
            style={{ fontSize: '16px' }}
          />
        )}
        <ul className="oc-works" aria-label={`${person.name}の出演作品`}>
          {filtered.slice(0, limit).map((w) => {
            const idx = selected.indexOf(w.id);
            const on = idx >= 0;
            return (
              <li key={w.id}>
                <button type="button" className={`oc-work${on ? ' is-on' : ''}`} aria-pressed={on} disabled={!on && full} onClick={() => toggle(w.id)}>
                  <span className="oc-work-mark" aria-hidden="true">{on ? idx + 1 : '+'}</span>
                  <span className="oc-work-text">
                    <span className="oc-work-title">{w.title}</span>
                    <span className="oc-work-meta">{w.year ? `${w.typeLabel}・${w.year}` : w.typeLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 && <p className="oc-note">条件に合う作品がありません。</p>}
        {filtered.length > limit && (
          <button type="button" className="oc-btn-sub oc-btn-more" onClick={() => setLimit((l) => l + PAGE_SIZE)}>もっと見る（残り{filtered.length - limit}作品）</button>
        )}
        {full && <p className="oc-note" role="status">3作品まで選べます。入れ替えるときは、選んだ作品をもう一度押して外してください。</p>}
      </section>

      {/* ③ 並べ替え */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-order">
        <h2 id="oc-step-order" className="oc-step-title">カードに載せる順番</h2>
        {selected.length === 0 ? (
          <p className="oc-note">作品を選ぶと、ここで順番を変えられます。</p>
        ) : (
          <ol className="oc-order">
            {selected.map((id, i) => {
              const w = byId.get(id)!;
              return (
                <li key={id} className="oc-order-item">
                  <span className="oc-order-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="oc-order-title">{w.title}</span>
                  <span className="oc-order-buttons">
                    <button type="button" className="oc-icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${w.title}を上へ`}>↑</button>
                    <button type="button" className="oc-icon-btn" onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label={`${w.title}を下へ`}>↓</button>
                    <button type="button" className="oc-icon-btn" onClick={() => toggle(id)} aria-label={`${w.title}を外す`}>×</button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      </>)}

      {/* ④ デザイン・カスタマイズ・ひとこと・プレビュー
          スマホ：デザイン → プレビュー → カスタマイズ → ひとこと（選んだらすぐ下でプレビューが変わる）。
          PC（幅720px以上）：左に操作、右にプレビュー（画面に追従） */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-design">
        <h2 id="oc-step-design" className="oc-step-title">デザインを選んでプレビュー</h2>
        <div className="oc-design-grid">
          <div className="oc-design-variants">
            <OshiCardVariantToggle value={variant} onChange={chooseVariant} only={noWorks ? ['basic', 'ssr'] : undefined} />
          </div>
          <div className="oc-design-preview">
            <div
              className="oc-preview"
              data-shape={isTcg ? 'tcg' : 'feed'}
              data-oshi-pending={oshiPending ? 'true' : undefined}
              style={oshiColor ? ({ '--oc-oshi': oshiColor === 'white' ? '#FFFFFF' : oshiCardColor(oshiColor).base, '--oc-oshi-ring': oshiColor === 'white' ? '#A7B0C8' : oshiCardColor(oshiColor).base } as React.CSSProperties) : undefined}
            >
              {shownPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewError && goodPreview ? goodPreview : shownPreview}
                  alt={`${person.name}の布教カード（${oshiCardVariantLabel(variant)}）のプレビュー`}
                  width={previewSize.width}
                  height={previewSize.height}
                  className={`oc-preview-image${previewLoading ? ' is-loading' : ''}`}
                  // 読み込み済み（キャッシュ）の画像に戻したときは、読み込み中の表示を始める前に load が終わることがあるため、ここでも終わりを拾う
                  ref={(el) => { if (el && previewLoading && !previewError && el.complete && el.naturalWidth > 0 && el.getAttribute('src') === shownPreview) { setPreviewLoading(false); setGoodPreview(el.currentSrc || shownPreview); } }}
                  onLoad={(e) => { setPreviewLoading(false); if (!previewError) setGoodPreview(e.currentTarget.currentSrc || shownPreview); }}
                  onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                />
              ) : (
                <div className="oc-preview-image oc-preview-empty"><span>作品を選ぶとプレビューが表示されます</span></div>
              )}
              {oshiPending && oshiColor && (
                <p className="oc-preview-oshi" role="status"><span className="oc-preview-oshi-dot" aria-hidden="true" />推し色「{oshiCardColor(oshiColor).label}」を反映中…</p>
              )}
            </div>
            {oshiColor && <p className="oc-preview-oshi-note">推し色：<span className="oc-preview-oshi-dot" aria-hidden="true" style={{ background: oshiColor === 'white' ? '#FFFFFF' : oshiCardColor(oshiColor).base }} />{oshiCardColor(oshiColor).label}（{OSHI_CARD_COLOR_WHERE[variant as OshiCardTcgVariant]}）</p>}
            {previewError && <p className="oc-note oc-center" role="status">プレビューを更新できませんでした。少し待ってから、もう一度変更してみてください。</p>}
          </div>
          <div className="oc-design-options">
            {isTcg && <OshiCardTcgFields variant={variant} person={person} draft={tcgDraft} onChange={changeTcg} />}
            <p className="oc-label oc-phrase-label">ひとこと</p>
            <div className="oc-phrases" role="radiogroup" aria-label="カードのひとこと">
              {OSHI_CARD_PHRASES.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={phrase === p.id} className={`oc-phrase${phrase === p.id ? ' is-on' : ''}`} onClick={() => setPhrase(p.id)}>{p.text}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 作成ボタンは作成画面全体の末尾に置き、作品を1つ選んだら画面下に固定する（作品を選びながら押せるように） */}
      <div className={`oc-submit${selection ? ' is-sticky' : ''}`}>
        <button type="button" className="oc-btn-main" disabled={!selection || submitting} onClick={submit}>
          {submitting ? 'カードを作っています…' : selection ? (selected.length > 0 ? `このカードを作る（${selected.length}作品）` : 'このカードを作る') : 'このカードを作る'}
        </button>
        {!selection && <p className="oc-note" role="status">おすすめ作品を1つ以上選んでください（トレカ風のデザインは作品なしでも作れます）</p>}
      </div>
    </div>
  );
}

/** 推し色がカードのどこに出るか（プレビューの下の説明） */
const OSHI_CARD_COLOR_WHERE: Record<OshiCardTcgVariant, string> = {
  basic: 'カード全体の色に反映',
  ssr: '名前の光と縁取り・光の輪・特性・沼ポイントの宝石に反映',
  legend: '装飾の色に反映',
};

/** プレビュー画像の URL の推し色（c。省略は null）。画像がない・別のデザインの画像なら undefined */
function previewColorParamOf(src: string | null, variant: OshiCardTcgVariant): OshiCardColorId | null | undefined {
  if (!src) return undefined;
  try {
    const q = new URL(src, 'https://x.invalid').searchParams;
    if (q.get('v') !== variant) return undefined;
    const c = q.get('c');
    return isOshiCardColorId(c) ? c : null;
  } catch {
    return undefined;
  }
}
