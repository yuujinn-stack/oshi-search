/**
 * テンプレート候補A「最近この人、気になってる？」（curious-person）。Preview専用。
 * まだ推しではないが最近気になっている人に向けて、「まず知りたい3つ」（出演作品・今見られる配信先・
 * 関連する人物／グループ）を見せる。表示するのは実データで確認できた項目だけ。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, COLORS } from './theme';
import {
  BottomNote,
  BrandLogo,
  CtaBand,
  MarkedText,
  Page,
  SwipeHint,
  WorkThumb,
  fitFontSize,
  type CandidateImage,
} from './shared';

export interface CuriousPersonData {
  personName: string;
  /** 1枚目の装飾に使う作品画像（0〜3件。無ければ装飾なし） */
  images: CandidateImage[];
  /** 出演作品（配信確認できる作品のタイトル、1〜3件） */
  workTitles: string[];
  /** 今見られる配信先（表示名、最大4件） */
  services: string[];
  /** 今見られる配信先の総数（「ほかNサービス」表示用） */
  serviceTotal: number;
  /** 所属グループ（無ければnull） */
  group: string | null;
  /** 同じグループの人物（最大3名） */
  groupMembers: string[];
}

function Page1({ data }: { data: CuriousPersonData }): ReactElement {
  const nameSize = fitFontSize(data.personName, 900, 120, 60);
  return (
    <Page background={BACKGROUNDS.cyan} brand overlay={<SwipeHint />}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 58, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>最近、</span>
        <MarkedText text={data.personName} fontSize={nameSize} markerColor={COLORS.white} />
        <span style={{ fontSize: 58, fontWeight: 700, color: COLORS.textDark, display: 'flex', marginTop: 6 }}>ちょっと気になってる人へ。</span>
      </div>
      <div style={{ marginTop: 40, fontSize: 36, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>
        何から見ればいいか分からないなら…
      </div>
      {data.images.length > 0 && (
        <div style={{ marginTop: 44, display: 'flex', alignItems: 'flex-end', gap: 26 }}>
          {data.images.slice(0, 3).map((img, i, arr) => (
            <div
              key={`${i}-${img.title}`}
              style={{
                display: 'flex',
                padding: 6,
                borderRadius: 20,
                background: COLORS.white,
                boxShadow: '0 12px 24px rgba(16,51,73,0.16)',
                transform: `rotate(${arr.length === 3 ? [-6, 0, 6][i] : 0}deg)`,
                marginBottom: arr.length === 3 && i === 1 ? 12 : 0,
              }}
            >
              <WorkThumb image={img} width={130} height={182} fallbackFontSize={54} />
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

function ItemCard({ n, label, children }: { n: number; label: string; children: ReactElement }): ReactElement {
  return (
    <div
      style={{
        width: 920,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 24,
        padding: '18px 28px',
        background: COLORS.white,
        borderRadius: 28,
        border: `1.5px solid ${COLORS.cardBorder}`,
        boxShadow: '0 10px 24px rgba(16,51,73,0.10)',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: COLORS.accentDark,
          color: COLORS.white,
          fontSize: 34,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>{label}</span>
        {children}
      </div>
    </div>
  );
}

function Chip({ text }: { text: string }): ReactElement {
  return (
    <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.white, background: COLORS.accentDark, borderRadius: 999, padding: '8px 22px', display: 'flex' }}>
      {text}
    </div>
  );
}

function Page2({ data }: { data: CuriousPersonData }): ReactElement {
  const items: { label: string; body: ReactElement }[] = [
    {
      label: '出演作品',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.workTitles.map((t) => (
            <div
              key={t}
              style={{ fontSize: 30, fontWeight: 700, color: COLORS.textDark, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
            >
              {`・${t}`}
            </div>
          ))}
        </div>
      ),
    },
    {
      label: '今見られる配信先',
      body: (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {data.services.map((s) => (
            <Chip key={s} text={s} />
          ))}
          {data.serviceTotal > data.services.length && (
            <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>{`ほか${data.serviceTotal - data.services.length}サービス`}</span>
          )}
        </div>
      ),
    },
  ];
  if (data.group) {
    items.push({
      label: '関連する人物／グループ',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex' }}>
            <Chip text={data.group} />
          </div>
          {data.groupMembers.length > 0 && (
            <div style={{ fontSize: 28, fontWeight: 700, color: COLORS.textDark, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {`同じグループ：${data.groupMembers.join('・')}`}
            </div>
          )}
        </div>
      ),
    });
  }
  return (
    <Page background={BACKGROUNDS.pale} brand overlay={<BottomNote />} bodyPaddingBottom={70}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: 42, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>気になる人ができたら</span>
        <MarkedText text={`まず知りたい${items.length}つ`} fontSize={52} markerColor={COLORS.white} />
      </div>
      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map((it, i) => (
          <ItemCard key={it.label} n={i + 1} label={it.label}>
            {it.body}
          </ItemCard>
        ))}
      </div>
    </Page>
  );
}

function Page3(): ReactElement {
  return (
    <Page background={BACKGROUNDS.navy} tone="navy">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 88, fontWeight: 700, color: COLORS.white, display: 'flex' }}>“気になる”を</span>
        <span style={{ fontSize: 88, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>“推し”に。</span>
      </div>
      <div style={{ marginTop: 60, display: 'flex' }}>
        <BrandLogo fontSize={76} tone="navy" />
      </div>
      <div style={{ marginTop: 30, fontSize: 38, fontWeight: 700, color: COLORS.textOnNavyMuted, display: 'flex' }}>名前からまとめて探せます</div>
      <CtaBand tone="navy" marginTop={54} />
    </Page>
  );
}

export function buildCuriousPersonPages(data: CuriousPersonData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" />];
}
