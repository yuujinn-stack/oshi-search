// 作品ページの OGP／SNS 共有用画像（1200×630）を D-1共通デザインで描く（next/og の Satori 用 JSX）。
// 作品画像を設定で「D-1共通デザイン」にしたときだけ、作品ページの og:image・twitter:image・JSON-LD の image が
// この画像（/work/[workId]/og）を指す。外部の作品画像（TMDb・OG・手動画像）は一切読み込まない。
// 色・構成は画面上の D-1（src/components/work-visual/work-d1.css）と同じ。
import { getD1MetaParts, getD1TitleWeightedLength, WORK_D1_OG_IMAGE_SIZE } from '@/lib/work-image-display';

export const WORK_D1_OG_SIZE = WORK_D1_OG_IMAGE_SIZE;

const C = {
  page: '#F4F4F1',
  bg: '#FFFFFF',
  title: '#161616',
  meta: '#6B6B6B',
  brand: '#C4C4C4',
  border: '#E6E6E6',
  accent: '#F97316',
};

/** OG 画像の作品名の文字サイズ（px）。長いほど小さく、全文を表示する */
export function getWorkD1OgTitleFontSize(title: string): number {
  const n = getD1TitleWeightedLength(title);
  if (n <= 8) return 96;
  if (n <= 14) return 80;
  if (n <= 22) return 66;
  if (n <= 34) return 56;
  if (n <= 50) return 46;
  if (n <= 80) return 38;
  return 30;
}

export interface WorkD1OgInput {
  title: string;
  typeLabel?: string | null;
  releaseYear?: number | null;
}

export function WorkD1OgImage({ title, typeLabel, releaseYear }: WorkD1OgInput) {
  const meta = getD1MetaParts(typeLabel, releaseYear).join(' · ');
  const fontSize = getWorkD1OgTitleFontSize(title);
  return (
    <div
      style={{
        width: '100%', height: '100%', display: 'flex', padding: 36,
        backgroundColor: C.page, fontFamily: 'Noto Sans JP',
      }}
    >
      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          backgroundColor: C.bg, border: `2px solid ${C.border}`, borderRadius: 12, padding: '40px 72px 34px',
        }}
      >
        <div style={{ display: 'flex', height: 40, fontSize: 30, fontWeight: 700, color: C.meta, letterSpacing: 1 }}>{meta}</div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <div
            style={{
              display: 'flex', justifyContent: 'center', textAlign: 'center', width: '100%',
              fontSize, fontWeight: 700, lineHeight: 1.3, color: C.title, wordBreak: 'break-word',
            }}
          >
            {title}
          </div>
          <div style={{ display: 'flex', width: 72, height: 5, marginTop: 30, backgroundColor: C.accent, borderRadius: 3 }} />
        </div>
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: 8, color: C.brand }}>OSHI SEARCH</div>
      </div>
    </div>
  );
}
