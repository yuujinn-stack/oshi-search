// /oshi-card 本体の静的OG画像（ビルド時に1枚だけ生成）。完成カードのURLは generateMetadata で /oshi-card/og を指定する。
import { ImageResponse } from 'next/og';
import { getNotoSansJpBoldFontData } from '@/server/instagram-post/fonts/font-loader';

export const alt = '推し布教カード｜推しサーチ';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 300px', backgroundColor: '#F5F2EA', borderTop: '10px solid #FEE34F', fontFamily: 'Noto Sans JP', color: '#1E1F24' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 12, borderBottom: '3px solid #1E1F24' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 4, backgroundColor: '#FEE34F', color: '#112A5A', fontSize: 22, fontWeight: 700 }}>推</div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700 }}>推しサーチ</div>
        </div>
        <div style={{ display: 'flex', marginTop: 26 }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, padding: '0 6px', backgroundImage: 'linear-gradient(180deg, rgba(254,227,79,0) 60%, #FEE34F 60%)' }}>あなたの推しを布教しよう</div>
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: 84, fontWeight: 700, letterSpacing: -3 }}>推し布教カード</div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 26, fontWeight: 700, color: '#3A3B42' }}>おすすめ作品を選んで、SNSでシェア</div>
        <div style={{ display: 'flex', marginTop: 30, padding: '14px 22px', backgroundColor: '#1E1F24', color: '#FFFFFF', fontSize: 26, fontWeight: 700, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex' }}>oshi-search.jp/oshi-card</div>
          <div style={{ display: 'flex', color: '#FEE34F' }}>→</div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Noto Sans JP', data: getNotoSansJpBoldFontData(), weight: 700, style: 'normal' }] },
  );
}
