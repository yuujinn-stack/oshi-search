// VOD情報を works.vod_data / workId へ紐付ける際の、決定論的な共通マッチングロジック。
//
// 背景: 同名の別作品（例: 「アクトレス」）が存在する場合、タイトルだけを条件に
// VOD情報を紐付けると、本来無関係な作品へ配信情報が混入する危険がある。
// この関数群は、CSVインポート系の複数ルート（work-vod-import / vod-title-import）から
// 共通で利用し、「本当に同一作品と確定できる場合のみ」自動紐付けを許可する。
//
// 確定条件（Level 1-7方式）:
//   1. タイトル一致だけでは絶対に確定しない
//   2. 候補を絞り込んだ結果、実workIdが1種類だけに定まる場合のみ「同一作品」と確定する
//      （同一workIdに複数人物の行が存在するのは正常なデータ構造であり、これは曖昧ではない）
//   3. 絞り込み後も異なるworkIdが2件以上残る場合は、同名別作品の可能性として
//      自動紐付けを禁止し、呼び出し側でambiguousとして報告する（DBには一切書き込まない）

export interface VodWorkLike {
  id: string;
  title: string;
  originalTitle?: string;
  type: string;
  releaseYear?: number;
}

export interface VodMatchQuery {
  workTitle: string;
  workType?: string;
  releaseYear?: number;
}

export interface VodMatchCandidate {
  personName: string;
  workId: string;
  title: string;
  workType?: string;
  releaseYear?: number;
}

export type VodMatchOutcome =
  | { status: 'matched'; workId: string; personNames: string[] }
  | { status: 'ambiguous'; candidateWorkIds: string[]; candidates: VodMatchCandidate[] }
  | { status: 'none' };

// ── タイトル正規化 ──────────────────────────────────────────────────────────
// work-vod-import / vod-title-import に重複していた同一実装を集約したもの。
// 全角→半角・空白除去・記号除去などの安全な正規化のみ行い、続編・シーズン番号・
// 年・サブタイトル（THE MOVIE・劇場版等）は削除しない（別作品を誤って同一視しないため）。
export function normalizeVodMatchTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[「」『』【】〈〉《》（）()[\]、。・～〜~]/g, '');
}

// ── タイトル（＋任意でtype・releaseYear）による候補絞り込み ─────────────────
// 呼び出し側が既に人物単位でスコープ済みの作品一覧（getAllWorks(personName)等）を渡す想定。
// releaseYearが指定された場合のみ年で絞り込む（未指定の候補作品側releaseYearも同様に
// 「絞り込み材料がない」ものとして扱い、除外しない＝データ不足で誤って弾かない）。
export function matchWorksByTitle<T extends VodWorkLike>(
  works: T[],
  query: VodMatchQuery,
): T[] {
  const normQuery = normalizeVodMatchTitle(query.workTitle);
  return works.filter((w) => {
    const titleMatches =
      normalizeVodMatchTitle(w.title) === normQuery ||
      (!!w.originalTitle && normalizeVodMatchTitle(w.originalTitle) === normQuery);
    if (!titleMatches) return false;
    if (query.workType && w.type !== query.workType) return false;
    if (query.releaseYear && w.releaseYear && w.releaseYear !== query.releaseYear) return false;
    return true;
  });
}

// ── 候補一覧 → 確定 / 曖昧 / 該当なし の判定 ─────────────────────────────────
// 候補に含まれる実workIdが1種類だけなら確定（同一workIdへの複数人物行は曖昧ではない）。
// 2種類以上のworkIdが残る場合は、人物・年・type等で一意に絞り込めなかったとみなし、
// 自動確定しない（呼び出し側でneeds_review相当として扱う）。
export function resolveVodMatch(candidates: VodMatchCandidate[]): VodMatchOutcome {
  if (candidates.length === 0) return { status: 'none' };

  const distinctWorkIds = [...new Set(candidates.map((c) => c.workId))];
  if (distinctWorkIds.length === 1) {
    return {
      status: 'matched',
      workId: distinctWorkIds[0],
      personNames: [...new Set(candidates.map((c) => c.personName))],
    };
  }
  return { status: 'ambiguous', candidateWorkIds: distinctWorkIds, candidates };
}
