// TMDb API クライアント
// 管理画面からの処理時のみ呼び出す（一般ユーザーのページアクセス時は使用しない）

const TMDB_BASE = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

// 1人あたりの最大取得件数（APIコスト・AI判定コスト抑制）
const MAX_CREDITS_PER_PERSON = 60;

function getApiKey(): string {
  return process.env.TMDB_API_KEY ?? '';
}

// --- 内部型定義 ---

interface TmdbPersonSearchResult {
  id: number;
  name: string;
  known_for_department: string;
  popularity: number;
}

interface TmdbPersonSearchResponse {
  results: TmdbPersonSearchResult[];
}

interface TmdbCreditItem {
  id: number;
  title?: string;        // movie
  name?: string;         // tv
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
  type: 'movie' | 'tv';
  releaseYear?: number;
  roleName?: string;
  overview?: string;
  posterUrl?: string;
  popularity?: number;
  voteCount?: number;
}

// 人物名で TMDb 検索して person_id を返す
export async function searchTmdbPerson(name: string): Promise<number | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log('[tmdb] TMDB_API_KEY 未設定');
    return null;
  }
  try {
    const res = await fetch(
      `${TMDB_BASE}/search/person?api_key=${apiKey}&query=${encodeURIComponent(name)}&language=ja-JP`,
      { cache: 'no-store' },
    );
    if (!res.ok) {
      console.log(`[tmdb] 人物検索エラー HTTP ${res.status}: "${name}"`);
      return null;
    }
    const data = (await res.json()) as TmdbPersonSearchResponse;
    if (!data.results?.length) {
      console.log(`[tmdb] 人物検索: 結果なし "${name}"`);
      return null;
    }
    const person = data.results[0];
    console.log(
      `[tmdb] 人物検索ヒット: "${name}" → id=${person.id} name="${person.name}" popularity=${person.popularity.toFixed(1)}`,
    );
    return person.id;
  } catch (err) {
    console.error(`[tmdb] 人物検索例外: "${name}"`, err);
    return null;
  }
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

      credits.push({
        tmdbId: item.id,
        title,
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
