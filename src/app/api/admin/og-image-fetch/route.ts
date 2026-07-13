import { NextRequest, NextResponse } from 'next/server';
import { getWork, saveWork } from '@/lib/work-store';

// POST /api/admin/og-image-fetch
// body: { personName, workId, debug?, force? }
//
// TMDb画像・posterUrlとは独立したogImageUrlフィールドに保存する。
// force=false: ogImageUrl未設定の作品のみ対象
// force=true : ogImageUrlが存在しても再取得して上書き（作品カードの「再取得」用）
//
// レスポンス:
//   成功:       { ok: true, ogImageUrl, ogSourceUrl, source, videoId? }
//   スキップ:   { ok: true, skipped: true, reason: 'ogImageUrl既存' }
//   URL候補なし: { ok: false, skipped: true, reason: 'URL候補なし' }
//   取得失敗:   { ok: false, reason: string }

// ─── YouTube 動画ID バリデーション ───────────────────────────────────────────────
function isValidYouTubeVideoId(id: string | null | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

// ─── YouTube URL 判定 ─────────────────────────────────────────────────────────
function isYouTubeUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'youtu.be' || h.includes('youtube.com');
  } catch { return false; }
}

// ─── URL から YouTube 動画ID を抽出 ──────────────────────────────────────────
function extractYouTubeVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split('?')[0];
      return isValidYouTubeVideoId(id) ? id : null;
    }
    if (u.hostname.includes('youtube.com')) {
      const path = u.pathname;
      if (
        path.startsWith('/channel/') ||
        path.startsWith('/c/') ||
        path.startsWith('/@') ||
        path === '/playlist'
      ) return null;
      const v = u.searchParams.get('v');
      if (v !== null) return isValidYouTubeVideoId(v) ? v : null;
      const m = path.match(/\/(shorts|live|embed|v)\/([^/?]+)/);
      if (m?.[2]) return isValidYouTubeVideoId(m[2]) ? m[2] : null;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── HTML 内から YouTube 動画ID を抽出 ─────────────────────────────────────────
function extractYouTubeIdFromHtml(html: string): string | null {
  const patterns = [
    /youtube\.com\/embed\/([^"'/?&\s]+)/g,
    /youtube\.com\/watch\?v=([^"'&\s]+)/g,
    /youtu\.be\/([^"'/?&\s]+)/g,
    /youtube\.com\/shorts\/([^"'/?&\s]+)/g,
    /youtube\.com\/live\/([^"'/?&\s]+)/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null) {
      if (isValidYouTubeVideoId(m[1])) return m[1];
    }
  }
  return null;
}

// ─── YouTube サムネイルURL ───────────────────────────────────────────────────
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
type PageExtractResult =
  | { ok: true; source: 'youtube_embed'; ogImageUrl: string; videoId: string }
  | { ok: true; source: 'og'; ogImageUrl: string }
  | { ok: false; reason: 'HTML取得失敗' | 'YouTube IDなし・OG画像なし' };

async function fetchPageAndExtract(
  url: string,
  log: string[],
): Promise<PageExtractResult> {
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
    if (!res.ok) {
      log.push(`[page] 非200 → HTML取得失敗`);
      return { ok: false, reason: 'HTML取得失敗' };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      log.push(`[page] Content-Type=${contentType} → HTMLではない`);
      return { ok: false, reason: 'HTML取得失敗' };
    }

    const html = (await res.text()).slice(0, 100_000);

    log.push(`[page] YouTube埋め込みを検索中...`);
    const ytId = extractYouTubeIdFromHtml(html);
    if (ytId) {
      const ogImageUrl = youTubeThumbnailUrl(ytId);
      log.push(`[page] YouTube埋め込み発見 videoId=${ytId} → ${ogImageUrl}`);
      return { ok: true, source: 'youtube_embed', ogImageUrl, videoId: ytId };
    }
    log.push(`[page] YouTube埋め込みなし → OGタグを検索`);

    const ogPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ];
    for (const pattern of ogPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) {
        const ogImageUrl = resolveUrl(m[1], url);
        log.push(`[page] og:image=${ogImageUrl}`);
        return { ok: true, source: 'og', ogImageUrl };
      }
    }

    const twitterPatterns = [
      /<meta[^>]+(?:name|property)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']twitter:image(?::src)?["']/i,
    ];
    for (const pattern of twitterPatterns) {
      const m = html.match(pattern);
      if (m?.[1]) {
        const ogImageUrl = resolveUrl(m[1], url);
        log.push(`[page] twitter:image=${ogImageUrl}`);
        return { ok: true, source: 'og', ogImageUrl };
      }
    }

    log.push(`[page] YouTube埋め込みなし・OGタグなし`);
    return { ok: false, reason: 'YouTube IDなし・OG画像なし' };
  } catch (e) {
    log.push(`[page] 例外=${String(e)}`);
    return { ok: false, reason: 'HTML取得失敗' };
  } finally {
    clearTimeout(timer);
  }
}

// ─── ハンドラー ────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { personName, workId, debug, force } = body as {
    personName?: string;
    workId?: string;
    debug?: boolean;
    force?: boolean;
  };

  const isDev = process.env.NODE_ENV === 'development';

  if (!personName || !workId) {
    return NextResponse.json({ error: 'personName, workId が必要です' }, { status: 400 });
  }

  const log: string[] = [];

  const work = await getWork(personName, workId);
  if (!work) {
    return NextResponse.json({ error: '作品が見つかりません' }, { status: 404 });
  }

  // force=false: ogImageUrl が既存ならスキップ（TMDb posterUrl は無視）
  if (work.ogImageUrl && !force) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'ogImageUrl既存' });
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

  if (isDev) {
    log.push(`[debug] personName=${personName} workId=${workId} force=${force}`);
    log.push(`[debug] posterUrl=${work.posterUrl ?? 'なし'} ogImageUrl=${work.ogImageUrl ?? 'なし'}`);
    log.push(`[debug] URL候補=${urlCandidates.join(', ') || 'なし'}`);
  }

  if (urlCandidates.length === 0) {
    log.push(`URL候補なし`);
    const now = Date.now();
    work.ogImageStatus = 'skipped';
    work.ogImageFetchedAt = now;
    work.ogImageError = 'URL候補なし';
    work.updatedAt = now;
    await saveWork(work);
    const res: Record<string, unknown> = { ok: false, skipped: true, reason: 'URL候補なし' };
    if (debug || isDev) res.log = log;
    return NextResponse.json(res);
  }

  log.push(`candidates=${urlCandidates.length}`);

  let lastFailReason = 'YouTube IDなし・OG画像なし';

  for (const url of urlCandidates) {
    log.push(`url=${url}`);

    // パスA: URL自体がYouTube → hqdefault を即保存
    const ytId = extractYouTubeVideoId(url);
    if (ytId) {
      const ogImageUrl = youTubeThumbnailUrl(ytId);
      log.push(`[yt] url直接 videoId=${ytId} → ${ogImageUrl}`);
      const now = Date.now();
      work.ogImageUrl = ogImageUrl;
      work.ogSourceUrl = url;
      work.ogImageFetchedAt = now;
      work.ogImageStatus = 'success';
      work.ogImageError = undefined;
      work.updatedAt = now;
      await saveWork(work);
      const response: Record<string, unknown> = {
        ok: true, ogImageUrl, ogSourceUrl: url, source: 'youtube', videoId: ytId,
      };
      if (debug || isDev) response.log = log;
      return NextResponse.json(response);
    }

    // パスA': YouTube URLだが有効なvideo IDなし（プレイリスト/チャンネル等）
    if (isYouTubeUrl(url)) {
      lastFailReason = 'プレイリスト/チャンネルURLのため動画サムネイル取得不可';
      log.push(`[yt] YouTube URLだが有効なvideo IDなし → スキップ`);
      continue;
    }

    // パスB: 非YouTube URL → ページHTMLをフェッチ
    const result = await fetchPageAndExtract(url, log);
    if (result.ok) {
      const now = Date.now();
      work.ogImageUrl = result.ogImageUrl;
      work.ogSourceUrl = url;
      work.ogImageFetchedAt = now;
      work.ogImageStatus = 'success';
      work.ogImageError = undefined;
      work.updatedAt = now;
      await saveWork(work);
      const response: Record<string, unknown> = {
        ok: true,
        ogImageUrl: result.ogImageUrl,
        ogSourceUrl: url,
        source: result.source,
        ...(result.source === 'youtube_embed' ? { videoId: result.videoId } : {}),
      };
      if (debug || isDev) response.log = log;
      return NextResponse.json(response);
    }

    lastFailReason = result.reason;
  }

  // 全URL失敗
  const now = Date.now();
  work.ogImageStatus = 'failed';
  work.ogImageFetchedAt = now;
  work.ogImageError = lastFailReason;
  work.updatedAt = now;
  await saveWork(work);

  const response: Record<string, unknown> = { ok: false, reason: lastFailReason };
  if (debug || isDev) response.log = log;
  return NextResponse.json(response);
}
