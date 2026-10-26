// 推し布教カードの画像テンプレート（next/og = Satori 用）。
// - サイズ：feed（1080×1350・投稿用）、story（1080×1920・ストーリーズ用）、og（1200×630・X・LINE のカード）。
// - デザインは2系統で、レイアウトから分ける（色違いにしない）。部品はサブスク診断の共有画像と共通
//   （src/server/oshi-vod/result-image.tsx の export）。
//   cool＝Editorial Premium：アイボリーの紙面・チャコール・黄色の蛍光ペン。推し名を大きな文字組みで、作品は 01・02・03 の番号付きの表。
//   cute＝Fan Sticker：クリームイエロー・ピンク・ネイビー。推し名は黄色いネームプレート、作品はチケット型のシール。
// - 載せる情報：ひとこと（定型フレーズ）・推し名・グループ・おすすめ作品1〜3件（分類・公開年）・推しサーチ名・URL・誘導・
//   「投稿者のおすすめで公式の順位ではない」注記（OG は縮小表示のため注記を省く）。
// - 人物写真・作品画像・他社ロゴは使わない。作品名が長い場合は行数を決めて「…」で切り詰める（レイアウトを崩さない）。
import 'server-only';
import type { ReactElement } from 'react';
import {
  Abs,
  BRAND_YELLOW,
  BrandMark,
  Canvas,
  COOL,
  COOL_BG,
  CoolLabel,
  CUTE,
  CUTE_BG,
  CuteDots,
  CuteTape,
  Column,
  Dot,
  Heart,
  Spacer,
  Sparkle,
  Star,
  coolMarker,
  fitFont,
  sticker,
} from '@/server/oshi-vod/result-image';
import { OSHI_CARD_CTA, OSHI_CARD_DISCLAIMER, type OshiCardImageSize, type OshiCardVariant } from '@/lib/oshi-card/params';

export { OSHI_VOD_IMAGE_FONT_FAMILY as OSHI_CARD_IMAGE_FONT_FAMILY } from '@/server/oshi-vod/result-image';

const SITE_URL = 'oshi-search.jp/oshi-card';

export interface OshiCardImageWork {
  title: string;
  typeLabel: string;
  year: number | null;
}

export interface OshiCardImageData {
  person: string;
  group: string;
  phrase: string;
  works: OshiCardImageWork[];
}

const meta = (w: OshiCardImageWork) => (w.year ? `${w.typeLabel}・${w.year}` : w.typeLabel);
const num = (i: number) => String(i + 1).padStart(2, '0');

/**
 * 文字幅の見積もり（Noto Sans JP Bold・1em あたり）。英大文字・記号は全角の半分より広いため種類ごとに分ける。
 * 英単語は途中で改行されず行末が空くため、1行に使える幅は 0.8 倍で見る。
 */
function charEm(ch: string): number {
  if (ch === ' ') return 0.26;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[a-z]/.test(ch)) return 0.54;
  if (/[0-9]/.test(ch)) return 0.56;
  if (ch.charCodeAt(0) < 0x2000) return 0.42; // 半角記号
  return 1;
}
const emWidth = (t: string) => [...t].reduce((u, ch) => u + charEm(ch), 0);

/**
 * 作品名を lines 行に収める：まず文字を maxFont から minFont まで小さくして全文が入る大きさを探し、
 * minFont でも入らない極端に長い名前だけ「…」で省略する。
 */
function fitTitle(title: string, width: number, maxFont: number, minFont: number, lines: number): { text: string; font: number } {
  const room = width * lines * 0.8;
  for (let f = maxFont; f >= minFont; f -= 2) {
    if (emWidth(title) * f <= room) return { text: title, font: f };
  }
  const limit = room / minFont - 1;
  let out = '';
  let u = 0;
  for (const ch of title) {
    if (u + charEm(ch) > limit) break;
    out += ch;
    u += charEm(ch);
  }
  // 1文字も省略しなかった（全文が入った）ときは「…」を付けない
  return { text: out.length === title.length ? title : `${out.trimEnd()}…`, font: minFont };
}

function Title({ title, width, maxFont, minFont, lines, color }: { title: string; width: number; maxFont: number; minFont: number; lines: number; color: string }) {
  const { text, font } = fitTitle(title, width, maxFont, minFont, lines);
  return <div style={{ display: 'flex', fontSize: font, fontWeight: 700, lineHeight: 1.22, color }}>{text}</div>;
}

// ─── cool：Editorial Premium ──────────────────────────────────────────────────

function CoolCardMasthead({ fontSize, mark, right }: { fontSize: number; mark: number; right: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: Math.round(fontSize * 0.55), borderBottom: `3px solid ${COOL.rule}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.45) }}>
        <BrandMark size={mark} radius={Math.round(mark * 0.12)} />
        <div style={{ display: 'flex', fontSize: Math.round(fontSize * 1.15), fontWeight: 700, color: COOL.ink }}>推しサーチ</div>
      </div>
      <CoolLabel fontSize={Math.round(fontSize * 0.8)} spacing={3} color={COOL.body}>{right}</CoolLabel>
    </div>
  );
}

function CoolCardCta({ fontSize, padY }: { fontSize: number; padY: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: `${padY}px ${Math.round(fontSize * 0.8)}px`, backgroundColor: COOL.ink }}>
      <div style={{ display: 'flex', fontSize, fontWeight: 700, color: '#FFFFFF' }}>{OSHI_CARD_CTA}</div>
      <div style={{ display: 'flex', fontSize: Math.round(fontSize * 1.1), fontWeight: 700, color: COOL.accent }}>→</div>
    </div>
  );
}

/** 作品の行：左に 01・02・03（黄色の蛍光ペン）、右に作品名と分類・公開年。行の間は細い罫線 */
function CoolWorkRows({ works, width, title, number, metaSize, pad, lines, minScale = 0.68 }: { works: OshiCardImageWork[]; width: number; title: number; number: number; metaSize: number; pad: number; lines: number; minScale?: number }) {
  const numWidth = Math.round(number * 1.55);
  const textWidth = width - numWidth;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {works.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', padding: `${pad}px 0`, borderTop: i === 0 ? `3px solid ${COOL.rule}` : `2px solid ${COOL.hair}` }}>
          <div style={{ display: 'flex', width: numWidth, flexShrink: 0 }}>
            <div style={{ display: 'flex', fontSize: number, fontWeight: 700, lineHeight: 1, letterSpacing: -2, color: COOL.ink, padding: '0 4px', ...coolMarker(60) }}>{num(i)}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', width: textWidth, gap: Math.round(metaSize * 0.3) }}>
            <Title title={w.title} width={textWidth} maxFont={title} minFont={Math.round(title * minScale)} lines={lines} color={COOL.ink} />
            <div style={{ display: 'flex', fontSize: metaSize, fontWeight: 700, color: COOL.muted }}>{meta(w)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildCoolPortrait(d: OshiCardImageData, size: 'feed' | 'story'): ReactElement {
  const story = size === 'story';
  const k = story ? 1.12 : 1;
  const r = (n: number) => Math.round(n * k);
  const width = 1080 - (story ? 176 : 152);
  const n = d.works.length;
  // 作品が少ないほど作品名を大きく（1件なら主役級に）
  const titleFont = n === 1 ? r(64) : n === 2 ? r(54) : r(46);
  return (
    <Canvas size={size} background={COOL_BG}>
      <Column padding={story ? '104px 88px 92px' : '58px 76px 44px'}>
        <CoolCardMasthead fontSize={r(24)} mark={r(40)} right="OSHI CARD" />
        <div style={{ display: 'flex', marginTop: r(30) }}>
          <div style={{ display: 'flex', fontSize: r(42), fontWeight: 700, color: COOL.ink, padding: '0 6px', ...coolMarker(60) }}>{d.phrase}</div>
        </div>
        {/* 推し名：いちばん大きく。長い名前は幅に合わせて縮める */}
        <div style={{ display: 'flex', marginTop: r(18), fontSize: fitFont(d.person, width, r(168), 64), fontWeight: 700, lineHeight: 1.08, letterSpacing: -5, color: COOL.ink }}>{d.person}</div>
        {d.group && <div style={{ display: 'flex', marginTop: r(10), fontSize: r(32), fontWeight: 700, color: COOL.muted }}>{d.group}</div>}

        {/* 作品が少ないときに下だけが空かないよう、作品の表の上下に余白を振り分ける */}
        <Spacer min={story ? 0 : 36} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: r(14) }}>
          <div style={{ display: 'flex', width: r(20), height: r(20), backgroundColor: COOL.accent, border: `2px solid ${COOL.ink}` }} />
          <CoolLabel fontSize={r(28)} color={COOL.ink} spacing={2}>{`推しのおすすめ作品（${n}作品）`}</CoolLabel>
        </div>
        <CoolWorkRows works={d.works} width={width} title={titleFont} number={r(64)} metaSize={r(26)} pad={r(18)} lines={story && n === 1 ? 3 : 2} minScale={n === 1 ? 0.5 : story ? 0.6 : 0.68} />

        <Spacer min={20} />
        <CoolCardCta fontSize={r(40)} padY={r(24)} />
        <div style={{ display: 'flex', marginTop: r(14), fontSize: r(30), fontWeight: 700, color: COOL.ink, letterSpacing: 1 }}>{SITE_URL}</div>
        <div style={{ display: 'flex', marginTop: r(8), fontSize: 20, color: COOL.muted }}>{OSHI_CARD_DISCLAIMER}</div>
      </Column>
    </Canvas>
  );
}

/** OG：中央600px（LINE の正方形切り抜き x=285〜915 の内側）に、ひとこと → 推し名 → 作品（1行ずつ）→ CTA */
function buildCoolOg(d: OshiCardImageData): ReactElement {
  const rowFont = d.works.length === 1 ? 44 : d.works.length === 2 ? 38 : 33;
  // 作品が少ないほど縦に余裕があるため、作品名に使う行を増やす（1件＝3行・2件＝2行・3件＝1行）
  const ogLines = d.works.length === 1 ? 3 : d.works.length === 2 ? 2 : 1;
  return (
    <Canvas size="og" background={COOL_BG}>
      <Abs style={{ top: 0, left: 0, width: 1200, height: 10, backgroundColor: COOL.accent }} />
      <Abs style={{ top: 64, left: 196, width: 2, height: 502, backgroundColor: COOL.hair }} />
      <Abs style={{ top: 64, right: 196, width: 2, height: 502, backgroundColor: COOL.hair }} />
      <Column padding="26px 300px 22px">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `3px solid ${COOL.rule}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BrandMark size={30} radius={4} />
            <div style={{ display: 'flex', fontSize: 25, fontWeight: 700, color: COOL.ink }}>推しサーチ</div>
          </div>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: COOL.body }}>{SITE_URL}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 12 }}>
          <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: COOL.ink, padding: '0 4px', ...coolMarker(60) }}>{d.phrase}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 6, fontSize: fitFont(d.person, 590, 84, 40), fontWeight: 700, lineHeight: 1.1, letterSpacing: -3, color: COOL.ink }}>{d.person}</div>
        <Spacer min={8} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {d.works.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '8px 0', borderTop: i === 0 ? `3px solid ${COOL.rule}` : `2px solid ${COOL.hair}` }}>
              <div style={{ display: 'flex', fontSize: rowFont, fontWeight: 700, color: COOL.ink, padding: '0 3px', ...coolMarker(60) }}>{num(i)}</div>
              <Title title={w.title} width={600 - rowFont * 2.4} maxFont={rowFont} minFont={Math.round(rowFont * (d.works.length === 1 ? 0.6 : 0.85))} lines={ogLines} color={COOL.ink} />
            </div>
          ))}
        </div>
        <Spacer min={8} />
        <CoolCardCta fontSize={30} padY={12} />
      </Column>
    </Canvas>
  );
}

// ─── cute：Fan Sticker ───────────────────────────────────────────────────────

const BADGE_COLORS = [CUTE.pink, BRAND_YELLOW, CUTE.mint];
const TILTS = [-1.2, 1, -0.8];

function CuteCardDecorations({ size }: { size: 'feed' | 'story' }) {
  const story = size === 'story';
  return (
    <Abs style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
      <Sparkle size={78} color={CUTE.white} style={{ top: story ? 70 : 34, right: 60 }} />
      <Heart size={34} color={CUTE.pink} style={{ top: story ? 64 : 30, right: 196 }} />
      <Star size={40} color={CUTE.pink} stroke={CUTE.ink} style={{ top: story ? 210 : 150, right: 24 }} />
      <Sparkle size={44} color={BRAND_YELLOW} style={{ top: story ? 560 : 400, left: 18 }} />
      <Heart size={28} color={CUTE.pink} style={{ bottom: story ? 300 : 210, left: 30 }} />
      <Star size={34} color={BRAND_YELLOW} stroke={CUTE.ink} style={{ bottom: story ? 380 : 270, right: 30 }} />
      {story && <Sparkle size={52} color={CUTE.white} style={{ top: 900, right: 36 }} />}
      {story && <Dot size={16} color={CUTE.pink} style={{ top: 1000, left: 40 }} />}
    </Abs>
  );
}

/** 推し名の黄色いネームプレート（紺のふち・ピンクの影） */
function CuteNamePlate({ name, group, width, font }: { name: string; group: string; width: number; font: number }) {
  const size = fitFont(name, width - font * 0.9, font, 56);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'flex-start', maxWidth: width, padding: `${Math.round(size * 0.16)}px ${Math.round(size * 0.4)}px ${Math.round(size * 0.2)}px`, ...sticker(BRAND_YELLOW, Math.round(size * 0.3), CUTE.pink, 5, Math.round(size * 0.09)), transform: 'rotate(-1.5deg)' }}>
      <div style={{ display: 'flex', fontSize: size, fontWeight: 700, lineHeight: 1.12, color: CUTE.ink }}>{name}</div>
      {group && <div style={{ display: 'flex', alignSelf: 'flex-start', marginTop: Math.round(size * 0.06), padding: '2px 16px', backgroundColor: CUTE.white, border: `3px solid ${CUTE.ink}`, borderRadius: 999, fontSize: Math.round(size * 0.24), fontWeight: 700, color: CUTE.ink }}>{group}</div>}
    </div>
  );
}

function CuteCta({ fontSize }: { fontSize: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `${Math.round(fontSize * 0.55)}px ${Math.round(fontSize * 1)}px`, ...sticker(CUTE.ink, 999, CUTE.pink, 4, Math.round(fontSize * 0.2)), color: CUTE.white, fontSize, fontWeight: 700 }}>
      {`${OSHI_CARD_CTA} →`}
    </div>
  );
}

function CuteBrand({ scale = 1 }: { scale?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(14 * scale) }}>
      <BrandMark size={Math.round(56 * scale)} radius={Math.round(16 * scale)} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontSize: Math.round(34 * scale), fontWeight: 700, lineHeight: 1.2, color: CUTE.ink }}>推しサーチ</div>
        <div style={{ display: 'flex', fontSize: Math.round(24 * scale), fontWeight: 700, color: CUTE.body }}>{SITE_URL}</div>
      </div>
    </div>
  );
}

/** 作品のチケット型シール：左に番号の丸、右に作品名と分類・公開年 */
function CuteWorkTickets({ works, width, title, badge, metaSize, gap, lines, minScale = 0.68 }: { works: OshiCardImageWork[]; width: number; title: number; badge: number; metaSize: number; gap: number; lines: number; minScale?: number }) {
  const textWidth = width - badge - 70;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {works.map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: `${Math.round(title * (works.length === 3 ? 0.26 : 0.36))}px 24px`, marginRight: 10, ...sticker(CUTE.white, 30, CUTE.ink, 4, 7), transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}>
          <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: badge, height: badge, borderRadius: badge / 2, backgroundColor: BADGE_COLORS[i % BADGE_COLORS.length], border: `4px solid ${CUTE.ink}`, fontSize: Math.round(badge * 0.5), fontWeight: 700, color: CUTE.ink }}>{i + 1}</div>
          <div style={{ display: 'flex', flexDirection: 'column', width: textWidth, gap: 6 }}>
            <Title title={w.title} width={textWidth} maxFont={title} minFont={Math.round(title * minScale)} lines={lines} color={CUTE.ink} />
            <div style={{ display: 'flex', alignSelf: 'flex-start', padding: `2px ${Math.round(metaSize * 0.6)}px`, backgroundColor: CUTE.cream, borderRadius: 999, fontSize: metaSize, fontWeight: 700, color: CUTE.body }}>{meta(w)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function buildCutePortrait(d: OshiCardImageData, size: 'feed' | 'story'): ReactElement {
  const story = size === 'story';
  const k = story ? 1.12 : 1;
  const r = (n: number) => Math.round(n * k);
  const { width, height } = { width: 1080, height: story ? 1920 : 1350 };
  const inner = width - (story ? 152 : 128);
  const n = d.works.length;
  const titleFont = n === 1 ? r(54) : n === 2 ? r(46) : r(40);
  // 3作品のときはチケットの間隔・番号の丸を詰めて、3件とも2行でも下の誘導が収まるようにする
  const dense = n === 3;
  return (
    <Canvas size={size} background={CUTE_BG}>
      <CuteDots width={width} height={height} gap={58} size={8} color="rgba(255,143,177,0.30)" />
      <CuteCardDecorations size={size} />
      <Column padding={story ? '104px 76px 86px' : '52px 64px 44px'}>
        <CuteTape fontSize={r(20)}>OSHI CARD ★ 布教カード</CuteTape>
        <div style={{ display: 'flex', marginTop: r(22) }}>
          <div style={{ display: 'flex', alignSelf: 'flex-start', padding: `${r(8)}px ${r(26)}px`, ...sticker(CUTE.white, 999, CUTE.pink, 4, r(6)), fontSize: r(40), fontWeight: 700, color: CUTE.ink, transform: 'rotate(1.2deg)' }}>{`♡ ${d.phrase} ♡`}</div>
        </div>
        <div style={{ display: 'flex', marginTop: r(30) }}>
          <CuteNamePlate name={d.person} group={d.group} width={inner - 30} font={r(132)} />
        </div>

        <Spacer min={story ? 0 : 30} />

        <div style={{ display: 'flex', alignSelf: 'flex-start', marginBottom: r(18), padding: `${r(5)}px ${r(20)}px`, backgroundColor: CUTE.ink, color: CUTE.white, borderRadius: 999, fontSize: r(26), fontWeight: 700, letterSpacing: 2 }}>{`わたしのおすすめ ${n}作品`}</div>
        <CuteWorkTickets works={d.works} width={inner} title={titleFont} badge={dense ? r(60) : r(72)} metaSize={r(24)} gap={dense ? r(12) : r(18)} lines={story && n === 1 ? 3 : 2} minScale={n === 1 ? 0.5 : story ? 0.6 : 0.68} />

        <Spacer min={20} />
        <div style={{ display: 'flex', justifyContent: 'center' }}><CuteCta fontSize={r(36)} /></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: r(20) }}><CuteBrand scale={0.86 * k} /></div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10, fontSize: 20, color: CUTE.muted }}>{OSHI_CARD_DISCLAIMER}</div>
      </Column>
    </Canvas>
  );
}

function buildCuteOg(d: OshiCardImageData): ReactElement {
  const rowFont = d.works.length === 1 ? 40 : d.works.length === 2 ? 34 : 30;
  const ogLines = d.works.length === 1 ? 3 : d.works.length === 2 ? 2 : 1;
  return (
    <Canvas size="og" background={CUTE_BG}>
      <CuteDots width={1200} height={630} gap={50} size={7} color="rgba(255,143,177,0.30)" />
      <Abs style={{ top: 0, left: 0, right: 0, bottom: 0 }}>
        <Sparkle size={84} color={CUTE.white} style={{ top: 60, left: 110 }} />
        <Heart size={44} color={CUTE.pink} style={{ top: 200, left: 60 }} />
        <Star size={54} color={BRAND_YELLOW} stroke={CUTE.ink} style={{ top: 360, left: 150 }} />
        <Sparkle size={40} color={CUTE.pink} style={{ top: 490, left: 70 }} />
        <Star size={48} color={CUTE.pink} stroke={CUTE.ink} style={{ top: 70, right: 120 }} />
        <Sparkle size={70} color={CUTE.white} style={{ top: 250, right: 70 }} />
        <Heart size={40} color={CUTE.pink} style={{ top: 430, right: 160 }} />
      </Abs>
      <Column padding="24px 300px 22px" center>
        <div style={{ display: 'flex', alignSelf: 'center', padding: '5px 20px', ...sticker(CUTE.white, 999, CUTE.pink, 3, 4), fontSize: 24, fontWeight: 700, color: CUTE.ink }}>{`♡ ${d.phrase} ♡`}</div>
        <div style={{ display: 'flex', marginTop: 12 }}>
          <div style={{ display: 'flex', padding: '4px 24px 6px', ...sticker(BRAND_YELLOW, 22, CUTE.pink, 4, 6), fontSize: fitFont(d.person, 520, 72, 36), fontWeight: 700, lineHeight: 1.15, color: CUTE.ink, transform: 'rotate(-1.5deg)' }}>{d.person}</div>
        </div>
        <Spacer min={8} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 590 }}>
          {d.works.map((w, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 16px', ...sticker(CUTE.white, ogLines > 1 ? 24 : 999, CUTE.ink, 3, 4) }}>
              <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: rowFont * 1.4, height: rowFont * 1.4, borderRadius: rowFont, backgroundColor: BADGE_COLORS[i % BADGE_COLORS.length], border: `3px solid ${CUTE.ink}`, fontSize: Math.round(rowFont * 0.75), fontWeight: 700, color: CUTE.ink }}>{i + 1}</div>
              <Title title={w.title} width={560 - rowFont * 2.4} maxFont={rowFont} minFont={Math.round(rowFont * (d.works.length === 1 ? 0.6 : 0.85))} lines={ogLines} color={CUTE.ink} />
            </div>
          ))}
        </div>
        <Spacer min={8} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: 600 }}>
          <CuteBrand scale={0.62} />
          <div style={{ display: 'flex', padding: '9px 18px', ...sticker(CUTE.ink, 999, CUTE.pink, 3, 4), color: CUTE.white, fontSize: 21, fontWeight: 700 }}>{`${OSHI_CARD_CTA} →`}</div>
        </div>
      </Column>
    </Canvas>
  );
}

export function buildOshiCardImageElement(data: OshiCardImageData, size: OshiCardImageSize, variant: OshiCardVariant): ReactElement {
  if (variant === 'cute') return size === 'og' ? buildCuteOg(data) : buildCutePortrait(data, size);
  return size === 'og' ? buildCoolOg(data) : buildCoolPortrait(data, size);
}
