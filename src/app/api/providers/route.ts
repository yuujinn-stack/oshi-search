import { NextResponse } from 'next/server';
import { getActiveProviderLogoMap } from '@/lib/provider-store';

export const dynamic = 'force-dynamic';

// ProviderLogo コンポーネントがクライアント側から呼ぶ公開エンドポイント
// アクティブな配信サービスの slug → logoUrl マップを返す
export async function GET() {
  try {
    const map = await getActiveProviderLogoMap();
    return NextResponse.json(map, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
    });
  } catch {
    return NextResponse.json({});
  }
}
