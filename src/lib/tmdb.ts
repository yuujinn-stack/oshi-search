// TMDb API クライアント
// 管理画面からの処理時のみ呼び出す（一般ユーザーのページアクセス時は使用しない）

import type { PersonWithConfig } from '@/types/person';
import type { VodProvider } from '@/types/vod';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

// 1人あたりの最大取得件数（APIコスト・AI判定コスト抑制）
const MAX_CREDITS_PER_PERSON = 60;

// 人物マッチングの最低スコア閾値（これ未満はマッチなしと扱う）
const MIN_PERSON_MATCH_SCORE = 15;

function getApiKey(): string {
  return process.env.TMDB_API_KEY ?? '';
}

// --- 内部型定義 ---

interface TmdbPersonSearchResult {
  id: number;
  name: string;
  known_for_department: string;
  popularity: number;
  known_for?: Array<{
    id: number;
    title?: string;
    name?: string;
    media_type: string;
    original_language?: string;
    genre_ids?: number[];
  }>;
}

interface TmdbPersonSearchResponse {
  results: TmdbPersonSearchResult[];
}

interface TmdbCreditItem {
  id: number;
  title?: string;          // movie (ローカライズ済み)
  name?: string;           // tv (ローカライズ済み)
  original_title?: string; // movie 原題
  original_name?: string;  // tv 原題
  media_type: string;
  character?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  vote_count?: number;
  popularity?: number;
}

interface TmdbCreditsResponse {
  cast: TmdbCreditItem[];
}

// --- 公開型 ---

export interface TmdbWorkCandidate {
  tmdbId: number;
  title: string;
  originalTitle?: string;  // 原題（タイトルと異なる場合のみセット）
  type: 'movie' | 'tv';
  releaseYear?: number;
  roleName?: string;
  overview?: string;
  posterUrl?: string;
  popularity?: number;
  voteCount?: number;
}

export interface TmdbPersonMatch {
  id: number;
  name: string;
  department?: string;  // known_for_department
  matchScore: number;
  matchDetails: string;
}

// --- 人物マッチングスコア計算 ---

// ジャンルごとの期待 known_for_department
const GENRE_EXPECTED_DEPT: Record<string, string> = {
  坂道: 'Acting',
  芸人: 'Acting',
  テレビ: 'Acting',
  俳優: 'Acting',
  アーティスト: 'Music',
};

// アニメジャンルID (TMDb: genre 16 = Animation)
const ANIMATION_GENRE_ID = 16;

// 坂道・俳優など「声優ではない」ジャンル
const NON_VOICE_GENRES = new Set(['坂道', '芸人', 'テレビ', '俳優']);

function computePersonMatchScore(
  candidate: TmdbPersonSearchResult,
  person: PersonWithConfig,
  searchQuery: string,
): { score: number; details: string } {
  let score = 0;
  const details: string[] = [];

  const dept = candidate.known_for_department;
  const genre = person.genre ?? '';
  const isNonVoice = NON_VOICE_GENRES.has(genre);

  // --- 事前チェック: アニメ声優候補を坂道・俳優ジャンルから完全除外 ---
  if (isNonVoice && candidate.known_for?.length) {
    const total = candidate.known_for.length;
    const animeCount = candidate.known_for.filter((w) =>
      w.genre_ids?.includes(ANIMATION_GENRE_ID),
    ).length;
    const animeRatio = animeCount / total;

    if (dept === 'Animation' && animeRatio > 0.5) {
      // Animation部門かつknown_forの半数超がアニメ → 声優確定・完全拒否
      return { score: -999, details: `声優完全拒否: dept=Animation,アニメ${animeCount}/${total}` };
    }
    if (animeRatio >= 1.0 && total >= 2) {
      // 全作品アニメで複数作品あり → 実質声優
      return { score: -999, details: `全作品アニメ完全拒否: アニメ${animeCount}/${total}` };
    }
  }

  // 1. 名前一致スコア (0 〜 40)
  const ourNames = [
    person.name,
    person.config.realName,
    ...(person.config.aliases ?? []),
    ...(person.config.tmdbSearchKeywords ?? []),
  ].filter((n): n is string => !!n);

  const tmdbName = candidate.name;
  const tmdbNameLower = tmdbName.toLowerCase();

  if (ourNames.some((n) => n === tmdbName || n.toLowerCase() === tmdbNameLower)) {
    score += 40;
    details.push('名前完全一致+40');
  } else if (
    searchQuery === tmdbName ||
    searchQuery.toLowerCase() === tmdbNameLower
  ) {
    score += 35;
    details.push('検索キーワード完全一致+35');
  } else if (
    ourNames.some(
      (n) =>
        tmdbNameLower.includes(n.toLowerCase()) ||
        n.toLowerCase().includes(tmdbNameLower),
    )
  ) {
    score += 20;
    details.push('名前部分一致+20');
  }

  // 2. known_for_department スコア
  const expectedDept =
    person.config.expectedDepartment ?? GENRE_EXPECTED_DEPT[genre];

  if (expectedDept) {
    if (dept === expectedDept) {
      score += 30;
      details.push(`部門一致(${dept})+30`);
    } else if (dept === 'Animation') {
      // 強化: 坂道・芸人・俳優では -50（名前一致の +40 を上回る）
      const penalty = isNonVoice ? -50 : -20;
      score += penalty;
      details.push(`Animation部門(声優系)${penalty}`);
    } else {
      if (dept === 'Acting' || dept === 'Directing' || dept === 'Sound') {
        score += 5;
        details.push(`${dept}(許容範囲)+5`);
      } else {
        score -= 5;
        details.push(`${dept}(期待外れ)-5`);
      }
    }
  } else {
    if (dept === 'Acting') {
      score += 15;
      details.push('Acting+15');
    } else if (dept === 'Animation') {
      const penalty = isNonVoice ? -30 : -10;
      score += penalty;
      details.push(`Animation${penalty}`);
    }
  }

  // 3. known_for 作品分析
  if (candidate.known_for?.length) {
    const total = candidate.known_for.length;
    const animeCount = candidate.known_for.filter((w) =>
      w.genre_ids?.includes(ANIMATION_GENRE_ID),
    ).length;
    const animeRatio = animeCount / total;

    // 日本語作品ボーナス（アニメを除いた実写日本作品のみカウント）
    // ← バグ修正: アニメ作品のjaボーナスを除外
    const realJaCount = candidate.known_for.filter(
      (w) => w.original_language === 'ja' && !w.genre_ids?.includes(ANIMATION_GENRE_ID),
    ).length;
    if (isNonVoice) {
      const realJaBonus = Math.round((realJaCount / total) * 20);
      if (realJaBonus > 0) {
        score += realJaBonus;
        details.push(`実写日本作品${realJaCount}/${total}+${realJaBonus}`);
      }
    } else {
      const jaCount = candidate.known_for.filter((w) => w.original_language === 'ja').length;
      const jaRatio = jaCount / total;
      const jaBonus = Math.round(jaRatio * 20);
      if (jaBonus > 0) {
        score += jaBonus;
        details.push(`日本作品${jaCount}/${total}+${jaBonus}`);
      } else {
        const nonJapenalty = Math.round((1 - jaRatio) * 8);
        score -= nonJapenalty;
        details.push(`非日本作品${total - jaCount}/${total}-${nonJapenalty}`);
      }
    }

    // アニメ作品比率ペナルティ
    if (animeRatio > 0.3) {
      const maxPenalty = genre === 'アーティスト' ? 12 : (isNonVoice ? 35 : 25);
      const animePenalty = Math.round(animeRatio * maxPenalty);
      score -= animePenalty;
      details.push(`アニメ多${animeCount}/${total}-${animePenalty}`);
    }
  } else {
    details.push('known_forなし(ニュートラル)');
  }

  // 4. 人気度ボーナス (0 〜 10)
  const popBonus = Math.min(Math.round(candidate.popularity / 5), 10);
  if (popBonus > 0) {
    score += popBonus;
    details.push(`人気度${candidate.popularity.toFixed(1)}+${popBonus}`);
  }

  return { score, details: details.join(', ') };
}

// --- 検索ヘルパー ---

async function searchTmdbPersonCandidates(
  query: string,
): Promise<TmdbPersonSearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `${TMDB_BASE}/search/person?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=ja-JP`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      console.log(`[tmdb] 人物検索エラー HTTP ${res.status}: "${query}"`);
      return [];
    }
    const data = (await res.json()) as TmdbPersonSearchResponse;
    return data.results ?? [];
  } catch (err) {
    console.error(`[tmdb] 人物検索例外: "${query}"`, err);
    return [];
  }
}

// --- 公開関数 ---

// 人物マッチングスコアで最適な TMDb 人物を特定する
// tmdbPersonId が設定されている場合はそれを直接返す
export async function findBestTmdbPerson(
  person: PersonWithConfig,
): Promise<TmdbPersonMatch | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('[tmdb] TMDB_API_KEY 未設定');
    return null;
  }

  // tmdbPersonId が設定されている場合は固定ID を直接使用（同名別人対策）
  if (person.config.tmdbPersonId) {
    console.log(
      `[tmdb] tmdbPersonId固定使用: "${person.name}" → id=${person.config.tmdbPersonId}`,
    );
    return {
      id: person.config.tmdbPersonId,
      name: person.name,
      matchScore: 100,
      matchDetails: 'tmdbPersonId直接指定',
    };
  }

  // 検索クエリ一覧（重複なし）
  const searchQueries = [
    person.name,
    ...(person.config.aliases ?? []),
    ...(person.config.tmdbSearchKeywords ?? []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const allCandidates: Array<TmdbPersonSearchResult & { matchScore: number; matchDetails: string; fromQuery: string }> =
    [];
  const seenIds = new Set<number>();

  for (const query of searchQueries) {
    const results = await searchTmdbPersonCandidates(query);
    for (const r of results) {
      if (seenIds.has(r.id)) continue;
      seenIds.add(r.id);
      const { score, details } = computePersonMatchScore(r, person, query);
      allCandidates.push({ ...r, matchScore: score, matchDetails: details, fromQuery: query });
    }
  }

  if (!allCandidates.length) {
    console.log(`[tmdb] 人物検索: 候補なし "${person.name}"`);
    return null;
  }

  // スコア降順ソート
  allCandidates.sort((a, b) => b.matchScore - a.matchScore);

  // デバッグログ（上位3件）
  console.log(`[tmdb] 人物マッチング候補 "${person.name}":`);
  allCandidates.slice(0, 3).forEach((c, i) => {
    console.log(
      `  ${i + 1}. id=${c.id} name="${c.name}" dept=${c.known_for_department} ` +
        `pop=${c.popularity.toFixed(1)} score=${c.matchScore} [${c.matchDetails}]`,
    );
  });

  const best = allCandidates[0];
  if (best.matchScore < MIN_PERSON_MATCH_SCORE) {
    console.log(
      `[tmdb] マッチ不十分: "${person.name}" 最高スコア=${best.matchScore} < 閾値${MIN_PERSON_MATCH_SCORE}`,
    );
    return null;
  }

  console.log(
    `[tmdb] 人物確定: "${person.name}" → id=${best.id} name="${best.name}" dept=${best.known_for_department} score=${best.matchScore}`,
  );
  return {
    id: best.id,
    name: best.name,
    department: best.known_for_department,
    matchScore: best.matchScore,
    matchDetails: best.matchDetails,
  };
}

// person_id から combined_credits を取得（人気順ソート・件数制限あり）
export async function getTmdbCredits(personId: number): Promise<TmdbWorkCandidate[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `${TMDB_BASE}/person/${personId}/combined_credits?api_key=${apiKey}&language=ja-JP`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      console.log(`[tmdb] クレジット取得エラー HTTP ${res.status}: personId=${personId}`);
      return [];
    }
    const data = (await res.json()) as TmdbCreditsResponse;
    const credits: TmdbWorkCandidate[] = [];

    for (const item of data.cast ?? []) {
      if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;
      const title = item.title ?? item.name ?? '';
      if (!title) continue;

      const dateStr = item.release_date ?? item.first_air_date ?? '';
      const releaseYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : undefined;

      const originalTitle = (item.original_title ?? item.original_name) || undefined;
      credits.push({
        tmdbId: item.id,
        title,
        // タイトルと原題が異なる場合のみ originalTitle をセット
        originalTitle: originalTitle && originalTitle !== title ? originalTitle : undefined,
        type: item.media_type === 'movie' ? 'movie' : 'tv',
        releaseYear: releaseYear && !isNaN(releaseYear) ? releaseYear : undefined,
        roleName: item.character || undefined,
        overview: item.overview || undefined,
        posterUrl: item.poster_path ? `${POSTER_BASE}${item.poster_path}` : undefined,
        popularity: item.popularity,
        voteCount: item.vote_count,
      });
    }

    // popularity 降順ソート → 人気作品を優先
    credits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    const limited = credits.slice(0, MAX_CREDITS_PER_PERSON);
    console.log(`[tmdb] クレジット取得: personId=${personId} → ${credits.length}件（上位${limited.length}件を使用）`);
    return limited;
  } catch (err) {
    console.error(`[tmdb] クレジット取得例外: personId=${personId}`, err);
    return [];
  }
}

// --- Watch Providers ---

interface WatchProvidersResult {
  link?: string;
  flatrate?: WatchProviderItem[];
  buy?: WatchProviderItem[];
  rent?: WatchProviderItem[];
  free?: WatchProviderItem[];
  ads?: WatchProviderItem[];
}

interface WatchProviderItem {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  display_priority: number;
}

interface WatchProvidersResponse {
  results?: Record<string, WatchProvidersResult>;
}

export interface WatchProvidersDebug {
  tmdbId: number;
  type: 'movie' | 'tv';
  apiUrl: string;
  httpStatus?: number;
  availableCountries?: string[];
  jpExists: boolean;
  jpFlatrate: string[];
  jpFree: string[];
  jpAds: string[];
  jpBuy: string[];
  jpRent: string[];
  jpLink?: string;
  reason?: string;
}

// 作品の配信サービス情報を取得（日本 JP）
export async function getWatchProviders(
  tmdbId: number,
  type: 'movie' | 'tv',
  countryCode = 'JP',
): Promise<{ providers: VodProvider[]; link?: string; debug: WatchProvidersDebug }> {
  const apiKey = getApiKey();
  const endpoint = type === 'movie'
    ? `${TMDB_BASE}/movie/${tmdbId}/watch/providers`
    : `${TMDB_BASE}/tv/${tmdbId}/watch/providers`;
  const apiUrl = `${endpoint}?api_key=***`;

  const emptyDebug: WatchProvidersDebug = {
    tmdbId, type, apiUrl,
    jpExists: false, jpFlatrate: [], jpFree: [], jpAds: [], jpBuy: [], jpRent: [],
  };

  if (!apiKey) {
    return { providers: [], debug: { ...emptyDebug, reason: 'TMDB_API_KEY未設定' } };
  }

  try {
    const res = await fetch(`${endpoint}?api_key=${apiKey}`, { cache: 'no-store' });
    const debug: WatchProvidersDebug = { ...emptyDebug, httpStatus: res.status };

    if (!res.ok) {
      const reason = `HTTP ${res.status}`;
      console.log(`[tmdb] WatchProviders取得エラー ${reason}: ${type}/${tmdbId}`);
      return { providers: [], debug: { ...debug, reason } };
    }

    const data = (await res.json()) as WatchProvidersResponse;
    const availableCountries = Object.keys(data.results ?? {});
    debug.availableCountries = availableCountries;

    const countryData = data.results?.[countryCode];
    if (!countryData) {
      const reason = `${countryCode}向けデータなし（利用可能: ${availableCountries.slice(0, 5).join(',')}${availableCountries.length > 5 ? '...' : ''}）`;
      console.log(`[tmdb] WatchProviders: ${reason} ${type}/${tmdbId}`);
      return { providers: [], debug: { ...debug, reason } };
    }

    debug.jpExists = true;
    debug.jpFlatrate = (countryData.flatrate ?? []).map((p) => p.provider_name);
    debug.jpFree = (countryData.free ?? []).map((p) => p.provider_name);
    debug.jpAds = (countryData.ads ?? []).map((p) => p.provider_name);
    debug.jpBuy = (countryData.buy ?? []).map((p) => p.provider_name);
    debug.jpRent = (countryData.rent ?? []).map((p) => p.provider_name);
    debug.jpLink = countryData.link;

    const providers: VodProvider[] = [];
    const typeMap: [keyof WatchProvidersResult, VodProvider['type']][] = [
      ['flatrate', 'flatrate'],
      ['free', 'free'],
      ['ads', 'ads'],
      ['buy', 'buy'],
      ['rent', 'rent'],
    ];

    for (const [key, providerType] of typeMap) {
      const items = countryData[key] as WatchProviderItem[] | undefined;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (providers.some((p) => p.providerId === item.provider_id)) continue;
        providers.push({
          providerId: item.provider_id,
          providerName: item.provider_name,
          logoPath: item.logo_path,
          displayPriority: item.display_priority,
          type: providerType,
          countryCode,
          source: 'tmdb_watch_provider',
          link: countryData.link,
        });
      }
    }

    providers.sort((a, b) => (a.displayPriority ?? 999) - (b.displayPriority ?? 999));

    console.log(
      `[tmdb] WatchProviders: ${type}/${tmdbId} → ${providers.length}件` +
      (providers.length > 0 ? ` (${providers.map((p) => p.providerName).join(', ')})` : ` JPデータあり・配信なし`),
    );
    if (providers.length === 0) {
      debug.reason = 'JPデータあるが配信サービス登録なし';
    }
    return { providers, link: countryData.link, debug };
  } catch (err) {
    console.error(`[tmdb] WatchProviders例外: ${type}/${tmdbId}`, err);
    return { providers: [], debug: { ...emptyDebug, reason: `例外: ${String(err)}` } };
  }
}
