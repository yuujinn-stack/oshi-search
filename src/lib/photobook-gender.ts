// 写真集機能: 人物・グループのgender絞り込み（純粋関数のみ）。
//
// 重要: このファイルはDBアクセスを一切行わない純粋関数のみで構成する
// （管理画面のクライアントコンポーネントから直接importできるようにするため。
//   DB書き込みを伴う一括保存処理は photobook-gender-write.ts に分離してある。
//   過去にClient bundleへDB依存が混入する不具合があったため、この分離を厳守すること）。
//
// 重要な設計方針:
// - 「女優だから自動でfemale」「俳優だから自動でmale」のような自動判定処理は一切行わない。
//   既存ジャンル情報はあくまで「絞り込みで対象を探しやすくする」ためだけに使う。
// - person_meta.gender > group_meta.gender > 未分類 という既存の解決順位は変更しない
//   （このファイルは値の「絞り込み」のみを担当し、解決ロジックには触れない）。

import type { PersonGenderRow, GroupGenderRow } from './photobook-store';

// ── 人物一覧の絞り込み（純粋関数） ────────────────────────────────────────────────

export type PersonGenderFilterValue = 'all' | 'unset' | 'female' | 'male';
export type PersonGenreFilterValue = 'all' | '女優' | '俳優' | 'アイドル' | '歌手' | 'その他';
export type GroupAffiliationFilterValue = 'all' | 'has_group' | 'no_group';

export interface PersonGenderFilters {
  query?: string;
  gender?: PersonGenderFilterValue;
  genre?: PersonGenreFilterValue;
  groupAffiliation?: GroupAffiliationFilterValue;
  hasCandidatesOnly?: boolean;
}

const KNOWN_GENRE_FILTERS = ['女優', '俳優', 'アイドル', '歌手'] as const;

function personGenreValues(row: PersonGenderRow): string[] {
  return [row.genre, row.primaryGenre, ...row.genres].filter((v): v is string => !!v);
}

/** 人物のジャンル絞り込み判定（'その他' は既知ジャンルに一つも一致しない場合） */
function matchesGenreFilter(row: PersonGenderRow, genre: PersonGenreFilterValue): boolean {
  if (genre === 'all') return true;
  const values = personGenreValues(row);
  if (genre === 'その他') return !KNOWN_GENRE_FILTERS.some((g) => values.includes(g));
  return values.includes(genre);
}

export function filterPersonGenderRows(
  rows: readonly PersonGenderRow[],
  filters: PersonGenderFilters,
): PersonGenderRow[] {
  const q = filters.query?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (q && !row.personName.toLowerCase().includes(q)) return false;
    if (filters.gender && filters.gender !== 'all') {
      if (filters.gender === 'unset' && row.gender !== null) return false;
      if ((filters.gender === 'female' || filters.gender === 'male') && row.gender !== filters.gender) return false;
    }
    if (filters.genre && !matchesGenreFilter(row, filters.genre)) return false;
    if (filters.groupAffiliation === 'has_group' && !row.groupName) return false;
    if (filters.groupAffiliation === 'no_group' && row.groupName) return false;
    if (filters.hasCandidatesOnly && row.photobookCandidateCount <= 0) return false;
    return true;
  });
}

// デフォルトの絞り込み（未設定 + 写真集候補ありのみ）
export const DEFAULT_PERSON_GENDER_FILTERS: PersonGenderFilters = {
  gender: 'unset',
  hasCandidatesOnly: true,
};

// ── グループ一覧の絞り込み（純粋関数） ────────────────────────────────────────────

export interface GroupGenderFilters {
  query?: string;
  gender?: PersonGenderFilterValue;
  hasCandidatesOnly?: boolean;
}

export function filterGroupGenderRows(
  rows: readonly GroupGenderRow[],
  filters: GroupGenderFilters,
): GroupGenderRow[] {
  const q = filters.query?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (q && !row.groupName.toLowerCase().includes(q)) return false;
    if (filters.gender && filters.gender !== 'all') {
      if (filters.gender === 'unset' && row.gender !== null) return false;
      if ((filters.gender === 'female' || filters.gender === 'male') && row.gender !== filters.gender) return false;
    }
    if (filters.hasCandidatesOnly && row.photobookCandidateCount <= 0) return false;
    return true;
  });
}
