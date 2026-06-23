import { NextRequest, NextResponse } from 'next/server';
import { getWork, saveWork } from '@/lib/work-store';

// POST /api/admin/og-image-fetch
// body: { personName, workId }
// posterUrl が空の作品に対して vodProviders の officialUrl / sourceUrl から
// OG画像を取得して posterUrl に保存する。管理画面ボタン押下時のみ実行。

// ─── YouTube 動画ID抽出 ────────────────────────────────────────────────────────
// 対応形式:
//   youtube.com/watch?v=ID
//   youtu.be/ID
//   youtube.com/shorts/ID
//   youtube.com/live/ID
//   youtube.com/embed/ID
//   youtube.com/v/ID
function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('?')[0] || null;
    }
    if (u.hostname.includes('youtube.com')) {
      return (
        u.searchParams.get('v') ??
        u.pathname.match(/\/(shorts|live|embed|v)\/([^/?]+)/)?.[2] ??
        null
      );
    }
    return null;
  } catch {
    return null;
  }
}

// ─── YouTube サムネイルURL解決 ─────────────────────────────────────────────────
// maxresdefault.jpg が存在しない動画では 120×90 の空プレースホルダーが返る。
// HEAD リクエストでサイズを確認し、極端に小さければ hqdefault.jpg へ切り替える。
const YT_PLACEHOLDER_MAX_BYTES = 5_000;

async function resolveYouTubeThumbnail(videoId: string): Promise<string> {
  const maxres = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  const hq = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(maxres, { method: 'HEAD', signal: controller.signal });
      if (!res.ok) return hq;
      const len = parseInt(res.headers.get('content-length') ?? '0', 10);
      // content-length が取れてプレースホルダーサイズ以下なら hqdefault を使う
      if (len > 0 && len < YT_PLACEHOLDER_MAX_BYTES) return hq;
      return maxres;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // タイムアウト・ネットワークエラー時は hqdefault にフォールバック
    return hq;
  }
}

// ─── 相対URL解決 ───────────────────────────────────────────────────────────────
function resolveUrl(imageUrl: string, baseUrl: string): string {
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  try {
    return new URL(imageUrl, baseUrl).href;
  } catch {
    return imageUrl;
  }
}

// ─── OGタグからの画像取得 ──────────────────────────────────────────────────────
async function fetchOgImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
    if (!res.ok) return null;

    // OGタグは <head> 内にあるので先頭100KBで十分
    const text = await res.text();
    const html = text.slice(0, 100_000);

    // og:image (property/content どちらが先でも対応)
    const ogPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ];
    for (const pattern of ogPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) return resolveUrl(m[1], url);
    }

    // twitter:image / twitter:image:src
    const twitterPatterns = [
      /<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image(?::src)?["']/i,
    ];
    for (const pattern of twitterPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) return resolveUrl(m[1], url);
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── ハンドラー ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId } = body as { personName?: string; workId?: string };

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName, workId が必要です' }, { status: 400 });
  }

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

  // TMDb posterUrl が既にある場合はスキップ
  if (work.posterUrl) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'posterUrl既存' });
  }

  // URL候補収集: officialUrl → sourceUrl の順（重複除去）
  const seen = new Set<string>();
  const urlCandidates: string[] = [];
  for (const p of work.vodProviders ?? []) {
    if (p.officialUrl && !seen.has(p.officialUrl)) {
      seen.add(p.officialUrl);
      urlCandidates.push(p.officialUrl);
    }
  }
  for (const p of work.vodProviders ?? []) {
    if (p.sourceUrl && !seen.has(p.sourceUrl)) {
      seen.add(p.sourceUrl);
      urlCandidates.push(p.sourceUrl);
    }
  }

  if (urlCandidates.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'officialUrl/sourceUrlなし' });
  }

  for (const url of urlCandidates) {
    // YouTube: 動画IDからサムネイルURLを生成（maxresdefault → hqdefault フォールバックあり）
    const ytId = extractYouTubeVideoId(url);
    if (ytId) {
      const posterUrl = await resolveYouTubeThumbnail(ytId);
      work.posterUrl = posterUrl;
      work.updatedAt = Date.now();
      await saveWork(work);
      return NextResponse.json({ ok: true, posterUrl, source: 'youtube', videoId: ytId });
    }

    // OG画像取得
    const posterUrl = await fetchOgImage(url);
    if (posterUrl) {
      work.posterUrl = posterUrl;
      work.updatedAt = Date.now();
      await saveWork(work);
      return NextResponse.json({ ok: true, posterUrl, source: 'og' });
    }
  }

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: `${urlCandidates.length}件のURLからOG画像を取得できませんでした`,
  });
}
