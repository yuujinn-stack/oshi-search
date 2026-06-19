import { NextResponse } from 'next/server';
import { getActiveProviderLogoMap } from '@/lib/provider-store';

export const dynamic = 'force-dynamic';

// ProviderLogo コンポーネントがクライアント側から呼ぶ公開エンドポイント
// アクティブな配信サービスの slug → logoUrl マップを返す
export async function GET() {
  try {
    const map = await getActiveProviderLogoMap();
    // CDN・ブラウザキャッシュを無効化し、管理画面の更新を即時反映させる
    return NextResponse.json(map, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({});
  }
}
