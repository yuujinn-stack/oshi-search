'use client';

// 推し布教カードの作成画面：② おすすめ作品を1〜3件選ぶ → ③ 並べ替え → ④ デザイン → ⑤ ひとこと → プレビュー → 作成。
// 作品はその人物の公開作品（サーバーで作った候補）からだけ選べる。「おすすめ」は利用者の主観であることを画面にも明記する。
// プレビューは本番と同じ画像API（/api/oshi-card/image）で、選択を変えると少し待ってから更新する。
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
  type OshiCardPhraseId,
  type OshiCardSelection,
  type OshiCardVariant,
} from '@/lib/oshi-card/params';
import { oshiCardShareParams } from '@/lib/oshi-card/attribution';
import { sendGaEvent } from '@/lib/ga-event';
import OshiCardVariantToggle from './OshiCardVariantToggle';

interface Props {
  person: { name: string; group: string };
  candidates: OshiCardWork[];
  initial: { workIds: string[]; variant: OshiCardVariant; phrase: OshiCardPhraseId };
}

const PAGE_SIZE = 30;

export default function OshiCardEditor({ person, candidates, initial }: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const [selected, setSelected] = useState<string[]>(initial.workIds.filter((id) => byId.has(id)).slice(0, OSHI_CARD_MAX_WORKS));
  const [variant, setVariant] = useState<OshiCardVariant>(initial.variant);
  const [phrase, setPhrase] = useState<OshiCardPhraseId>(initial.phrase);
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

  const selection: OshiCardSelection | null = selected.length > 0 ? { person: person.name, workIds: selected, variant, phrase } : null;
  const previewPath = selection ? buildOshiCardImagePath(selection) : null;
  // 選択を変えるたびに画像を作り直さないよう、少し待ってから更新する
  const [shownPreview, setShownPreview] = useState<string | null>(previewPath);
  useEffect(() => {
    const t = setTimeout(() => setShownPreview(previewPath), 450);
    return () => clearTimeout(t);
  }, [previewPath]);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => { if (shownPreview) setPreviewLoading(true); }, [shownPreview]);

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
    sendGaEvent('oshi_card_generate', { variant, phrase, work_count: selected.length, ...oshiCardShareParams() });
    setSubmitting(true);
    router.push(buildOshiCardResultPath(selection));
  };

  if (candidates.length === 0) {
    return (
      <div className="oc-panel">
        <p className="oc-empty-title">{person.name}の出演作品は、まだ推しサーチに登録されていません。</p>
        <p className="oc-note">布教カードは、推しサーチに登録されている出演作品から作ります。作品が登録されたら作れるようになります。</p>
        <div className="oc-row-buttons">
          <Link href={`/person/${encodeURIComponent(person.name)}`} className="oc-btn-sub">{person.name}のページを見る</Link>
          <Link href={OSHI_CARD_PATH} className="oc-btn-sub">ほかの推しで作る</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="oc-editor">
      {/* ② 作品を選ぶ */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-works">
        <h2 id="oc-step-works" className="oc-step-title">おすすめしたい作品を選ぶ（1〜3作品）</h2>
        <p className="oc-note">あなたが好きな作品を選んでください。カードには「投稿者のおすすめ」として表示され、公式の順位にはなりません。</p>
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

      {/* ④ デザイン・⑤ ひとこと */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-design">
        <h2 id="oc-step-design" className="oc-step-title">デザインとひとことを選ぶ</h2>
        <OshiCardVariantToggle value={variant} onChange={chooseVariant} />
        <div className="oc-phrases" role="radiogroup" aria-label="カードのひとこと">
          {OSHI_CARD_PHRASES.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={phrase === p.id} className={`oc-phrase${phrase === p.id ? ' is-on' : ''}`} onClick={() => setPhrase(p.id)}>{p.text}</button>
          ))}
        </div>
      </section>

      {/* プレビュー・作成 */}
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-preview">
        <h2 id="oc-step-preview" className="oc-step-title">プレビュー</h2>
        <div className="oc-preview">
          {shownPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownPreview} alt={`${person.name}の布教カードのプレビュー`} width={1080} height={1350} className={`oc-preview-image${previewLoading ? ' is-loading' : ''}`} onLoad={() => setPreviewLoading(false)} onError={() => setPreviewLoading(false)} />
          ) : (
            <div className="oc-preview-image oc-preview-empty"><span>作品を選ぶとプレビューが表示されます</span></div>
          )}
        </div>
      </section>

      {/* 作成ボタンは作成画面全体の末尾に置き、作品を1つ選んだら画面下に固定する（作品を選びながら押せるように） */}
      <div className={`oc-submit${selection ? ' is-sticky' : ''}`}>
        <button type="button" className="oc-btn-main" disabled={!selection || submitting} onClick={submit}>
          {submitting ? 'カードを作っています…' : selection ? `このカードを作る（${selected.length}作品）` : 'このカードを作る'}
        </button>
        {!selection && <p className="oc-note" role="status">おすすめ作品を1つ以上選んでください</p>}
      </div>
    </div>
  );
}
