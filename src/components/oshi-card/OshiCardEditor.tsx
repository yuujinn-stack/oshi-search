'use client';

// 推し布教カードの作成画面：② おすすめ作品を選ぶ → ③ 並べ替え → ④ デザイン（＋トレカ風のカスタマイズ）・ひとこと・プレビュー → 作成。
// 作品はその人物の公開作品（サーバーで作った候補）からだけ選べる。「おすすめ」は利用者の主観であることを画面にも明記する。
// 作品数：ノーマル・デコは1〜3件、トレカ風（ベーシック／SSR／レジェンド）は0〜3件（名前が主役のため作品なしでも作れる）。
// プレビューは本番と同じ画像API（/api/oshi-card/image）の画像そのもの（保存画像と見た目が一致する）。選択を変えると少し待ってから更新する。
// トレカ風の入力（名前・特性・沼ポイント・推し力・推し色）はデザインを切り替えても保持する。
import { useEffect, useMemo, useState } from 'react';
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
import { isOshiCardTcgVariant, oshiCardTcgDraftFrom, oshiCardTcgFromDraft, type OshiCardTcgDraft, type OshiCardTcgOptions } from '@/lib/oshi-card/tcg';
import { oshiCardShareParams } from '@/lib/oshi-card/attribution';
import { sendGaEvent } from '@/lib/ga-event';
import OshiCardVariantToggle, { oshiCardVariantLabel } from './OshiCardVariantToggle';
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
    if (!selection || submitting) return;
    sendGaEvent('oshi_card_generate', { variant, phrase, work_count: selected.length, ...(isTcg ? { tcg_color: tcg.color ?? 'default', tcg_custom_name: !!tcg.name } : {}), ...oshiCardShareParams() });
    setSubmitting(true);
    router.push(buildOshiCardResultPath(selection));
  };

  return (
    <div className="oc-editor">
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
            <div className="oc-preview" data-shape={isTcg ? 'tcg' : 'feed'}>
              {shownPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewError && goodPreview ? goodPreview : shownPreview}
                  alt={`${person.name}の布教カード（${oshiCardVariantLabel(variant)}）のプレビュー`}
                  width={previewSize.width}
                  height={previewSize.height}
                  className={`oc-preview-image${previewLoading ? ' is-loading' : ''}`}
                  onLoad={(e) => { setPreviewLoading(false); if (!previewError) setGoodPreview(e.currentTarget.currentSrc || shownPreview); }}
                  onError={() => { setPreviewLoading(false); setPreviewError(true); }}
                />
              ) : (
                <div className="oc-preview-image oc-preview-empty"><span>作品を選ぶとプレビューが表示されます</span></div>
              )}
            </div>
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
