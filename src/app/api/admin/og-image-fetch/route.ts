import { NextRequest, NextResponse } from 'next/server';
import { getWork, saveWork } from '@/lib/work-store';

// POST /api/admin/og-image-fetch
// body: { personName, workId, debug? }
// posterUrl が空の作品に対して vodProviders の officialUrl / sourceUrl から
// OG画像を取得して posterUrl に保存する。管理画面ボタン押下時のみ実行。

// ─── URL から YouTube 動画ID を抽出（URL自体がYouTubeの場合）────────────────────
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

// ─── HTML 内から YouTube 動画ID を抽出（公式記事の埋め込みURL対応）──────────────
// 対応パターン:
//   <iframe src="https://www.youtube.com/embed/ID">
//   youtube.com/watch?v=ID  （リンクテキスト内）
//   youtu.be/ID
//   youtube.com/shorts/ID
//   youtube.com/live/ID
function extractYouTubeIdFromHtml(html: string): string | null {
  const patterns = [
    /youtube\.com\/embed\/([^"'/?&\s]+)/,
    /youtube\.com\/watch\?v=([^"'&\s]+)/,
    /youtu\.be\/([^"'/?&\s]+)/,
    /youtube\.com\/shorts\/([^"'/?&\s]+)/,
    /youtube\.com\/live\/([^"'/?&\s]+)/,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return m[1];
  }
  return null;
}

// ─── YouTube サムネイルURL ───────────────────────────────────────────────────
// hqdefault.jpg (480×360) は全動画で必ず存在する。
// maxresdefault.jpg は存在しない動画でも img.youtube.com が HTTP 200 を返すため
// HEAD リクエストによる判定が不安定。管理画面補完用途では hqdefault を固定で使う。
function youTubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
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

// ─── ページHTMLを取得して画像を探す ────────────────────────────────────────────
// 優先順位:
//   1. HTML内の YouTube 埋め込みURL → hqdefault.jpg を返す
//   2. og:image / twitter:image メタタグ
//
// 戻り値:
//   { source: 'youtube_embed', posterUrl: string } → YouTube埋め込みから取得
//   { source: 'og', posterUrl: string }            → OGタグから取得
//   null                                           → 取得できず
type PageExtractResult =
  | { source: 'youtube_embed'; posterUrl: string; videoId: string }
  | { source: 'og'; posterUrl: string };

async function fetchPageAndExtract(
  url: string,
  log: string[],
): Promise<PageExtractResult | null> {
  log.push(`[page] フェッチ: ${url}`);
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
    log.push(`[page] status=${res.status}`);
    if (!res.ok) return null;

    const html = (await res.text()).slice(0, 100_000);

    // ── 優先1: HTML内にYouTube埋め込みURLがあれば動画IDを抽出 ──
    log.push(`[page] YouTube埋め込みを検索中...`);
    const ytId = extractYouTubeIdFromHtml(html);
    if (ytId) {
      const posterUrl = youTubeThumbnailUrl(ytId);
      log.push(`[page] YouTube埋め込み発見 videoId=${ytId} → ${posterUrl}`);
      return { source: 'youtube_embed', posterUrl, videoId: ytId };
    }
    log.push(`[page] YouTube埋め込みなし → OGタグを検索`);

    // ── 優先2: og:image ──
    const ogPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ];
    for (const pattern of ogPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) {
        const posterUrl = resolveUrl(m[1], url);
        log.push(`[page] og:image=${posterUrl}`);
        return { source: 'og', posterUrl };
      }
    }

    // ── 優先3: twitter:image ──
    const twitterPatterns = [
      /<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image(?::src)?["']/i,
    ];
    for (const pattern of twitterPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) {
        const posterUrl = resolveUrl(m[1], url);
        log.push(`[page] twitter:image=${posterUrl}`);
        return { source: 'og', posterUrl };
      }
    }

    log.push(`[page] OGタグなし`);
    return null;
  } catch (e) {
    log.push(`[page] 例外=${String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── ハンドラー ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, debug } = body as {
    personName?: string;
    workId?: string;
    debug?: boolean;
  };

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName, workId が必要です' }, { status: 400 });
  }

  const log: string[] = [];

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

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

  log.push(`candidates=${urlCandidates.length}`);

  for (const url of urlCandidates) {
    log.push(`url=${url}`);

    // ─ パスA: URL自体がYouTube → hqdefault を即保存 ─
    const ytId = extractYouTubeVideoId(url);
    if (ytId) {
      const posterUrl = youTubeThumbnailUrl(ytId);
      log.push(`[yt] url直接 videoId=${ytId} → ${posterUrl}`);
      work.posterUrl = posterUrl;
      work.updatedAt = Date.now();
      await saveWork(work);
      const response: Record<string, unknown> = {
        ok: true,
        posterUrl,
        source: 'youtube',
        videoId: ytId,
      };
      if (debug) response.log = log;
      return NextResponse.json(response);
    }

    // ─ パスB: 非YouTube URL → ページHTMLをフェッチして探す ─
    //   B-1. HTML内YouTube埋め込み → hqdefault
    //   B-2. og:image / twitter:image → OG画像
    const result = await fetchPageAndExtract(url, log);
    if (result) {
      work.posterUrl = result.posterUrl;
      work.updatedAt = Date.now();
      await saveWork(work);
      const response: Record<string, unknown> = {
        ok: true,
        posterUrl: result.posterUrl,
        source: result.source,
        ...(result.source === 'youtube_embed' ? { videoId: result.videoId } : {}),
      };
      if (debug) response.log = log;
      return NextResponse.json(response);
    }
  }

  const response: Record<string, unknown> = {
    ok: true,
    skipped: true,
    reason: `${urlCandidates.length}件のURLからOG画像を取得できませんでした`,
  };
  if (debug) response.log = log;
  return NextResponse.json(response);
}
