// 推し活サービスの3ジャンルのカード（ホームの「推し活サービス」コーナーと /oshikatsu で共用）。
// 利用可能なジャンルだけカード全体を比較ページへのリンクにする。準備中はリンクにせず「準備中」と表示する。
// ジャンルの状態・リンク先は src/lib/oshikatsu-services/categories.ts で管理する。
// 見た目は oshikatsu-services.css（.oks-*。白・黒・オレンジ）。アイコンは自前の単純な線画SVG（外部画像なし）。
import OshikatsuCategoryLink from './OshikatsuCategoryLink';
import { OSHIKATSU_CATEGORIES, isCategoryLinkable, type OshikatsuCategory, type OshikatsuCategoryIcon } from '@/lib/oshikatsu-services/categories';
import './oshikatsu-services.css';

function CategoryIcon({ icon }: { icon: OshikatsuCategoryIcon }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (icon === 'make') {
    // ペンと星（作る）
    return (
      <svg {...common}>
        <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
        <path d="M13.5 7.5l3 3" />
        <path d="M18 2.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
      </svg>
    );
  }
  if (icon === 'box') {
    // 箱（整理・買取）
    return (
      <svg {...common}>
        <path d="M3 8l9-4 9 4-9 4-9-4z" />
        <path d="M3 8v8l9 4 9-4V8" />
        <path d="M12 12v8" />
      </svg>
    );
  }
  // ハンガー（ファッション）
  return (
    <svg {...common}>
      <path d="M12 7a2 2 0 1 1 2-2" />
      <path d="M12 7v2L3 16a1.5 1.5 0 0 0 1 2.7h16a1.5 1.5 0 0 0 1-2.7l-9-7" />
    </svg>
  );
}

function CardBody({ c, showPurposes }: { c: OshikatsuCategory; showPurposes: boolean }) {
  const linkable = isCategoryLinkable(c);
  return (
    <>
      <span className="oks-card-head">
        <span className="oks-icon"><CategoryIcon icon={c.icon} /></span>
        <span className="oks-name">{c.name}</span>
        {!linkable && <span className="oks-soon">準備中</span>}
      </span>
      <span className="oks-summary">{c.summary}</span>
      {showPurposes && (
        <span className="oks-purposes">
          {c.purposes.map((p) => <span key={p} className="oks-purpose">{p}</span>)}
        </span>
      )}
      {linkable && c.serviceNames.length > 0 && (
        <span className="oks-services">掲載：{c.serviceNames.join('・')}</span>
      )}
      {linkable && <span className="oks-go">比較を見る →</span>}
    </>
  );
}

interface Props {
  placement: 'home' | 'hub';
  /** 総合ページでは「こんなときに」の説明も出す */
  showPurposes?: boolean;
}

export default function OshikatsuCategoryCards({ placement, showPurposes = false }: Props) {
  return (
    <ul className="oks-cards">
      {OSHIKATSU_CATEGORIES.map((c) => (
        <li key={c.id}>
          {isCategoryLinkable(c) ? (
            <OshikatsuCategoryLink href={c.href} categoryId={c.id} placement={placement} className="oks-card oks-card--on">
              <CardBody c={c} showPurposes={showPurposes} />
            </OshikatsuCategoryLink>
          ) : (
            <div className="oks-card oks-card--soon">
              <CardBody c={c} showPurposes={showPurposes} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
