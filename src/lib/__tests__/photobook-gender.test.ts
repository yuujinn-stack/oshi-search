import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  filterPersonGenderRows,
  filterGroupGenderRows,
  DEFAULT_PERSON_GENDER_FILTERS,
  type PersonGenderFilters,
} from '../photobook-gender';
import type { PersonGenderRow, GroupGenderRow } from '../photobook-store';

function personRow(overrides: Partial<PersonGenderRow> = {}): PersonGenderRow {
  return {
    personName: '人物A',
    groupName: '',
    genre: 'タレント',
    primaryGenre: null,
    genres: [],
    gender: null,
    photobookCandidateCount: 0,
    ...overrides,
  };
}

function groupRow(overrides: Partial<GroupGenderRow> = {}): GroupGenderRow {
  return {
    groupName: 'グループA',
    gender: null,
    memberCount: 3,
    photobookCandidateCount: 0,
    ...overrides,
  };
}

describe('filterPersonGenderRows', () => {
  it('未設定人物一覧取得: gender=unset で personMeta.gender が未設定の人物のみ返す', () => {
    const rows = [
      personRow({ personName: '人物A', gender: null }),
      personRow({ personName: '人物B', gender: 'female' }),
      personRow({ personName: '人物C', gender: 'male' }),
    ];
    const filters: PersonGenderFilters = { gender: 'unset' };
    const result = filterPersonGenderRows(rows, filters);
    expect(result.map((r) => r.personName)).toEqual(['人物A']);
  });

  it('ジャンル絞り込み: genre=女優 は genre/primaryGenre/genres のいずれかに「女優」を含む人物のみ返す', () => {
    const rows = [
      personRow({ personName: '人物A', genre: '女優' }),
      personRow({ personName: '人物B', genre: 'タレント', primaryGenre: '女優' }),
      personRow({ personName: '人物C', genre: 'タレント', genres: ['歌手', '女優'] }),
      personRow({ personName: '人物D', genre: 'タレント' }),
    ];
    const result = filterPersonGenderRows(rows, { genre: '女優' });
    expect(result.map((r) => r.personName)).toEqual(['人物A', '人物B', '人物C']);
  });

  it('写真集候補あり絞り込み: hasCandidatesOnly=true は候補件数が0の人物を除外する', () => {
    const rows = [
      personRow({ personName: '人物A', photobookCandidateCount: 0 }),
      personRow({ personName: '人物B', photobookCandidateCount: 3 }),
    ];
    const result = filterPersonGenderRows(rows, { hasCandidatesOnly: true });
    expect(result.map((r) => r.personName)).toEqual(['人物B']);
  });

  it('DEFAULT_PERSON_GENDER_FILTERS は 未設定+写真集候補ありのみ をデフォルトとする', () => {
    const rows = [
      personRow({ personName: '人物A', gender: null, photobookCandidateCount: 0 }),
      personRow({ personName: '人物B', gender: null, photobookCandidateCount: 2 }),
      personRow({ personName: '人物C', gender: 'female', photobookCandidateCount: 5 }),
    ];
    const result = filterPersonGenderRows(rows, DEFAULT_PERSON_GENDER_FILTERS);
    expect(result.map((r) => r.personName)).toEqual(['人物B']);
  });

  it('絞り込みだけではgender値を一切変更しない（副作用なし）', () => {
    const rows = [personRow({ personName: '人物A', gender: null })];
    filterPersonGenderRows(rows, { genre: '女優', gender: 'unset', hasCandidatesOnly: true });
    expect(rows[0].gender).toBeNull();
  });
});

describe('filterGroupGenderRows', () => {
  it('複数グループ一括設定の対象探索: gender=unset で未設定グループのみ返す', () => {
    const rows = [
      groupRow({ groupName: '日向坂46', gender: null }),
      groupRow({ groupName: '櫻坂46', gender: null }),
      groupRow({ groupName: '欅坂46', gender: 'female' }),
    ];
    const result = filterGroupGenderRows(rows, { gender: 'unset' });
    expect(result.map((r) => r.groupName)).toEqual(['日向坂46', '櫻坂46']);
  });

  it('写真集候補あり絞り込み', () => {
    const rows = [
      groupRow({ groupName: 'グループA', photobookCandidateCount: 0 }),
      groupRow({ groupName: 'グループB', photobookCandidateCount: 4 }),
    ];
    const result = filterGroupGenderRows(rows, { hasCandidatesOnly: true });
    expect(result.map((r) => r.groupName)).toEqual(['グループB']);
  });
});

// ── DB書き込み層（bulkSetPersonGender / bulkSetGroupGender）──────────────────────
// @/db/client の db.execute をモックし、実DBに触れずに検証する
// （src/lib/__tests__/work-store-manual-image.test.ts と同じモック方針）。
// 現在の実装は gender/updated_at 列だけを対象にした単一SQL文（INSERT..ON CONFLICT /
// UPDATE）で一括処理するため、db.execute の呼び出し回数は常に1回（人数分ループしない）。

const dbMockState = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { execute: dbMockState.execute },
}));

const { bulkSetPersonGender, bulkSetGroupGender } = await import('../photobook-gender-write');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulkSetPersonGender', () => {
  it('複数人物female一括設定: 1回のSQL文で一括保存し、RETURNING件数を返す', async () => {
    dbMockState.execute.mockResolvedValue({ rows: [{ person_name: '人物A' }, { person_name: '人物B' }] });
    const result = await bulkSetPersonGender(['人物A', '人物B'], 'female');
    expect(result.updated).toBe(2);
    // ループで人数分呼ばれるのではなく、1回のアトミックなSQL文で処理される
    expect(dbMockState.execute).toHaveBeenCalledTimes(1);
  });

  it('複数人物male一括設定: gender=male が保存される', async () => {
    dbMockState.execute.mockResolvedValue({ rows: [{ person_name: '人物C' }] });
    const result = await bulkSetPersonGender(['人物C'], 'male');
    expect(result.updated).toBe(1);
    expect(dbMockState.execute).toHaveBeenCalledTimes(1);
  });

  it('未設定へ戻す: gender=null を渡しても1件として処理される（推測はしない）', async () => {
    dbMockState.execute.mockResolvedValue({ rows: [{ person_name: '人物A' }] });
    const result = await bulkSetPersonGender(['人物A'], null);
    expect(result.updated).toBe(1);
    expect(dbMockState.execute).toHaveBeenCalledTimes(1);
  });

  it('空配列を渡した場合はDBに問い合わせず即座に0件を返す', async () => {
    const result = await bulkSetPersonGender([], 'female');
    expect(result.updated).toBe(0);
    expect(dbMockState.execute).not.toHaveBeenCalled();
  });
});

describe('bulkSetGroupGender', () => {
  it('複数グループ一括設定: 1回のSQL文で一括保存し、RETURNING件数を返す', async () => {
    dbMockState.execute.mockResolvedValue({ rows: [{ group_name: '日向坂46' }, { group_name: '櫻坂46' }] });
    const result = await bulkSetGroupGender(['日向坂46', '櫻坂46'], 'female');
    expect(result.updated).toBe(2);
    expect(dbMockState.execute).toHaveBeenCalledTimes(1);
  });

  it('group_metaに存在しないグループ名はUPDATEのWHERE句にヒットせず捏造しない（RETURNING0件）', async () => {
    dbMockState.execute.mockResolvedValue({ rows: [] });
    const result = await bulkSetGroupGender(['存在しないグループ'], 'male');
    expect(result.updated).toBe(0);
  });
});

describe('gender解決の優先順位（既存ロジックの回帰確認）', () => {
  it('personMeta.gender が groupMeta.gender より優先されること', async () => {
    const { resolvePersonGender } = await import('../photobook');
    // 本人genderが設定されていれば、所属グループのgenderと矛盾していても本人側を採用する
    expect(resolvePersonGender('male', 'female')).toBe('male');
    expect(resolvePersonGender('female', 'male')).toBe('female');
    // 本人未設定の場合のみグループへフォールバックする
    expect(resolvePersonGender(null, 'female')).toBe('female');
    expect(resolvePersonGender(undefined, 'male')).toBe('male');
    // どちらも未設定なら未分類
    expect(resolvePersonGender(null, null)).toBeNull();
  });
});
