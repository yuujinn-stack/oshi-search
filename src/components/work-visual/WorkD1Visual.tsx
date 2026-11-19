// D-1共通デザインの作品ビジュアル（サーバー・クライアントどちらのコンポーネントからも使える。状態なし）。
//
// 画像ではなく HTML のテキストとして作品名を描くため、検索エンジン・スクリーンリーダーにも
// 作品名がそのまま伝わる（カード下に同じタイトルを重ねて出さない構成にしても SEO・アクセシビリティを保てる）。
// 「OSHI SEARCH」の透かしは装飾なので読み上げない。
//
// variant:
//   'full'    … 作品カード用（上部に種類・公開年、中央に作品名＋オレンジ線、下部に OSHI SEARCH）
//   'compact' … 横に作品名がある小さなサムネイル用（作品名は描かず、種類とオレンジ線だけ。作品名の重複を避ける）
import { Noto_Sans_JP } from 'next/font/google';
import { getD1MetaParts, getD1TitleSize } from '@/lib/work-image-display';
import './work-d1.css';

// 太字（700）だけをセルフホストで読み込む（外部CDNへのリクエストなし）。preload しないため、
// D-1 を表示しないページ・従来画像表示のときは読み込まれない。
const d1Font = Noto_Sans_JP({ subsets: ['latin'], weight: ['700'], display: 'swap', preload: false, variable: '--font-d1' });

export interface WorkD1VisualProps {
  title: string;
  /** 作品種類（ドラマ・映画など）。不明なら省略 */
  typeLabel?: string | null;
  releaseYear?: number | null;
  variant?: 'full' | 'compact';
  className?: string;
}

export default function WorkD1Visual({ title, typeLabel, releaseYear, variant = 'full', className }: WorkD1VisualProps) {
  const cls = ['work-d1', variant === 'compact' ? 'work-d1--compact' : '', d1Font.variable, className ?? '']
    .filter(Boolean)
    .join(' ');

  if (variant === 'compact') {
    return (
      <span className={cls} data-variant="compact" aria-hidden="true">
        <span className="work-d1__inner">
          {typeLabel?.trim() ? <span className="work-d1__meta">{typeLabel.trim()}</span> : null}
          <span className="work-d1__rule" />
        </span>
      </span>
    );
  }

  // 種類と公開年は別々の塊にし、幅が足りないカードでは「種類」「· 公開年」の間で折り返す（省略しない）
  const metaParts = getD1MetaParts(typeLabel, releaseYear);
  return (
    <span className={cls} data-variant="full" data-size={getD1TitleSize(title)}>
      <span className="work-d1__inner">
        <span className="work-d1__meta">
          {metaParts.map((part, i) => (
            <span key={i} className="work-d1__meta-part">{i > 0 ? `· ${part}` : part}</span>
          ))}
        </span>
        <span className="work-d1__body">
          <span className="work-d1__title">{title}</span>
          <span className="work-d1__rule" aria-hidden="true" />
        </span>
        <span className="work-d1__brand" aria-hidden="true">OSHI SEARCH</span>
      </span>
    </span>
  );
}
