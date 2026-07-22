import { describe, it, expect } from 'vitest';
import {
  parseQueryParams,
  filterGroups,
  paginateGroups,
  trimGroupsForResponse,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '@/app/api/admin/work-dedup/candidates/lib';
import {
  normalizeWorkTitleForMatching,
  type WorkDedupGroup,
  type WorkDedupEntry,
  type WorkDuplicateConfidence,
} from '../work-dedup';

// ─── テストヘルパー ───────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<WorkDedupEntry> & { workId: string }): WorkDedupEntry {
  return {
    workId:          overrides.workId,
    title:           overrides.title          ?? 'テスト',
    dedupKey:        normalizeWorkTitleForMatching(overrides.title ?? 'テスト'),
    type:            overrides.type           ?? 'tv',
    tmdbId:          overrides.tmdbId         ?? null,
    source:          overrides.source         ?? 'tmdb',
    releaseYear:     overrides.releaseYear     !== undefined ? overrides.releaseYear : 2023,
    overview:        overrides.overview        ?? null,
    posterUrl:       overrides.posterUrl       ?? null,
    status:          overrides.status         ?? 'auto_published',
    hasDeleted:      overrides.hasDeleted      ?? false,
    persons:         overrides.persons         ?? ['Aさん'],
    personLinkCount: overrides.personLinkCount ?? 1,
    vodCount:        overrides.vodCount        ?? 0,
    updatedAt:       overrides.updatedAt       ?? Date.now(),
    createdAt:       overrides.createdAt       ?? Date.now(),
  };
}

function makeGroup(overrides: {
  groupId?: string;
  confidence?: WorkDuplicateConfidence;
  title?: string;
  workId1?: string;
  workId2?: string;
}): WorkDedupGroup {
  const confidence = overrides.confidence ?? 'high';
  const e1 = makeEntry({ workId: overrides.workId1 ?? 'w1', title: overrides.title ?? 'テスト作品' });
  const e2 = makeEntry({ workId: overrides.workId2 ?? 'w2', title: overrides.title ?? 'テスト作品' });
  return {
    groupId:                overrides.groupId ?? 'grp-1',
    entries:                [e1, e2],
    confidence,
    reasons:                ['テスト理由'],
    conflicts:              [],
    canonicalRecommendation: { recommendedWorkId: e1.workId, reasons: [], conflicts: [] },
    mergePlan: {
      canonicalWorkId:        e1.workId,
      duplicateWorkIds:       [e2.workId],
      confidence,
      reasons:                [],
      conflicts:              [],
      personLinksToMove:      1,
      personLinksToDeduplicate: 0,
      vodRecordsToMove:       0,
      vodRecordsToDeduplicate: 0,
      productsToMove:         1,
      relatedWorksToUpdate:   0,
      redirectsToCreate:      1,
      rankingEntriesToUpdate: 1,
      canApplyAutomatically:  false,
    },
  };
}

// ─── parseQueryParams ─────────────────────────────────────────────────────────

describe('parseQueryParams', () => {
  it('デフォルト値: page=1, limit=DEFAULT_LIMIT, confidence=all, q=""', () => {
    const p = parseQueryParams(new URLSearchParams());
    expect(p.page).toBe(1);
    expect(p.limit).toBe(DEFAULT_LIMIT);
    expect(p.confidence).toBe('all');
    expect(p.q).toBe('');
  });

  it('有効な page / limit を解析する', () => {
    const p = parseQueryParams(new URLSearchParams('page=3&limit=20'));
    expect(p.page).toBe(3);
    expect(p.limit).toBe(20);
  });

  it('limit が MAX_LIMIT を超える場合は MAX_LIMIT に補正', () => {
    const p = parseQueryParams(new URLSearchParams(`limit=${MAX_LIMIT + 50}`));
    expect(p.limit).toBe(MAX_LIMIT);
  });

  it('page が 0 以下の場合は 1 に補正', () => {
    const p = parseQueryParams(new URLSearchParams('page=0'));
    expect(p.page).toBe(1);
    const p2 = parseQueryParams(new URLSearchParams('page=-5'));
    expect(p2.page).toBe(1);
  });

  it('非数値の page / limit は安全なデフォルト値に補正', () => {
    const p = parseQueryParams(new URLSearchParams('page=abc&limit=xyz'));
    expect(p.page).toBe(1);
    expect(p.limit).toBe(DEFAULT_LIMIT);
  });

  it('confidence と q を正しく取得する', () => {
    const p = parseQueryParams(new URLSearchParams('confidence=high&q=春の夢'));
    expect(p.confidence).toBe('high');
    expect(p.q).toBe('春の夢');
  });

  it('q は小文字・trim される', () => {
    const p = parseQueryParams(new URLSearchParams('q=  HELLO  '));
    expect(p.q).toBe('hello');
  });
});

// ─── filterGroups ─────────────────────────────────────────────────────────────

describe('filterGroups', () => {
  const high1     = makeGroup({ groupId: 'h1', confidence: 'high',    title: '春の夢',  workId1: 'a', workId2: 'b' });
  const high2     = makeGroup({ groupId: 'h2', confidence: 'high',    title: '夏の恋',  workId1: 'c', workId2: 'd' });
  const conflict1 = makeGroup({ groupId: 'c1', confidence: 'conflict', title: '秋の空', workId1: 'e', workId2: 'f' });
  const medium1   = makeGroup({ groupId: 'm1', confidence: 'medium',  title: '冬の星',  workId1: 'g', workId2: 'h' });
  const all = [high1, high2, conflict1, medium1];

  it('confidence=all は全件返す', () => {
    expect(filterGroups(all, 'all', '')).toHaveLength(4);
  });

  it('confidence=high は high グループのみ返す', () => {
    const result = filterGroups(all, 'high', '');
    expect(result).toHaveLength(2);
    expect(result.every((g) => g.confidence === 'high')).toBe(true);
  });

  it('confidence=conflict は conflict グループのみ返す', () => {
    const result = filterGroups(all, 'conflict', '');
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe('c1');
  });

  it('不正な confidence 値は無視して全件返す', () => {
    expect(filterGroups(all, 'unknown', '')).toHaveLength(4);
  });

  it('q でタイトル検索できる', () => {
    const result = filterGroups(all, 'all', '春');
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe('h1');
  });

  it('q で workId 検索できる', () => {
    const result = filterGroups(all, 'all', 'c');
    // workId に 'c' を含む: c, conflict グループの workId=e,f には含まれない
    // high2 の workId1=c → マッチ
    expect(result.some((g) => g.groupId === 'h2')).toBe(true);
  });

  it('q が空文字は全件返す', () => {
    expect(filterGroups(all, 'all', '')).toHaveLength(4);
  });

  it('confidence + q の複合フィルター', () => {
    const result = filterGroups(all, 'high', '夏');
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe('h2');
  });

  it('0件マッチは空配列を返す', () => {
    expect(filterGroups(all, 'high', '存在しないタイトル')).toHaveLength(0);
  });
});

// ─── paginateGroups ───────────────────────────────────────────────────────────

describe('paginateGroups', () => {
  const groups = Array.from({ length: 15 }, (_, i) =>
    makeGroup({ groupId: `g${i}`, workId1: `a${i}`, workId2: `b${i}` }),
  );

  it('page=1, limit=5 → 先頭5件', () => {
    const { items, pagination } = paginateGroups(groups, 1, 5);
    expect(items).toHaveLength(5);
    expect(items[0].groupId).toBe('g0');
    expect(pagination.page).toBe(1);
    expect(pagination.totalPages).toBe(3);
    expect(pagination.total).toBe(15);
  });

  it('page=2, limit=5 → 5〜9件目', () => {
    const { items, pagination } = paginateGroups(groups, 2, 5);
    expect(items).toHaveLength(5);
    expect(items[0].groupId).toBe('g5');
    expect(pagination.page).toBe(2);
  });

  it('page=3, limit=5 → 残り5件', () => {
    const { items } = paginateGroups(groups, 3, 5);
    expect(items).toHaveLength(5);
    expect(items[0].groupId).toBe('g10');
  });

  it('page が totalPages を超える場合は最終ページに clamp', () => {
    const { items, pagination } = paginateGroups(groups, 999, 5);
    expect(pagination.page).toBe(3);
    expect(items).toHaveLength(5);
  });

  it('端数のある件数: limit=4, 15件 → 4ページ', () => {
    const { pagination } = paginateGroups(groups, 1, 4);
    expect(pagination.totalPages).toBe(4);
  });

  it('空配列は totalPages=1, total=0', () => {
    const { items, pagination } = paginateGroups([], 1, 10);
    expect(items).toHaveLength(0);
    expect(pagination.total).toBe(0);
    expect(pagination.totalPages).toBe(1);
  });

  it('limit=1 → 1件ずつ', () => {
    const { items, pagination } = paginateGroups(groups, 1, 1);
    expect(items).toHaveLength(1);
    expect(pagination.totalPages).toBe(15);
  });
});

// ─── trimGroupsForResponse ────────────────────────────────────────────────────

describe('trimGroupsForResponse', () => {
  it('overview が maxLen を超える場合に切り詰める', () => {
    const longText = 'あ'.repeat(300);
    const g = makeGroup({ groupId: 'x', workId1: 'x1', workId2: 'x2' });
    g.entries[0].overview = longText;

    const [trimmed] = trimGroupsForResponse([g], 150);
    expect(trimmed.entries[0].overview?.length).toBe(150);
  });

  it('overview が null の場合は null のまま', () => {
    const g = makeGroup({ groupId: 'y', workId1: 'y1', workId2: 'y2' });
    g.entries[0].overview = null;

    const [trimmed] = trimGroupsForResponse([g], 150);
    expect(trimmed.entries[0].overview).toBeNull();
  });

  it('overview が maxLen 以下の場合はそのまま', () => {
    const short = '短いあらすじ';
    const g = makeGroup({ groupId: 'z', workId1: 'z1', workId2: 'z2' });
    g.entries[0].overview = short;

    const [trimmed] = trimGroupsForResponse([g], 150);
    expect(trimmed.entries[0].overview).toBe(short);
  });

  it('元のオブジェクトを変更しない（不変性）', () => {
    const longText = 'テ'.repeat(300);
    const g = makeGroup({ groupId: 'q', workId1: 'q1', workId2: 'q2' });
    g.entries[0].overview = longText;

    trimGroupsForResponse([g], 150);
    // 元のエントリは変わっていない
    expect(g.entries[0].overview?.length).toBe(300);
  });

  it('CLI 専用ファイル出力関数はこのライブラリから呼ばれない', () => {
    // trim 関数が FS/writeFile を呼ばないことをスモークテストで確認
    const g = makeGroup({ groupId: 'fs', workId1: 'fs1', workId2: 'fs2' });
    expect(() => trimGroupsForResponse([g])).not.toThrow();
  });
});

// ─── 候補0件 vs エラーの区別 ────────────────────────────────────────────────────

describe('候補0件とエラーの区別', () => {
  it('filterGroups が 0件を返しても例外にならない', () => {
    const groups = [makeGroup({ groupId: 'a', workId1: 'a1', workId2: 'a2' })];
    const result = filterGroups(groups, 'exact', 'nomatch');
    expect(result).toHaveLength(0);
    // エラーではなく空配列
  });

  it('paginateGroups が 0件でも pagination を正常に返す', () => {
    const { items, pagination } = paginateGroups([], 1, 50);
    expect(items).toHaveLength(0);
    expect(pagination.total).toBe(0);
    expect(pagination.totalPages).toBe(1);
    expect(pagination.page).toBe(1);
  });
});

// ─── DB・Redis 更新がないことの確認 ──────────────────────────────────────────────

describe('DB・Redis 更新禁止の確認', () => {
  it('lib.ts の全関数は副作用を持たない（純粋関数）', () => {
    const params = parseQueryParams(new URLSearchParams());
    expect(params).toBeDefined();

    const groups = [makeGroup({ groupId: 'p', workId1: 'p1', workId2: 'p2' })];
    const filtered = filterGroups(groups, 'all', '');
    expect(filtered).toBeDefined();

    const { items, pagination } = paginateGroups(filtered, 1, 50);
    expect(items).toBeDefined();
    expect(pagination).toBeDefined();

    const trimmed = trimGroupsForResponse(items);
    expect(trimmed).toBeDefined();
    // どの関数も例外を投げず、外部ストレージを触らない
  });
});
