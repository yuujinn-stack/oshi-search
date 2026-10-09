// /oshi-vod の静的OG画像（ビルド時に1枚だけ生成。人物の組み合わせごとの動的OGは作らない）。
import { ImageResponse } from 'next/og';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';

export const alt = '推しに合うサブスク診断｜推しサーチ';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: '0 80px', backgroundColor: '#F4F4F1', borderTop: '14px solid #FF5A00',
          fontFamily: 'Noto Sans JP', color: '#0A0A0A',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, letterSpacing: 4, color: '#C84A00' }}>OSHI SEARCH ／ DIAGNOSIS</div>
        <div style={{ display: 'flex', marginTop: 16, fontSize: 84, fontWeight: 700 }}>推しに合うサブスク診断</div>
        <div style={{ display: 'flex', marginTop: 20, fontSize: 36, fontWeight: 700, color: '#2B2B28' }}>
          推しの出演作品が一番見られる動画配信サービスは？
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 48 }}>
          <div style={{ display: 'flex', padding: '16px 28px', backgroundColor: '#0A0A0A', color: '#FFFFFF', fontSize: 32, fontWeight: 700 }}>
            推しを選ぶだけで診断 →
          </div>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>oshi-search.jp/oshi-vod</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Noto Sans JP', data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }] },
  );
}
