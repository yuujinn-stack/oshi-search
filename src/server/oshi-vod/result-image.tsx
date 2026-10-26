// 推しに合うサブスク診断の結果画像テンプレート（next/og = Satori 用）。
// - サイズは3種類：feed（1080×1350・投稿用）、story（1080×1920・ストーリーズ用）、
//   og（1200×630・結果URLを X・LINE に貼ったときのカード画像）。
// - デザインは2系統で、色違いではなくレイアウト・タイポ・装飾の考え方から分けている。
//   cool（かっこいい）＝雑誌の特集ページ・ブランド広告のような Editorial Premium。アイボリーの紙面に濃いチャコール、
//                       黄色は蛍光ペンとして重要箇所だけ、黒は CTA の帯だけ。左揃えの文字組み・余白・罫線で階層を作る。
//   cute（可愛い）  ＝推し活の投稿素材のような sticker。シール風のタグ・カード・装飾で「見た瞬間にかわいい」を作る。
//   載せる情報（診断名・推し名・作品数1位・作品数・カバー率・料金・根拠・2サービス・CTA・推しサーチ名・URL）と数値は両系統で同じ。
// - スマホのタイムラインでは画像が約1/3に縮むため、主要な文字は縮小後も読める大きさにする。
// - OG は LINE が中央の正方形（x=285〜915）に切り抜いて表示することがあるため、文字はすべて中央の幅600px（x=300〜900）に置く。
// - 人物写真・他社ロゴは使わない。サービスは既存のCTA配色（VOD_SERVICE_STYLE）の色だけを使い、
//   配色が登録されていないサービス（のぎ動画など）は色を推測せず、デザイン側の色で描く。装飾は図形・SVGだけ（外部素材なし）。
// - Satori の制約: 子要素を2つ以上持つ div には display:flex が必須。✦ など一部の記号はフォントに無いため使わない（♡・★ は可）。
// - 部品（アイコン・装飾・紙面・シール等）は推し布教カード（src/server/oshi-card/card-image.tsx）でも使うため export している。
import 'server-only';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { VOD_SERVICE_STYLE } from '@/lib/vod-cta';
import { normalizeProviderName } from '@/lib/vod-dedup';
import { OSHI_VOD_IMAGE_SIZES, type OshiVodImageSize } from '@/lib/oshi-vod/params';
import { OSHI_VOD_DEFAULT_SHARE_VARIANT, type OshiVodShareVariant } from '@/lib/oshi-vod/share-variant';
import type { OshiVodImageData, OshiVodImageService } from '@/lib/oshi-vod/image-data';

export const OSHI_VOD_IMAGE_FONT_FAMILY = 'Noto Sans JP';

/** 推しサーチの正式アイコン（public/oshi-search-yellow-final.png）の黄色・紺 */
export const BRAND_YELLOW = '#FEE34F';
export const BRAND_NAVY = '#112A5A';

export const OSHI_VOD_IMAGE_TEXT = {
  title: '推しに合うサブスク診断',
  titleLines: ['推しに合う', 'サブスク診断'],
  nameLabel: 'わたしの推し',
  cta: 'あなたの推しでも調べてみて →',
  url: 'oshi-search.jp/oshi-vod',
  disclaimer: '配信状況・料金は変更される場合があります。最新情報は各公式サイトでご確認ください。',
} as const;

// ─── 共通の小物 ──────────────────────────────────────────────────────────────

/** 文字幅の目安（全角＝1、半角＝0.6）。長いサービス名でもはみ出さない文字サイズを決めるのに使う */
export function textUnits(text: string): number {
  let u = 0;
  for (const ch of text) u += ch.charCodeAt(0) < 0x2000 ? 0.6 : 1;
  return u;
}

export function fitFont(text: string, maxWidth: number, maxFont: number, minFont = 24): number {
  return Math.max(minFont, Math.min(maxFont, Math.floor(maxWidth / Math.max(textUnits(text), 1))));
}

function rankLabel(data: OshiVodImageData): string {
  return data.top?.tied ? '推しの作品数 同率1位' : '推しの作品数 1位';
}

function basisText(data: OshiVodImageData): string {
  return `有料サブスクで見放題の推し作品 ${data.paidTotal}作品で比較`;
}

function pairText(data: OshiVodImageData): string | null {
  if (!data.pair) return null;
  return `${data.pair.services.map((s) => s.displayName).join(' ＋ ')} ${data.pair.unionCount}作品（${data.pair.coverage}）`;
}

/** 登録済みのブランド配色（無ければ null＝色を推測しない） */
function brandFill(service: string): { fill: CSSProperties; color: string; border?: string } | null {
  const s = VOD_SERVICE_STYLE[normalizeProviderName(service)];
  if (!s) return null;
  const fill: CSSProperties = s.background.startsWith('linear-gradient') ? { backgroundImage: s.background } : { backgroundColor: s.background };
  return { fill, color: s.color, border: s.border };
}

/** 推しサーチのアイコン（黄色地に紺の「推」）を図形で描く（画像ファイルを読み込まない） */
export function BrandMark({ size, radius }: { size: number; radius: number }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: radius,
        backgroundColor: BRAND_YELLOW, color: BRAND_NAVY, fontSize: Math.round(size * 0.62), fontWeight: 700,
      }}
    >
      推
    </div>
  );
}

export function Abs({ style, children }: { style: CSSProperties; children?: ReactNode }) {
  return <div style={{ position: 'absolute', display: 'flex', ...style }}>{children}</div>;
}

export function Sparkle({ size, color, style }: { size: number; color: string; style: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', ...style }}>
      <path d="M12 0 C13 7.5 16.5 11 24 12 C16.5 13 13 16.5 12 24 C11 16.5 7.5 13 0 12 C7.5 11 11 7.5 12 0 Z" fill={color} />
    </svg>
  );
}

export function Star({ size, color, stroke, style }: { size: number; color: string; stroke?: string; style: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', ...style }}>
      <path
        d="M12 1.5 L14.9 8.3 L22.3 8.9 L16.7 13.8 L18.4 21 L12 17.2 L5.6 21 L7.3 13.8 L1.7 8.9 L9.1 8.3 Z"
        fill={color} stroke={stroke ?? 'none'} strokeWidth={stroke ? 1.6 : 0} strokeLinejoin="round"
      />
    </svg>
  );
}

export function Heart({ size, color, style }: { size: number; color: string; style: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', ...style }}>
      <path d="M12 21 C5 15.5 1.5 12 1.5 7.8 C1.5 4.6 4 2.5 6.8 2.5 C9 2.5 10.8 3.8 12 5.6 C13.2 3.8 15 2.5 17.2 2.5 C20 2.5 22.5 4.6 22.5 7.8 C22.5 12 19 15.5 12 21 Z" fill={color} />
    </svg>
  );
}

export function Dot({ size, color, style }: { size: number; color: string; style: CSSProperties }) {
  return <Abs style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, ...style }} />;
}

/**
 * 縦並びの本文の列。Satori は収まらない子要素を黙って縮める（テープ等が潰れる）ため、
 * 各ブロックを縮めず、余白だけを flex の伸び縮みで調整する（Spacer）。
 */
export function Column({ padding, center = false, children }: { padding: string; center?: boolean; children: ReactNode }) {
  const kids = (Array.isArray(children) ? children : [children]).flat().filter(Boolean) as ReactElement[];
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'stretch', width: '100%', height: '100%', padding }}>
      {kids.map((c, i) => {
        // 余白（Spacer）と、伸びて余白を埋めるブロック（style.flex = 1）はそのまま。それ以外は縮めない
        const grows = c.type === Spacer || (c.props as { style?: CSSProperties }).style?.flex === 1;
        return grows ? c : <div key={i} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, alignItems: center ? 'center' : 'stretch' }}>{c}</div>;
      })}
    </div>
  );
}

export function Spacer({ min = 0 }: { min?: number }) {
  return <div style={{ display: 'flex', flex: 1, minHeight: min }} />;
}

export function Canvas({ size, background, children }: { size: OshiVodImageSize; background: CSSProperties; children: ReactNode }) {
  const { width, height } = OSHI_VOD_IMAGE_SIZES[size];
  return (
    <div style={{ width, height, display: 'flex', position: 'relative', fontFamily: OSHI_VOD_IMAGE_FONT_FAMILY, ...background }}>
      {children}
    </div>
  );
}

// ─── cool（かっこいい）：Editorial Premium ─────────────────────────────────────
// 雑誌の特集ページ・ブランド広告のような編集デザイン。アイボリーの紙面に濃いチャコールの文字、黄色は蛍光ペンの線として
// 重要な箇所だけに使い、黒は下部の CTA の帯だけに絞る。装飾ではなく、左揃えの文字組み・余白・罫線・グルーピングで階層を作る。
// 目に入る順：タイトル → サービス名 → 作品数（/ 総数）→ カバー率 → 推し名 → 月額・補足 → CTA。

export const COOL = {
  paper: '#F5F2EA',
  ink: '#1E1F24',
  body: '#3A3B42',
  muted: '#6E6F76',
  rule: '#1E1F24',
  hair: '#D8D3C7',
  navy: BRAND_NAVY,
  accent: BRAND_YELLOW,
};
export const COOL_BG: CSSProperties = { backgroundColor: COOL.paper };

/** 黄色の蛍光ペン（文字の下半分に敷く） */
export const coolMarker = (from = 58): CSSProperties => ({ backgroundImage: `linear-gradient(180deg, rgba(254,227,79,0) ${from}%, ${COOL.accent} ${from}%)` });

export function CoolLabel({ fontSize, color = COOL.muted, spacing = 3, children }: { fontSize: number; color?: string; spacing?: number; children: ReactNode }) {
  return <div style={{ display: 'flex', fontSize, fontWeight: 700, letterSpacing: spacing, color }}>{children}</div>;
}

/** セクションの見出し：黄色の小さな四角＋小さな文字（雑誌の小見出し） */
export function CoolKicker({ fontSize, children }: { fontSize: number; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.5) }}>
      <div style={{ display: 'flex', width: Math.round(fontSize * 0.62), height: Math.round(fontSize * 0.62), backgroundColor: COOL.accent, border: `2px solid ${COOL.ink}` }} />
      <CoolLabel fontSize={fontSize} color={COOL.ink} spacing={2}>{children}</CoolLabel>
    </div>
  );
}

/** サービス名：左にブランド色の縦線（配色未登録は黄色）＋大きな文字。ロゴは模倣しない */
function CoolWordmark({ svc, fontSize }: { svc: OshiVodImageService; fontSize: number }) {
  const b = brandFill(svc.service);
  const bar: CSSProperties = b ? { ...b.fill, border: b.border ?? 'none' } : { backgroundColor: COOL.accent, border: `2px solid ${COOL.ink}` };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.2) }}>
      <div style={{ display: 'flex', width: Math.max(8, Math.round(fontSize * 0.1)), height: Math.round(fontSize * 0.9), ...bar }} />
      <div style={{ display: 'flex', fontSize, fontWeight: 700, lineHeight: 1.05, letterSpacing: Math.round(-fontSize * 0.02), color: COOL.ink }}>{svc.displayName}</div>
    </div>
  );
}

/** 推し名：「FOR 目黒蓮 ／ 梅澤美波 ／ 成田凌」のクレジット表記 */
function CoolNames({ names, max, fontSize }: { names: string[]; max: number; fontSize: number }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const items: ReactElement[] = [];
  shown.forEach((n, i) => {
    if (i > 0) items.push(<div key={`s${i}`} style={{ display: 'flex', color: COOL.muted, fontSize: Math.round(fontSize * 0.85) }}>／</div>);
    items.push(<div key={n} style={{ display: 'flex', color: COOL.ink }}>{n}</div>);
  });
  if (rest > 0) items.push(<div key="rest" style={{ display: 'flex', color: COOL.muted, fontSize: Math.round(fontSize * 0.85) }}>{`ほか${rest}人`}</div>);
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: Math.round(fontSize * 0.6), width: '100%' }}>
      <CoolLabel fontSize={Math.round(fontSize * 0.62)} color={COOL.ink} spacing={4}>FOR</CoolLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: Math.round(fontSize * 0.34), rowGap: 4, flex: 1, fontSize, fontWeight: 700 }}>
        {items}
      </div>
    </div>
  );
}

/** 推し名を1行に収められる人数（残りは「ほかN人」）。最初の1人も入らなければ文字を小さくする */
function fitNamesOneLine(names: string[], maxWidth: number, fontSize: number, minFont: number): { max: number; fontSize: number } {
  const sep = 1.2;
  const restWidth = (n: number) => (n > 0 ? (3 + String(n).length * 0.6) * 0.85 + 0.4 : 0);
  let font = fontSize;
  for (;;) {
    let used = 1.6; // FOR と余白
    let count = 0;
    for (const n of names) {
      const w = textUnits(n) + (count > 0 ? sep : 0);
      if ((used + w + restWidth(names.length - count - 1)) * font > maxWidth) break;
      used += w;
      count++;
    }
    if (count > 0 || font <= minFont) return { max: Math.max(1, count), fontSize: font };
    font -= 2;
  }
}

/**
 * 作品数とカバー率：ラベルを数字の真上に置き、「43 / 86作品」を1行で読ませる。
 * カバー率の文字サイズは、作品数側の幅を見積もった残り（totalWidth から）に収まる大きさにする。
 */
function CoolFigures({ data, count, unit, coverage, label, gap, totalWidth }: { data: OshiVodImageData; count: number; unit: number; coverage: number; label: number; gap: number; totalWidth: number }) {
  const top = data.top!;
  const unitText = `/ ${data.paidTotal}作品`;
  // 実際の字幅（Noto Sans JP Bold）に近い目安：数字 0.55・小数点 0.3・% 0.85・スラッシュと空白 0.4・全角 1
  const em = (t: string) => [...t].reduce((u, ch) => u + (/[0-9]/.test(ch) ? 0.55 : ch === '.' ? 0.3 : ch === '%' ? 0.85 : ch.charCodeAt(0) < 0x2000 ? 0.4 : 1), 0);
  const countWidth = Math.max(em(`${top.paidCount}`) * count * 0.96 + count * 0.08 + em(unitText) * unit + unit * 0.3, 10 * label);
  const covFont = Math.max(30, Math.min(coverage, Math.floor((totalWidth - countWidth - gap * 2 - 16) / em(top.coverage))));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'column', paddingRight: gap }}>
        <CoolLabel fontSize={label} spacing={1} color={COOL.body}>見放題で見られる作品</CoolLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', marginTop: Math.round(label * 0.3) }}>
          <div style={{ display: 'flex', fontSize: count, fontWeight: 700, lineHeight: 1, letterSpacing: Math.round(-count * 0.04), color: COOL.ink, padding: `0 ${Math.round(count * 0.04)}px`, ...coolMarker(62) }}>{`${top.paidCount}`}</div>
          <div style={{ display: 'flex', fontSize: unit, fontWeight: 700, color: COOL.ink, marginLeft: Math.round(unit * 0.3) }}>{unitText}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: gap, borderLeft: `2px solid ${COOL.hair}` }}>
        <CoolLabel fontSize={label} spacing={1} color={COOL.body}>カバー率</CoolLabel>
        <div style={{ display: 'flex', marginTop: Math.round(label * 0.3), fontSize: covFont, fontWeight: 700, lineHeight: 1, letterSpacing: Math.round(-covFont * 0.03), color: COOL.navy }}>{top.coverage}</div>
      </div>
    </div>
  );
}

/**
 * 月額と2サービス：数字のすぐ下に置く。月額は料金の文字列（「月額2,189円（税込）」「WEB月額1,320円（税込）」）を
 * そのまま大きめに、2サービスは1段弱く。ラベル列の表にはしない（縮小表示で小さな文字が増えるため）。
 */
function CoolSupplement({ data, price, pair }: { data: OshiVodImageData; price: number; pair: number }) {
  const pairLine = pairText(data);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: Math.round(pair * 0.4) }}>
      {data.top?.price && <div style={{ display: 'flex', fontSize: price, fontWeight: 700, color: COOL.ink }}>{data.top.price}</div>}
      {pairLine && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: Math.round(pair * 0.45), fontSize: pair, fontWeight: 700, color: COOL.body }}>
          <div style={{ display: 'flex', color: COOL.muted }}>2サービスなら</div>
          <div style={{ display: 'flex' }}>{pairLine}</div>
        </div>
      )}
    </div>
  );
}

/** CTA：濃いチャコールの角ばった帯（黒はここだけ）。文字は白、矢印は黄色 */
function CoolCta({ fontSize, padY }: { fontSize: number; padY: number }) {
  const text = OSHI_VOD_IMAGE_TEXT.cta.replace(/\s*→$/, '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: `${padY}px ${Math.round(fontSize * 0.8)}px`, backgroundColor: COOL.ink }}>
      <div style={{ display: 'flex', fontSize, fontWeight: 700, color: '#FFFFFF' }}>{text}</div>
      <div style={{ display: 'flex', fontSize: Math.round(fontSize * 1.1), fontWeight: 700, color: COOL.accent }}>→</div>
    </div>
  );
}

/** 上部のマストヘッド：推しサーチ名と、右に小さな文字（診断の種類や URL）、下に太い罫線 */
function CoolMasthead({ fontSize, mark, right }: { fontSize: number; mark: number; right: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: Math.round(fontSize * 0.55), borderBottom: `3px solid ${COOL.rule}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.45) }}>
        <BrandMark size={mark} radius={Math.round(mark * 0.12)} />
        <div style={{ display: 'flex', fontSize: Math.round(fontSize * 1.15), fontWeight: 700, color: COOL.ink }}>推しサーチ</div>
      </div>
      {right}
    </div>
  );
}

function buildCoolPortrait(data: OshiVodImageData, size: 'feed' | 'story'): ReactElement {
  const story = size === 'story';
  const k = story ? 1.16 : 1;
  const r = (n: number) => Math.round(n * k);
  const top = data.top;
  const width = 1080 - (story ? 176 : 152);
  const nameFont = data.personNames.length <= 3 ? r(40) : data.personNames.length <= 6 ? r(34) : r(30);
  return (
    <Canvas size={size} background={COOL_BG}>
      <Column padding={story ? '104px 88px 92px' : '58px 76px 44px'}>
        <CoolMasthead fontSize={r(24)} mark={r(40)} right={<CoolLabel fontSize={r(19)} spacing={4}>SUBSCRIPTION DIAGNOSIS</CoolLabel>} />

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: r(26) }}>
          <div style={{ display: 'flex', fontSize: r(98), fontWeight: 700, lineHeight: 1.08, letterSpacing: -4, color: COOL.ink }}>{OSHI_VOD_IMAGE_TEXT.titleLines[0]}</div>
          <div style={{ display: 'flex' }}>
            <div style={{ display: 'flex', fontSize: r(98), fontWeight: 700, lineHeight: 1.08, letterSpacing: -4, color: COOL.ink, ...coolMarker(64) }}>{OSHI_VOD_IMAGE_TEXT.titleLines[1]}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: r(22) }}>
          <CoolNames names={data.personNames} max={8} fontSize={nameFont} />
        </div>

        {story ? <Spacer /> : <div style={{ display: 'flex', height: 30 }} />}

        <CoolKicker fontSize={r(30)}>{`No.1　${rankLabel(data)}`}</CoolKicker>
        {top ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: r(40), rowGap: r(8), marginTop: r(16) }}>
              {top.services.map((s) => (
                <CoolWordmark key={s.service} svc={s} fontSize={fitFont(s.displayName, top.services.length > 1 ? (width - 90) / 2 : width - 50, top.services.length > 1 ? r(78) : r(108), 40)} />
              ))}
            </div>
            <div style={{ display: 'flex', marginTop: r(28) }}>
              {/* 3桁のときは作品数を少し小さくして、カバー率の大きさを確保する */}
              <CoolFigures data={data} count={top.paidCount >= 100 ? (story ? 168 : 156) : r(168)} unit={r(46)} coverage={r(120)} label={r(34)} gap={r(34)} totalWidth={width} />
            </div>
            <div style={{ display: 'flex', marginTop: r(22) }}>
              <CoolSupplement data={data} price={r(40)} pair={r(31)} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: r(16), fontSize: r(40), fontWeight: 700, color: COOL.body }}>有料サブスクで見放題の作品は確認できませんでした</div>
        )}

        <Spacer min={24} />
        <CoolCta fontSize={r(40)} padY={r(24)} />
        <div style={{ display: 'flex', marginTop: r(14), fontSize: r(30), fontWeight: 700, color: COOL.ink, letterSpacing: 1 }}>{OSHI_VOD_IMAGE_TEXT.url}</div>
        {/* 比較の対象と注意書きは、保存して読むための小さな注記にまとめる */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: r(10), gap: 2 }}>
          <div style={{ display: 'flex', fontSize: 21, color: COOL.muted }}>{`※${basisText(data)}`}</div>
          <div style={{ display: 'flex', fontSize: 21, color: COOL.muted }}>{OSHI_VOD_IMAGE_TEXT.disclaimer}</div>
        </div>
      </Column>
    </Canvas>
  );
}

/**
 * X・LINE のカード（1200×630）。カードは約3/10に縮小されるため、情報を絞って大きくする：
 * マストヘッド（推しサーチ名・URL）→ タイトル → 推し名 → No.1 → サービス名 → 作品数・カバー率 → 月額 → CTA。
 * 根拠・2サービス・注意書きはリンク先のページで見られるため OG には載せない。
 */
function buildCoolOg(data: OshiVodImageData): ReactElement {
  const top = data.top;
  return (
    <Canvas size="og" background={COOL_BG}>
      {/* 左右の余白：文字を含まない紙面の罫線だけ（中央の正方形の外） */}
      <Abs style={{ top: 0, left: 0, width: 1200, height: 10, backgroundColor: COOL.accent }} />
      <Abs style={{ top: 64, left: 196, width: 2, height: 502, backgroundColor: COOL.hair }} />
      <Abs style={{ top: 64, right: 196, width: 2, height: 502, backgroundColor: COOL.hair }} />

      <Column padding="26px 300px 22px">
        <CoolMasthead fontSize={22} mark={30} right={<div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: COOL.body }}>{OSHI_VOD_IMAGE_TEXT.url}</div>} />
        <div style={{ display: 'flex', marginTop: 12 }}>
          <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, lineHeight: 1.12, letterSpacing: -2, color: COOL.ink, ...coolMarker(66) }}>{OSHI_VOD_IMAGE_TEXT.title}</div>
        </div>
        {/* 推し名は1行に収める（2行になると CTA が画像からはみ出す）。入らない人は「ほかN人」 */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
          <CoolNames names={data.personNames} {...fitNamesOneLine(data.personNames, 590, 34, 26)} />
        </div>
        <Spacer min={8} />
        <CoolKicker fontSize={24}>{`No.1　${rankLabel(data)}`}</CoolKicker>
        {top ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 26, rowGap: 2, marginTop: 6 }}>
              {top.services.map((s) => (
                <CoolWordmark key={s.service} svc={s} fontSize={fitFont(s.displayName, top.services.length > 1 ? 270 : 570, top.services.length > 1 ? 52 : 74, 28)} />
              ))}
            </div>
            <div style={{ display: 'flex', marginTop: 10 }}>
              <CoolFigures data={data} count={108} unit={30} coverage={86} label={26} gap={24} totalWidth={600} />
            </div>
            {top.price && <div style={{ display: 'flex', marginTop: 8, fontSize: 30, fontWeight: 700, color: COOL.ink }}>{top.price}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 10, fontSize: 30, fontWeight: 700, color: COOL.body }}>有料サブスクで見放題の作品は確認できませんでした</div>
        )}
        <Spacer min={8} />
        <CoolCta fontSize={30} padY={12} />
      </Column>
    </Canvas>
  );
}

// ─── cute（可愛い）：sticker ───────────────────────────────────────────────────

export const CUTE = {
  ink: '#1A2147',
  body: '#3B4062',
  muted: '#62677F',
  yellow: BRAND_YELLOW,
  pink: '#FF8FB1',
  pinkSoft: '#FFD3E0',
  mint: '#BDEBDD',
  cream: '#FFF8DC',
  white: '#FFFFFF',
};
export const CUTE_BG: CSSProperties = { backgroundColor: '#FFF2B8', backgroundImage: 'linear-gradient(165deg, #FFEC9A 0%, #FFF6CF 42%, #FFE3EC 100%)' };
const CUTE_TAG_COLORS = [CUTE.white, CUTE.yellow, CUTE.pinkSoft, CUTE.mint];
const CUTE_TILTS = [-2.5, 1.8, -1.2, 2.4, -1.8, 1.2, -2.2, 1.6];

/** 背景の水玉（Satori は繰り返し背景を描けないため、丸を並べて描く） */
export function CuteDots({ width, height, gap, size, color }: { width: number; height: number; gap: number; size: number; color: string }) {
  const dots: ReactElement[] = [];
  for (let y = gap / 2, row = 0; y < height; y += gap, row++) {
    for (let x = (row % 2 ? gap : gap / 2); x < width; x += gap) {
      dots.push(<Dot key={`${x}-${y}`} size={size} color={color} style={{ left: x, top: y }} />);
    }
  }
  return <Abs style={{ top: 0, left: 0, width, height }}>{dots}</Abs>;
}

/** シール風：白・紺のふち・ずらした影 */
export function sticker(bg: string, radius: number, shadow = CUTE.ink, border = 4, offset = 6): CSSProperties {
  return { backgroundColor: bg, border: `${border}px solid ${CUTE.ink}`, borderRadius: radius, boxShadow: `${offset}px ${offset}px 0 ${shadow}` };
}

export function CuteTape({ fontSize, children, rotate = -3 }: { fontSize: number; children: ReactNode; rotate?: number }) {
  return (
    // 回転した要素は背景の高さが文字に追従しないことがあるため、高さを固定する
    <div style={{ display: 'flex', alignSelf: 'flex-start', alignItems: 'center', height: Math.round(fontSize * 1.9), padding: `0 ${Math.round(fontSize * 0.8)}px`, backgroundColor: CUTE.pink, color: CUTE.white, fontSize, lineHeight: 1, fontWeight: 700, letterSpacing: 4, transform: `rotate(${rotate}deg)` }}>
      {children}
    </div>
  );
}

/** タイトルのシール。twoLines は「推しに合う／サブスク診断」の2行（ストーリーズで大きく見せる） */
function CuteTitle({ fontSize, twoLines = false }: { fontSize: number; twoLines?: boolean }) {
  const lines = twoLines ? OSHI_VOD_IMAGE_TEXT.titleLines : [OSHI_VOD_IMAGE_TEXT.title];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', padding: `${Math.round(fontSize * 0.16)}px ${Math.round(fontSize * 0.36)}px`, ...sticker(CUTE.white, Math.round(fontSize * 0.34), CUTE.pink, 4, Math.round(fontSize * 0.1)), color: CUTE.ink, fontSize, fontWeight: 700, lineHeight: 1.2, transform: 'rotate(-1.5deg)' }}>
      {lines.map((l) => <div key={l} style={{ display: 'flex' }}>{l}</div>)}
    </div>
  );
}

function CuteNameLabel({ fontSize }: { fontSize: number }) {
  return (
    <div style={{ display: 'flex', alignSelf: 'flex-start', padding: `${Math.round(fontSize * 0.2)}px ${Math.round(fontSize * 0.7)}px`, backgroundColor: CUTE.ink, color: CUTE.white, borderRadius: 999, fontSize, fontWeight: 700, letterSpacing: 2, transform: 'rotate(1.5deg)' }}>
      {`♡ ${OSHI_VOD_IMAGE_TEXT.nameLabel} ♡`}
    </div>
  );
}

function CuteNames({ names, max, fonts, center = false }: { names: string[]; max: number; fonts: [number, number, number]; center?: boolean }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const fontSize = names.length <= 3 ? fonts[0] : names.length <= 6 ? fonts[1] : fonts[2];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: Math.round(fontSize * 0.42), justifyContent: center ? 'center' : 'flex-start', paddingRight: 8 }}>
      {shown.map((n, i) => (
        <div
          key={n}
          style={{
            display: 'flex', padding: `${Math.round(fontSize * 0.16)}px ${Math.round(fontSize * 0.5)}px`, fontSize, fontWeight: 700, lineHeight: 1.25, color: CUTE.ink,
            ...sticker(CUTE_TAG_COLORS[i % CUTE_TAG_COLORS.length], 999, CUTE.ink, Math.max(3, Math.round(fontSize * 0.08)), Math.max(3, Math.round(fontSize * 0.1))),
            transform: `rotate(${CUTE_TILTS[i % CUTE_TILTS.length]}deg)`,
          }}
        >
          {n}
        </div>
      ))}
      {rest > 0 && <div style={{ display: 'flex', alignItems: 'center', fontSize, fontWeight: 700, color: CUTE.body }}>{`ほか${rest}人`}</div>}
    </div>
  );
}

/** 1位のロゼット（丸いシール） */
function CuteRosette({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: size, height: size, ...sticker(CUTE.yellow, size / 2, CUTE.pink, Math.max(3, Math.round(size * 0.04)), Math.round(size * 0.06)), color: CUTE.ink, fontSize: Math.round(size * 0.3), fontWeight: 700, transform: 'rotate(-8deg)' }}>
      No.1
    </div>
  );
}

function CuteServicePill({ svc, fontSize }: { svc: OshiVodImageService; fontSize: number }) {
  const b = brandFill(svc.service);
  const style: CSSProperties = b
    ? { ...b.fill, color: b.color, border: `4px solid ${CUTE.ink}` }
    : { backgroundColor: CUTE.ink, color: CUTE.white, border: `4px solid ${CUTE.ink}` };
  return (
    <div style={{ display: 'flex', alignSelf: 'flex-start', padding: `${Math.round(fontSize * 0.14)}px ${Math.round(fontSize * 0.45)}px`, borderRadius: 999, fontSize, fontWeight: 700, lineHeight: 1.2, ...style }}>
      {svc.displayName}
    </div>
  );
}

/** カバー率の丸シール（カードの角からはみ出させる） */
function CuteCoverage({ coverage, size, style }: { coverage: string; size: number; style: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: size, height: size, ...sticker(CUTE.pink, size / 2, CUTE.ink, Math.max(3, Math.round(size * 0.025)), Math.round(size * 0.04)), color: CUTE.ink, transform: 'rotate(9deg)', ...style }}>
      <div style={{ display: 'flex', fontSize: Math.round(size * 0.13), fontWeight: 700 }}>カバー率</div>
      <div style={{ display: 'flex', fontSize: Math.round(size * (coverage.length > 4 ? 0.24 : 0.28)), fontWeight: 700, lineHeight: 1.05 }}>{coverage}</div>
    </div>
  );
}

function CuteCta({ fontSize }: { fontSize: number }) {
  return (
    <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', padding: `${Math.round(fontSize * 0.55)}px ${Math.round(fontSize * 1)}px`, ...sticker(CUTE.ink, 999, CUTE.pink, 4, Math.round(fontSize * 0.2)), color: CUTE.white, fontSize, fontWeight: 700 }}>
      {OSHI_VOD_IMAGE_TEXT.cta}
    </div>
  );
}

function CuteBrand({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(14 * scale) }}>
      <BrandMark size={Math.round(56 * scale)} radius={Math.round(16 * scale)} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: Math.round(34 * scale), fontWeight: 700, lineHeight: 1.2, color: CUTE.ink }}>推しサーチ</div>
        <div style={{ display: 'flex', fontSize: Math.round(24 * scale), fontWeight: 700, color: CUTE.body }}>{OSHI_VOD_IMAGE_TEXT.url}</div>
      </div>
    </div>
  );
}

function CuteDecorations({ size }: { size: 'feed' | 'story' }) {
  const story = size === 'story';
  return (
    <Abs style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
      <Sparkle size={78} color={CUTE.white} style={{ top: story ? 70 : 36, right: 64 }} />
      <Star size={40} color={CUTE.pink} stroke={CUTE.ink} style={{ top: story ? 190 : 150, right: 22 }} />
      <Heart size={34} color={CUTE.pink} style={{ top: story ? 60 : 30, right: 200 }} />
      <Sparkle size={44} color={CUTE.yellow} style={{ top: story ? 520 : 360, left: 22 }} />
      <Star size={34} color={CUTE.yellow} stroke={CUTE.ink} style={{ bottom: story ? 360 : 250, right: 36 }} />
      <Sparkle size={56} color={CUTE.white} style={{ bottom: story ? 430 : 300, right: 90 }} />
      <Heart size={28} color={CUTE.pink} style={{ bottom: story ? 250 : 180, left: 34 }} />
      {story && <Star size={46} color={CUTE.pink} stroke={CUTE.ink} style={{ top: 820, left: 30 }} />}
      {story && <Sparkle size={40} color={CUTE.white} style={{ top: 760, right: 40 }} />}
    </Abs>
  );
}

function buildCutePortrait(data: OshiVodImageData, size: 'feed' | 'story'): ReactElement {
  const story = size === 'story';
  const k = story ? 1.14 : 1;
  const r = (n: number) => Math.round(n * k);
  const { width, height } = OSHI_VOD_IMAGE_SIZES[size];
  const top = data.top;
  const pair = pairText(data);
  const contentWidth = width - (story ? 152 : 128);
  const covSize = r(196);
  return (
    <Canvas size={size} background={CUTE_BG}>
      <CuteDots width={width} height={height} gap={58} size={8} color="rgba(255,143,177,0.30)" />
      <CuteDecorations size={size} />

      <Column padding={story ? '104px 76px 86px' : '52px 64px 44px'}>
        <CuteTape fontSize={r(20)}>OSHI SEARCH ★ DIAGNOSIS</CuteTape>
        <div style={{ display: 'flex', marginTop: r(24) }}>{story ? <CuteTitle fontSize={112} twoLines /> : <CuteTitle fontSize={70} />}</div>

        {story ? <Spacer /> : <div style={{ display: 'flex', height: 26 }} />}

        <div style={{ display: 'flex', flexDirection: 'column', gap: r(18) }}>
          <CuteNameLabel fontSize={r(26)} />
          <CuteNames names={data.personNames} max={8} fonts={[r(42), r(34), r(29)]} />
        </div>

        <div style={{ display: 'flex', height: r(32) }} />

        {/* 結果カード：投稿素材のようなチケット型。上にピンクの帯、右上にカバー率の丸シール */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', marginRight: r(22), ...sticker(CUTE.white, r(40), CUTE.ink, 4, r(12)) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${r(12)}px ${r(30)}px`, backgroundColor: CUTE.pink, borderRadius: `${r(36)}px ${r(36)}px 0 0`, borderBottom: `4px solid ${CUTE.ink}` }}>
            <div style={{ display: 'flex', fontSize: r(22), fontWeight: 700, letterSpacing: 5, color: CUTE.white }}>MY OSHI SUBSCRIPTION ★</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: story ? '36px 40px 40px' : '24px 32px 26px' }}>
            {top ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: r(20), paddingRight: covSize * 0.55 }}>
                  <CuteRosette size={r(104)} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: r(10), flex: 1 }}>
                    <div style={{ display: 'flex', fontSize: r(26), fontWeight: 700, color: CUTE.body }}>{rankLabel(data)}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {top.services.map((s) => (
                        <CuteServicePill key={s.service} svc={s} fontSize={fitFont(s.displayName, contentWidth - r(440), top.services.length > 1 ? r(48) : r(66), 28)} />
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: r(16) }}>
                  <div style={{ display: 'flex', fontSize: r(136), fontWeight: 700, lineHeight: 1, letterSpacing: -4, color: CUTE.ink }}>{`${top.paidCount}`}</div>
                  <div style={{ display: 'flex', fontSize: r(42), fontWeight: 700, color: CUTE.ink }}>{`/ ${data.paidTotal}作品`}</div>
                  <div style={{ display: 'flex', fontSize: r(26), fontWeight: 700, color: CUTE.body, marginLeft: 6 }}>見放題！</div>
                </div>
                {top.price && (
                  <div style={{ display: 'flex', alignSelf: 'flex-start', marginTop: r(10), padding: `${r(4)}px ${r(18)}px`, backgroundColor: CUTE.cream, borderRadius: 999, fontSize: r(30), fontWeight: 700, color: CUTE.ink }}>{top.price}</div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', fontSize: r(26), fontWeight: 700, color: CUTE.body }}>{rankLabel(data)}</div>
                <div style={{ display: 'flex', fontSize: r(38), fontWeight: 700, color: CUTE.ink }}>有料サブスクで見放題の作品は確認できませんでした</div>
              </div>
            )}
          </div>
          {top && <CuteCoverage coverage={top.coverage} size={covSize} style={{ top: r(14), right: -r(30) }} />}
        </div>

        <div style={{ display: 'flex', height: r(28) }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: r(6), padding: `${r(12)}px ${r(24)}px`, marginRight: r(22), backgroundColor: 'rgba(255,255,255,0.78)', border: `3px dashed ${CUTE.ink}`, borderRadius: r(24) }}>
          <div style={{ display: 'flex', fontSize: r(28), fontWeight: 700, color: CUTE.body }}>{basisText(data)}</div>
          {pair && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: r(28), fontWeight: 700, color: CUTE.ink }}>
              <div style={{ display: 'flex', color: '#C2345A' }}>2サービスなら</div>
              <div style={{ display: 'flex' }}>{pair}</div>
            </div>
          )}
        </div>

        <Spacer />
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}><CuteCta fontSize={r(30)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: r(20) }}><CuteBrand scale={0.86} /></div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, fontSize: 20, color: CUTE.muted }}>{OSHI_VOD_IMAGE_TEXT.disclaimer}</div>
      </Column>
    </Canvas>
  );
}

function buildCuteOg(data: OshiVodImageData): ReactElement {
  const top = data.top;
  return (
    <Canvas size="og" background={CUTE_BG}>
      <CuteDots width={1200} height={630} gap={50} size={7} color="rgba(255,143,177,0.30)" />
      {/* 左右の余白：文字を含まない飾りだけ（中央の正方形の外） */}
      <Abs style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <Sparkle size={84} color={CUTE.white} style={{ top: 60, left: 110 }} />
        <Heart size={44} color={CUTE.pink} style={{ top: 200, left: 60 }} />
        <Star size={54} color={CUTE.yellow} stroke={CUTE.ink} style={{ top: 360, left: 150 }} />
        <Sparkle size={40} color={CUTE.pink} style={{ top: 490, left: 70 }} />
        <Star size={48} color={CUTE.pink} stroke={CUTE.ink} style={{ top: 70, right: 120 }} />
        <Sparkle size={70} color={CUTE.white} style={{ top: 250, right: 70 }} />
        <Heart size={40} color={CUTE.pink} style={{ top: 430, right: 160 }} />
        <Sparkle size={34} color={CUTE.yellow} style={{ top: 520, right: 70 }} />
      </Abs>

      <Column padding="26px 300px 24px" center>
        <CuteTape fontSize={14} rotate={-2}>OSHI SEARCH ★ DIAGNOSIS</CuteTape>
        <div style={{ display: 'flex', marginTop: 14 }}><CuteTitle fontSize={48} /></div>
        <div style={{ display: 'flex', marginTop: 18, width: 600, justifyContent: 'center' }}>
          <CuteNames names={data.personNames} max={3} fonts={[30, 27, 25]} center />
        </div>

        <Spacer />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: 572, marginRight: 28, ...sticker(CUTE.white, 26, CUTE.ink, 3, 7) }}>
          <div style={{ display: 'flex', padding: '5px 18px', backgroundColor: CUTE.pink, borderRadius: '23px 23px 0 0', borderBottom: `3px solid ${CUTE.ink}`, fontSize: 13, fontWeight: 700, letterSpacing: 4, color: CUTE.white }}>MY OSHI SUBSCRIPTION ★</div>
          {top ? (
            // 右側はカバー率の丸シールの分だけ空ける
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 92px 20px 20px' }}>
              <CuteRosette size={80} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: 200 }}>
                <div style={{ display: 'flex', fontSize: 16, fontWeight: 700, color: CUTE.body }}>{rankLabel(data)}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {top.services.map((s) => (
                    <CuteServicePill key={s.service} svc={s} fontSize={fitFont(s.displayName, 156, top.services.length > 1 ? 26 : 38, 18)} />
                  ))}
                </div>
                {top.price && <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, color: CUTE.body }}>{top.price}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: top.paidCount >= 100 ? 70 : 90, fontWeight: 700, lineHeight: 1, letterSpacing: -3, color: CUTE.ink }}>{`${top.paidCount}`}</div>
                <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: CUTE.ink }}>{`/ ${data.paidTotal}作品`}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 20px 16px' }}>
              <div style={{ display: 'flex', fontSize: 15, fontWeight: 700, color: CUTE.body }}>{rankLabel(data)}</div>
              <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: CUTE.ink }}>有料サブスクで見放題の作品は確認できませんでした</div>
            </div>
          )}
          {top && <CuteCoverage coverage={top.coverage} size={122} style={{ top: 26, right: -30 }} />}
        </div>

        <Spacer />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 600 }}>
          <CuteBrand scale={0.6} />
          <CuteCta fontSize={17} />
        </div>
      </Column>
    </Canvas>
  );
}

export function buildOshiVodImageElement(
  data: OshiVodImageData,
  size: OshiVodImageSize,
  variant: OshiVodShareVariant = OSHI_VOD_DEFAULT_SHARE_VARIANT,
): ReactElement {
  if (variant === 'cute') return size === 'og' ? buildCuteOg(data) : buildCutePortrait(data, size);
  return size === 'og' ? buildCoolOg(data) : buildCoolPortrait(data, size);
}
