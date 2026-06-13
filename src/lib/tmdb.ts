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

function computePersonMatchScore(
  candidate: TmdbPersonSearchResult,
  person: PersonWithConfig,
  searchQuery: string,
): { score: number; details: string } {
  let score = 0;
  const details: string[] = [];

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

  // 2. known_for_department スコア (-20 〜 +30)
  const dept = candidate.known_for_department;
  const expectedDept =
    person.config.expectedDepartment ?? GENRE_EXPECTED_DEPT[person.genre ?? ''];

  if (expectedDept) {
    if (dept === expectedDept) {
      score += 30;
      details.push(`部門一致(${dept})+30`);
    } else if (dept === 'Animation') {
      // 声優系は坂道・芸人・俳優にとって強いネガティブシグナル
      score -= 20;
      details.push('Animation部門(声優系)-20');
    } else {
      // 期待部門と違うが許容範囲（Acting期待でMusicなど）
      if (dept === 'Acting' || dept === 'Directing' || dept === 'Sound') {
        score += 5;
        details.push(`${dept}(許容範囲)+5`);
      } else {
        score -= 5;
        details.push(`${dept}(期待外れ)-5`);
      }
    }
  } else {
    // expectedDept 不明: Acting と Animation で簡易判定
    if (dept === 'Acting') {
      score += 15;
      details.push('Acting+15');
    } else if (dept === 'Animation') {
      score -= 10;
      details.push('Animation-10');
    }
  }

  // 3. known_for 作品分析 (-25 〜 +20)
  if (candidate.known_for?.length) {
    const total = candidate.known_for.length;
    const jaCount = candidate.known_for.filter(
      (w) => w.original_language === 'ja',
    ).length;
    const animeCount = candidate.known_for.filter((w) =>
      w.genre_ids?.includes(ANIMATION_GENRE_ID),
    ).length;

    // 日本語作品比率ボーナス（日本人タレントの特定に有効）
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

    // アニメ作品比率ペナルティ（アーティストは半減）
    const animeRatio = animeCount / total;
    if (animeRatio > 0.3) {
      const maxPenalty = person.genre === 'アーティスト' ? 12 : 25;
      const animePenalty = Math.round(animeRatio * maxPenalty);
      score -= animePenalty;
      details.push(`アニメ多${animeCount}/${total}-${animePenalty}`);
    }
  } else {
    // known_for なし: まだデータが少ない新人等の可能性あり（ニュートラル）
    details.push('known_forなし(ニュートラル)');
  }

  // 4. 人気度ボーナス (0 〜 10) タイブレーカー
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

// 作品の配信サービス情報を取得（日本 JP）
export async function getWatchProviders(
  tmdbId: number,
  type: 'movie' | 'tv',
  countryCode = 'JP',
): Promise<{ providers: VodProvider[]; link?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) return { providers: [] };

  const endpoint = type === 'movie'
    ? `${TMDB_BASE}/movie/${tmdbId}/watch/providers`
    : `${TMDB_BASE}/tv/${tmdbId}/watch/providers`;

  try {
    const res = await fetch(`${endpoint}?api_key=${apiKey}`, { cache: 'no-store' });
    if (!res.ok) {
      console.log(`[tmdb] WatchProviders取得エラー HTTP ${res.status}: ${type}/${tmdbId}`);
      return { providers: [] };
    }

    const data = (await res.json()) as WatchProvidersResponse;
    const countryData = data.results?.[countryCode];
    if (!countryData) {
      console.log(`[tmdb] WatchProviders: ${countryCode}向けデータなし ${type}/${tmdbId}`);
      return { providers: [] };
    }

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
        // 重複排除（同じプロバイダーが複数タイプに含まれる場合、flatrateを優先）
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

    // displayPriority 昇順ソート（数値が小さいほど重要）
    providers.sort((a, b) => (a.displayPriority ?? 999) - (b.displayPriority ?? 999));

    console.log(
      `[tmdb] WatchProviders: ${type}/${tmdbId} → ${providers.length}件 (${providers.map((p) => p.providerName).join(', ')})`,
    );
    return { providers, link: countryData.link };
  } catch (err) {
    console.error(`[tmdb] WatchProviders例外: ${type}/${tmdbId}`, err);
    return { providers: [] };
  }
}
