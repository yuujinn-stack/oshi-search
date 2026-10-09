// 推しに合うサブスク診断の結果画像テンプレート（next/og = Satori 用）。
// - feed（1080×1350）と story（1080×1920）は同じレイアウト関数で、サイズ依存の値だけ切り替える。
// - 人物写真は使わない（権利上安全な画像が既存に無いため。名前タグで構成する）。
// - サービスはロゴ画像を外部から読み込まず、既存のCTA配色（getVodServiceStyle）の帯で表現する
//   （外部画像の取得失敗で描画が壊れることを防ぐ）。
// - Satori の制約: 子要素を2つ以上持つ div には display:flex が必須。
import 'server-only';
import type { CSSProperties, ReactElement } from 'react';
import { getVodServiceStyle } from '@/lib/vod-cta';
import { OSHI_VOD_IMAGE_SIZES, type OshiVodImageSize } from '@/lib/oshi-vod/params';
import type { OshiVodImageData, OshiVodImageService } from '@/lib/oshi-vod/image-data';

const C = {
  bg: '#F4F4F1',
  ink: '#0A0A0A',
  body: '#2B2B28',
  muted: '#62625C',
  orange: '#FF5A00',
  orangeText: '#C84A00',
  orangeSoft: '#FFF7F1',
  white: '#FFFFFF',
  border: '#D9D8D1',
};
export const OSHI_VOD_IMAGE_FONT_FAMILY = 'Noto Sans JP';
const MAX_NAME_TAGS = 9;

function serviceFill(service: string): CSSProperties {
  const s = getVodServiceStyle(service);
  const fill: CSSProperties = s.background.startsWith('linear-gradient')
    ? { backgroundImage: s.background }
    : { backgroundColor: s.background };
  return { ...fill, color: s.color, border: s.border ?? 'none' };
}

function ServiceBand({ svc, fontSize, padY }: { svc: OshiVodImageService; fontSize: number; padY: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `${padY}px 28px`, fontSize, fontWeight: 700, ...serviceFill(svc.service) }}>
      {svc.displayName}
    </div>
  );
}

export function buildOshiVodImageElement(data: OshiVodImageData, size: OshiVodImageSize): ReactElement {
  const { width, height } = OSHI_VOD_IMAGE_SIZES[size];
  const story = size === 'story';
  const k = story ? 1.12 : 1; // story は縦に余裕があるため少し大きく
  const shown = data.personNames.slice(0, MAX_NAME_TAGS);
  const rest = data.personNames.length - shown.length;
  const nameFont = Math.round((data.personNames.length <= 3 ? 40 : data.personNames.length <= 6 ? 32 : 26) * k);

  return (
    <div
      style={{
        width, height, display: 'flex', flexDirection: 'column',
        backgroundColor: C.bg, fontFamily: OSHI_VOD_IMAGE_FONT_FAMILY, color: C.ink,
        padding: story ? '120px 72px 110px' : '64px 64px 56px',
        borderTop: `16px solid ${C.orange}`,
      }}
    >
      {/* 診断名 */}
      <div style={{ display: 'flex', fontSize: Math.round(26 * k), fontWeight: 700, letterSpacing: 4, color: C.orangeText }}>
        OSHI SEARCH ／ DIAGNOSIS
      </div>
      <div style={{ display: 'flex', marginTop: 12, fontSize: Math.round(72 * k), fontWeight: 700, lineHeight: 1.15 }}>
        推しに合うサブスク診断
      </div>

      {/* story は縦に余白があるため、上下の余白を均等に分けて中央寄りに配置する */}
      {story && <div style={{ display: 'flex', flex: 1 }} />}

      {/* 選択した人物 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: Math.round(32 * k) }}>
        {shown.map((n) => (
          <div key={n} style={{ display: 'flex', padding: '8px 18px', fontSize: nameFont, fontWeight: 700, backgroundColor: C.white, border: `3px solid ${C.ink}` }}>
            {n}
          </div>
        ))}
        {rest > 0 && (
          <div style={{ display: 'flex', padding: '8px 18px', fontSize: nameFont, fontWeight: 700, color: C.muted }}>ほか{rest}人</div>
        )}
      </div>

      {/* 作品数重視1位 */}
      <div
        style={{
          display: 'flex', flexDirection: 'column', marginTop: Math.round(40 * k),
          backgroundColor: C.white, border: `4px solid ${C.ink}`, boxShadow: `14px 14px 0 ${C.orange}`,
          padding: story ? '44px 44px' : '36px 40px',
        }}
      >
        <div style={{ display: 'flex', fontSize: Math.round(30 * k), fontWeight: 700, color: C.orangeText }}>
          {data.top?.tied ? '作品数重視 同率1位' : '作品数重視 1位'}
        </div>
        {data.top ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 18 }}>
              {data.top.services.map((s) => (
                <ServiceBand key={s.service} svc={s} fontSize={Math.round((data.top!.services.length > 1 ? 52 : 76) * k)} padY={Math.round(14 * k)} />
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, marginTop: 26, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', fontSize: Math.round(64 * k), fontWeight: 700 }}>
                {`${data.top.paidCount} / ${data.paidTotal}作品`}
              </div>
              <div style={{ display: 'flex', fontSize: Math.round(36 * k), fontWeight: 700, color: C.body }}>
                {`カバー率${data.top.coverage}`}
              </div>
            </div>
            {data.top.price && (
              <div style={{ display: 'flex', marginTop: 8, fontSize: Math.round(30 * k), color: C.body }}>{data.top.price}</div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 18, fontSize: Math.round(36 * k), fontWeight: 700, color: C.body }}>
            有料サブスクで見放題の作品は確認できませんでした
          </div>
        )}
      </div>

      {/* 対象作品数・2サービス最適解 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: Math.round(40 * k) }}>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: Math.round(30 * k), color: C.body }}>
          <div style={{ display: 'flex' }}>{`対象作品：有料サブスクで見放題 ${data.paidTotal}作品`}</div>
          <div style={{ display: 'flex', fontSize: Math.round(24 * k), color: C.muted, marginTop: 4 }}>
            {`登録出演作品 ${data.registered}作品・無料で見られる作品 ${data.free}作品`}
          </div>
        </div>
        {data.pair && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, fontSize: Math.round(34 * k), fontWeight: 700 }}>
            <div style={{ display: 'flex', color: C.orangeText }}>2サービスなら</div>
            <div style={{ display: 'flex' }}>{data.pair.services.map((s) => s.displayName).join(' ＋ ')}</div>
            <div style={{ display: 'flex', color: C.body }}>{`${data.pair.unionCount}作品（${data.pair.coverage}）`}</div>
          </div>
        )}
      </div>

      {/* フッター：推しサーチ名・誘導 */}
      <div style={{ display: 'flex', flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `4px solid ${C.ink}`, paddingTop: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: Math.round(44 * k), fontWeight: 700 }}>
            <div style={{ display: 'flex', width: 22, height: 22, borderRadius: 11, backgroundColor: C.orange }} />
            推しサーチ
          </div>
          <div style={{ display: 'flex', marginTop: 6, fontSize: Math.round(30 * k), color: C.body }}>oshi-search.jp/oshi-vod</div>
        </div>
        <div style={{ display: 'flex', padding: '18px 26px', backgroundColor: C.ink, color: C.white, fontSize: Math.round(30 * k), fontWeight: 700 }}>
          あなたの推しでも診断 →
        </div>
      </div>
      <div style={{ display: 'flex', marginTop: 14, fontSize: 20, color: C.muted }}>
        配信状況・料金は変更される場合があります。最新情報は各サービス公式サイトでご確認ください。
      </div>
    </div>
  );
}
