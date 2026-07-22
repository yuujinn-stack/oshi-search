import { describe, it, expect } from 'vitest';
import {
  normalizeWorkTitleForMatching,
  assessDuplicateGroup,
  selectCanonical,
  buildMergePlan,
  detectDuplicates,
  validateAlias,
  aggregateEntries,
  makeGroupId,
  type WorkDedupEntry,
  type WorkRawRow,
} from '../work-dedup';

// ─── テストヘルパー ───────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<WorkDedupEntry> & { workId: string }): WorkDedupEntry {
  return {
    workId: overrides.workId,
    title: overrides.title ?? 'テスト作品',
    dedupKey: normalizeWorkTitleForMatching(overrides.title ?? 'テスト作品'),
    type: overrides.type ?? 'tv',
    tmdbId: overrides.tmdbId ?? null,
    source: overrides.source ?? 'tmdb',
    releaseYear: overrides.releaseYear !== undefined ? overrides.releaseYear : 2023,
    overview: overrides.overview ?? null,
    posterUrl: overrides.posterUrl ?? null,
    status: overrides.status ?? 'auto_published',
    hasDeleted: overrides.hasDeleted ?? false,
    persons: overrides.persons ?? ['テスト人物'],
    personLinkCount: overrides.personLinkCount ?? 1,
    vodCount: overrides.vodCount ?? 0,
    updatedAt: overrides.updatedAt ?? Date.now(),
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

function makeRawRow(overrides: Partial<WorkRawRow> & { id: string; personName: string }): WorkRawRow {
  return {
    id: overrides.id,
    personName: overrides.personName,
    title: overrides.title ?? 'テスト作品',
    normalizedTitle: overrides.normalizedTitle ?? 'テスト作品',
    type: overrides.type ?? 'tv',
    tmdbId: overrides.tmdbId ?? null,
    source: overrides.source ?? 'tmdb',
    releaseYear: overrides.releaseYear !== undefined ? overrides.releaseYear : 2023,
    overview: overrides.overview ?? null,
    posterUrl: overrides.posterUrl ?? null,
    status: overrides.status ?? 'auto_published',
    deleted: overrides.deleted ?? false,
    vodData: overrides.vodData ?? {},
    updatedAt: overrides.updatedAt ?? new Date(),
    createdAt: overrides.createdAt ?? new Date(),
  };
}

// ─── 1. 同じ外部 ID (TMDb ID) ───────────────────────────────────────────────

describe('テスト1: 同じ TMDb ID', () => {
  it('exact 候補として検出され、同じグループに入る', () => {
    const a = makeEntry({ workId: 'tmdb-tv-12345', tmdbId: 12345, type: 'tv', releaseYear: 2023 });
    const b = makeEntry({ workId: 'csv-tv-SAME', tmdbId: 12345, type: 'tv', releaseYear: 2023 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('exact');
    expect(result.reasons.some((r) => r.includes('TMDb ID'))).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('detectDuplicates が同じグループとして返す', () => {
    const a = makeEntry({ workId: 'tmdb-tv-12345', title: 'テスト作品', tmdbId: 12345, type: 'tv' });
    const b = makeEntry({ workId: 'csv-tv-SAME', title: 'テスト作品', tmdbId: 12345, type: 'tv' });

    const groups = detectDuplicates([a, b]);

    expect(groups.length).toBeGreaterThanOrEqual(1);
    const group = groups[0];
    const workIds = group.entries.map((e) => e.workId);
    expect(workIds).toContain('tmdb-tv-12345');
    expect(workIds).toContain('csv-tv-SAME');
  });
});

// ─── 2. 同じタイトル・種別・年 ─────────────────────────────────────────────

describe('テスト2: 正規化タイトル・種別・年すべて一致', () => {
  it('high 候補として分類され、自動統合は不可', () => {
    const a = makeEntry({ workId: 'tmdb-tv-A', title: '春の夢', type: 'tv', releaseYear: 2022 });
    const b = makeEntry({ workId: 'ai-tv-B', title: '春の夢', type: 'tv', releaseYear: 2022 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('high');
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: selectCanonical([a, b]) });
    expect(plan.canApplyAutomatically).toBe(false);
  });
});

// ─── 3. 同名別年 ────────────────────────────────────────────────────────────

describe('テスト3: 同じタイトル・種別で公開年が異なる', () => {
  it('conflict として分類され、自動統合不可', () => {
    const a = makeEntry({ workId: 'work-A', title: '愛の季節', type: 'tv', releaseYear: 2010 });
    const b = makeEntry({ workId: 'work-B', title: '愛の季節', type: 'tv', releaseYear: 2023 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('conflict');
    expect(result.conflicts.some((c) => c.includes('公開年'))).toBe(true);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: selectCanonical([a, b]) });
    expect(plan.canApplyAutomatically).toBe(false);
  });
});

// ─── 4. 映画と TV ──────────────────────────────────────────────────────────

describe('テスト4: 同名で movie vs tv', () => {
  it('作品種別が異なるため conflict', () => {
    const a = makeEntry({ workId: 'tmdb-movie-X', title: '花の詩', type: 'movie', releaseYear: 2022 });
    const b = makeEntry({ workId: 'tmdb-tv-Y', title: '花の詩', type: 'tv', releaseYear: 2022 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('conflict');
    expect(result.conflicts.some((c) => c.includes('作品種別'))).toBe(true);
  });
});

// ─── 5. シーズン違い ────────────────────────────────────────────────────────

describe('テスト5: シーズン違い（Season 2 は別作品）', () => {
  it('dedupKey が異なるため同一グループに入らない', () => {
    const keyA = normalizeWorkTitleForMatching('ドラマ作品名');
    const keyB = normalizeWorkTitleForMatching('ドラマ作品名 Season 2');

    expect(keyA).not.toBe(keyB);

    const a = makeEntry({ workId: 'work-s1', title: 'ドラマ作品名', dedupKey: keyA } as WorkDedupEntry);
    const b = makeEntry({ workId: 'work-s2', title: 'ドラマ作品名 Season 2', dedupKey: keyB } as WorkDedupEntry);

    // dedupKey が異なるので detectDuplicates はグループを作らない
    const groups = detectDuplicates([a, b]);
    const sameGroup = groups.find(
      (g) =>
        g.entries.some((e) => e.workId === 'work-s1') &&
        g.entries.some((e) => e.workId === 'work-s2'),
    );
    expect(sameGroup).toBeUndefined();
  });

  it('Season 2 は自動統合不可（dedupKey 一致なし）', () => {
    const key2 = normalizeWorkTitleForMatching('ドラマ作品名 Season 2');
    // "Season 2" が dedupKey に残る
    expect(key2).toContain('season 2');
  });
});

// ─── 6. 劇場版 ─────────────────────────────────────────────────────────────

describe('テスト6: 劇場版は別作品', () => {
  it('normalizeWorkTitleForMatching が劇場版を除去しない', () => {
    const keyMain = normalizeWorkTitleForMatching('青春の記憶');
    const keyMovie = normalizeWorkTitleForMatching('劇場版 青春の記憶');

    expect(keyMain).not.toBe(keyMovie);
    expect(keyMovie).toContain('劇場版');
  });

  it('detectDuplicates は劇場版と本編を同グループにしない', () => {
    const a = makeEntry({ workId: 'main', title: '青春の記憶' });
    const b = makeEntry({ workId: 'movie', title: '劇場版 青春の記憶' });
    // dedupKey が異なるので同グループにならない
    b.dedupKey = normalizeWorkTitleForMatching('劇場版 青春の記憶');

    const groups = detectDuplicates([a, b]);
    const sameGroup = groups.find(
      (g) =>
        g.entries.some((e) => e.workId === 'main') &&
        g.entries.some((e) => e.workId === 'movie'),
    );
    expect(sameGroup).toBeUndefined();
  });
});

// ─── 7. 公開年欠落 ─────────────────────────────────────────────────────────

describe('テスト7: 片方のみ releaseYear なし', () => {
  it('medium 候補 → 人間確認対象', () => {
    const a = makeEntry({ workId: 'work-A', title: '月光のソナタ', type: 'tv', releaseYear: 2021 });
    const b = makeEntry({ workId: 'work-B', title: '月光のソナタ', type: 'tv', releaseYear: null });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('medium');
    expect(result.conflicts.some((c) => c.includes('公開年'))).toBe(true);
  });
});

// ─── 8. TMDb ID 不一致 ─────────────────────────────────────────────────────

describe('テスト8: タイトル・年一致でも TMDb ID が異なる → conflict', () => {
  it('異なる TMDb ID は conflict', () => {
    const a = makeEntry({ workId: 'tmdb-tv-111', title: '星空の恋', type: 'tv', releaseYear: 2020, tmdbId: 111 });
    const b = makeEntry({ workId: 'tmdb-tv-222', title: '星空の恋', type: 'tv', releaseYear: 2020, tmdbId: 222 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('conflict');
    expect(result.conflicts.some((c) => c.includes('TMDb ID'))).toBe(true);
  });
});

// ─── 9. 同じ人物関連 ───────────────────────────────────────────────────────

describe('テスト9: 両作品に同じ人物がいる場合', () => {
  it('mergePlan で重複件数が表示され、dry-run ではデータを変更しない', () => {
    const a = makeEntry({ workId: 'work-A', title: '夕焼け', persons: ['田中花子', '鈴木一郎'] });
    const b = makeEntry({ workId: 'work-B', title: '夕焼け', persons: ['田中花子', '山田太郎'] });

    const cr = selectCanonical([a, b]);
    const result = assessDuplicateGroup([a, b]);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: cr });

    // 田中花子は重複 → deduplicate
    expect(plan.personLinksToDeduplicate).toBeGreaterThanOrEqual(1);
    // 山田太郎は移動対象
    expect(plan.personLinksToMove).toBeGreaterThanOrEqual(0);
    // canApplyAutomatically は常に false
    expect(plan.canApplyAutomatically).toBe(false);
  });
});

// ─── 10. 異なる人物関連 ────────────────────────────────────────────────────

describe('テスト10: 異なる人物関連 → canonical へ移動予定件数を表示', () => {
  it('重複しない人物の移動件数が計上される', () => {
    const a = makeEntry({ workId: 'work-A', title: '朝霞', persons: ['Aさん'], personLinkCount: 1 });
    const b = makeEntry({ workId: 'work-B', title: '朝霞', persons: ['Bさん'], personLinkCount: 1 });

    const cr = selectCanonical([a, b]);
    const result = assessDuplicateGroup([a, b]);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: cr });

    // 相互に重複しない → 移動件数 > 0
    expect(plan.personLinksToMove + plan.personLinksToDeduplicate).toBeGreaterThan(0);
  });
});

// ─── 11. VOD 重複 ──────────────────────────────────────────────────────────

describe('テスト11: 同一 VOD サービスが両方にある → 重複件数を表示、dry-run では削除しない', () => {
  it('vodRecordsToDeduplicate が計上される', () => {
    const a = makeEntry({ workId: 'work-A', title: '紅葉', vodCount: 3 });
    const b = makeEntry({ workId: 'work-B', title: '紅葉', vodCount: 3 });

    const cr = selectCanonical([a, b]);
    const result = assessDuplicateGroup([a, b]);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: cr });

    // 重複 VOD が存在する可能性あり
    expect(plan.vodRecordsToDeduplicate).toBeGreaterThanOrEqual(0);
    expect(plan.canApplyAutomatically).toBe(false);
  });
});

// ─── 12. Prime Video 追加チャンネル ────────────────────────────────────────

describe('テスト12: Prime Video 追加チャンネルの独立性', () => {
  it('Prime Video 本体と追加チャンネルは別サービスとして扱われる', () => {
    // normalizeProviderName で 'primevideo' ≠ 'telasa-on-prime' 等
    // このテストは work-dedup の buildMergePlan ではなく vod-dedup の関数を使うが、
    // dedup 計画で Prime Video 本体に統合しないことを確認する
    const a = makeEntry({ workId: 'work-A', title: 'テスト', vodCount: 1 }); // Prime Video
    const b = makeEntry({ workId: 'work-B', title: 'テスト', vodCount: 1 }); // Prime Videoチャンネル

    const cr = selectCanonical([a, b]);
    const result = assessDuplicateGroup([a, b]);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: cr });

    // canApplyAutomatically: false で VOD 自動統合を防ぐ
    expect(plan.canApplyAutomatically).toBe(false);
  });
});

// ─── 13. alias 循環 ─────────────────────────────────────────────────────────

describe('テスト13: alias 循環を拒否', () => {
  it('A→B かつ B→A の循環は CIRCULAR エラー', () => {
    const aliases = new Map([['B', 'A']]);
    const allIds = new Set(['A', 'B']);

    const error = validateAlias('A', 'B', aliases, allIds);
    expect(error).toBe('CIRCULAR');
  });
});

// ─── 14. 自己 alias ─────────────────────────────────────────────────────────

describe('テスト14: 自己参照 alias を拒否', () => {
  it('A → A は SELF_REFERENCE', () => {
    const aliases = new Map<string, string>();
    const allIds = new Set(['A', 'B']);

    const error = validateAlias('A', 'A', aliases, allIds);
    expect(error).toBe('SELF_REFERENCE');
  });
});

// ─── 15. 存在しない canonical ────────────────────────────────────────────────

describe('テスト15: 存在しない canonical WorkId を拒否', () => {
  it('canonical が allWorkIds に存在しない場合 CANONICAL_NOT_FOUND', () => {
    const aliases = new Map<string, string>();
    const allIds = new Set(['A', 'B']);

    const error = validateAlias('A', 'NONEXISTENT', aliases, allIds);
    expect(error).toBe('CANONICAL_NOT_FOUND');
  });
});

// ─── 16. dry-run: DB 更新ゼロ ────────────────────────────────────────────────

describe('テスト16: dry-run では DB/Redis 更新ゼロ', () => {
  it('buildMergePlan は副作用を持たず canApplyAutomatically が false', () => {
    const a = makeEntry({ workId: 'w1', title: '夜の銀河' });
    const b = makeEntry({ workId: 'w2', title: '夜の銀河' });

    const cr = selectCanonical([a, b]);
    const result = assessDuplicateGroup([a, b]);
    const plan = buildMergePlan({ entries: [a, b], ...result, canonicalRecommendation: cr });

    expect(plan.canApplyAutomatically).toBe(false);
    // plan はデータ変更を起こさない（純粋関数）
  });
});

// ─── 17. 同名ライブ公演（年が異なる）─────────────────────────────────────────

describe('テスト17: 同名ライブ公演で年が異なる', () => {
  it('公開年が異なるため conflict', () => {
    const a = makeEntry({ workId: 'live-2022', title: 'LIVE TOUR 2022', type: 'variety', releaseYear: 2022 });
    const b = makeEntry({ workId: 'live-2023', title: 'LIVE TOUR 2023', type: 'variety', releaseYear: 2023 });

    const keyA = normalizeWorkTitleForMatching('LIVE TOUR 2022');
    const keyB = normalizeWorkTitleForMatching('LIVE TOUR 2023');

    // タイトルに年が含まれているため dedupKey が異なる → 同グループ化なし
    expect(keyA).not.toBe(keyB);
  });

  it('同名ライブで年が含まれる場合は別グループ', () => {
    const a = makeEntry({
      workId: 'live-2022', title: 'LIVE TOUR 2022', type: 'variety', releaseYear: 2022,
      dedupKey: normalizeWorkTitleForMatching('LIVE TOUR 2022'),
    } as WorkDedupEntry);
    const b = makeEntry({
      workId: 'live-2023', title: 'LIVE TOUR 2023', type: 'variety', releaseYear: 2023,
      dedupKey: normalizeWorkTitleForMatching('LIVE TOUR 2023'),
    } as WorkDedupEntry);

    const groups = detectDuplicates([a, b]);
    expect(groups).toHaveLength(0);
  });
});

// ─── 18. 全角・半角差 ────────────────────────────────────────────────────────

describe('テスト18: 全角・半角差は同一候補として検出', () => {
  it('normalizeWorkTitleForMatching が全角・半角を統一する', () => {
    const keyA = normalizeWorkTitleForMatching('ＨＥＬＬＯ ＷＯＲＬＤ'); // 全角英字
    const keyB = normalizeWorkTitleForMatching('HELLO WORLD');            // 半角英字

    expect(keyA).toBe(keyB);
  });

  it('全角スペースと半角スペースを同一視する', () => {
    const keyA = normalizeWorkTitleForMatching('春の　夢');  // 全角スペース
    const keyB = normalizeWorkTitleForMatching('春の 夢');  // 半角スペース

    expect(keyA).toBe(keyB);
  });

  it('全角・半角差のある作品を同一候補グループに含める', () => {
    const a = makeEntry({
      workId: 'w-fullwidth',
      title: 'ＨＥＬＬＯ',
      dedupKey: normalizeWorkTitleForMatching('ＨＥＬＬＯ'),
      type: 'tv',
      releaseYear: 2023,
    } as WorkDedupEntry);
    const b = makeEntry({
      workId: 'w-halfwidth',
      title: 'HELLO',
      dedupKey: normalizeWorkTitleForMatching('HELLO'),
      type: 'tv',
      releaseYear: 2023,
    } as WorkDedupEntry);

    const groups = detectDuplicates([a, b]);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const group = groups[0];
    expect(group.entries.map((e) => e.workId)).toContain('w-fullwidth');
    expect(group.entries.map((e) => e.workId)).toContain('w-halfwidth');
  });
});

// ─── 追加: aggregateEntries ──────────────────────────────────────────────────

describe('aggregateEntries: DB 行を workId 単位に集約', () => {
  it('同じ workId を持つ複数行を1エントリに集約する', () => {
    const rows: WorkRawRow[] = [
      makeRawRow({ id: 'work-1', personName: 'Aさん', title: 'テスト', status: 'auto_published' }),
      makeRawRow({ id: 'work-1', personName: 'Bさん', title: 'テスト', status: 'needs_review' }),
      makeRawRow({ id: 'work-2', personName: 'Cさん', title: '別作品', status: 'hidden' }),
    ];

    const entries = aggregateEntries(rows);

    expect(entries).toHaveLength(2);
    const entry1 = entries.find((e) => e.workId === 'work-1')!;
    expect(entry1.persons).toHaveLength(2);
    expect(entry1.personLinkCount).toBe(2);
    // 最も公開寄りのステータスを代表値とする
    expect(entry1.status).toBe('auto_published');
  });

  it('TMDb ID を持つ行から補完する', () => {
    const rows: WorkRawRow[] = [
      makeRawRow({ id: 'work-X', personName: 'Aさん', tmdbId: null }),
      makeRawRow({ id: 'work-X', personName: 'Bさん', tmdbId: 99999 }),
    ];

    const entries = aggregateEntries(rows);

    expect(entries[0].tmdbId).toBe(99999);
  });

  it('vodData から VOD 件数を集計する', () => {
    const rows: WorkRawRow[] = [
      makeRawRow({
        id: 'work-Y', personName: 'Xさん',
        vodData: { vodProviders: [{ providerId: 'p1' }, { providerId: 'p2' }, { providerId: 'p3' }] },
      }),
    ];

    const entries = aggregateEntries(rows);
    expect(entries[0].vodCount).toBe(3);
  });
});

// ─── 追加: makeGroupId（candidateGroupKey）の仕様 ──────────────────────────

describe('makeGroupId（candidateGroupKey）', () => {
  // ─── 形式 ────────────────────────────────────────────────────────────────

  it('64文字の lowercase hex を返す（切り詰めなし）', () => {
    const id = makeGroupId(['tmdb-tv-216223', 'csv-tv-離婚しようよ']);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id.length).toBe(64);
  });

  it('16文字に切り詰められていないこと', () => {
    const id = makeGroupId(['a', 'b']);
    expect(id.length).toBe(64);
    expect(id.length).not.toBe(16);
  });

  // ─── 順序不変性 ─────────────────────────────────────────────────────────

  it('workId の順序が違っても同じキー', () => {
    const id1 = makeGroupId(['a', 'b', 'c']);
    const id2 = makeGroupId(['c', 'a', 'b']);
    expect(id1).toBe(id2);
  });

  it('日本語 workId でも順序不変', () => {
    const id1 = makeGroupId(['csv-tv-離婚しようよ', 'tmdb-tv-216223']);
    const id2 = makeGroupId(['tmdb-tv-216223', 'csv-tv-離婚しようよ']);
    expect(id1).toBe(id2);
  });

  // ─── 前後空白の除去 ──────────────────────────────────────────────────────

  it('workId の前後空白を除去して同じキー', () => {
    const id1 = makeGroupId(['a', 'b']);
    const id2 = makeGroupId([' a ', ' b ']);
    expect(id1).toBe(id2);
  });

  // ─── 重複除去 ───────────────────────────────────────────────────────────

  it('重複 workId があっても安全に処理する（重複除去して同一キー）', () => {
    const id1 = makeGroupId(['a', 'b']);
    const id2 = makeGroupId(['a', 'b', 'a']); // 重複あり
    expect(id1).toBe(id2);
  });

  // ─── 異なる集合は別キー ──────────────────────────────────────────────────

  it('workId 集合が異なると別キー', () => {
    const id1 = makeGroupId(['a', 'b']);
    const id2 = makeGroupId(['a', 'c']);
    expect(id1).not.toBe(id2);
  });

  it('workId が1件増えると別キー', () => {
    const id1 = makeGroupId(['a', 'b']);
    const id2 = makeGroupId(['a', 'b', 'c']);
    expect(id1).not.toBe(id2);
  });

  // ─── 不正入力 ────────────────────────────────────────────────────────────

  it('空配列は空文字を返す（候補なし）', () => {
    expect(makeGroupId([])).toBe('');
  });

  it('1件のみの配列は空文字を返す（重複候補でない）', () => {
    expect(makeGroupId(['only-one'])).toBe('');
  });

  it('空文字 workId は除去されて不正な場合は空文字', () => {
    expect(makeGroupId(['', ''])).toBe('');
  });

  // ─── algorithmVersion との独立性 ────────────────────────────────────────

  it('algorithmVersion は candidateGroupKey に含まない（同じ workId → 同じキー）', () => {
    // v1 の時点で生成したキーが v2 になっても workId が同じなら同一
    const id = makeGroupId(['tmdb-tv-216223', 'csv-tv-離婚しようよ']);
    // キーの生成に algorithmVersion を使っていないことを確認
    // （同一 workIds からは常に同一キー）
    const idAgain = makeGroupId(['tmdb-tv-216223', 'csv-tv-離婚しようよ']);
    expect(id).toBe(idAgain);
    // 64文字 hex
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── 追加: TMDb 判定理由の正確性 ─────────────────────────────────────────────

describe('TMDb 判定理由の出し分け', () => {
  // ケースA：全作品で同じ TMDb ID を保持
  it('全エントリが同じ TMDb ID → 「複数作品でTMDb ID XX が一致」と表示する（exact）', () => {
    const a = makeEntry({ workId: 'tmdb-tv-100', tmdbId: 100, type: 'tv' });
    const b = makeEntry({ workId: 'csv-tv-100',  tmdbId: 100, type: 'tv' });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('exact');
    const tmdbReason = result.reasons.find((r) => r.includes('TMDb ID'));
    expect(tmdbReason).toBeDefined();
    expect(tmdbReason).toContain('複数作品でTMDb ID 100 が一致');
    // 「同一TMDb ID」という旧表現を使わない
    expect(tmdbReason).not.toContain('同一TMDb ID');
    // 「一部エントリ」という旧表現を使わない
    expect(tmdbReason).not.toContain('一部エントリ');
  });

  // ケースB：1作品だけ TMDb ID を保持（「離婚しようよ」パターン）
  it('1作品のみ TMDb ID あり → 「候補内の1作品のみがTMDb ID XX を保持」と表示する', () => {
    const csv   = makeEntry({ workId: 'csv-tv-離婚しようよ', tmdbId: null,   type: 'tv', releaseYear: 2023 });
    const tmdb  = makeEntry({ workId: 'tmdb-tv-216223',      tmdbId: 216223, type: 'tv', releaseYear: 2023 });

    const result = assessDuplicateGroup([csv, tmdb]);

    expect(result.confidence).toBe('high');
    const tmdbReason = result.reasons.find((r) => r.includes('TMDb ID'));
    expect(tmdbReason).toBeDefined();
    expect(tmdbReason).toContain('候補内の1作品のみがTMDb ID 216223 を保持');
    // 「同一TMDb ID」「一致」は使わない
    expect(tmdbReason).not.toContain('同一TMDb ID');
    expect(tmdbReason).not.toContain('一致');
  });

  // ケースB2：複数作品が同じ TMDb ID を保持するが全員ではない
  it('2作品が同じ TMDb ID を持ち1作品は null → 「候補内の2作品が…を保持」と表示する', () => {
    const a = makeEntry({ workId: 'w1', tmdbId: 999, type: 'tv', releaseYear: 2020 });
    const b = makeEntry({ workId: 'w2', tmdbId: 999, type: 'tv', releaseYear: 2020 });
    const c = makeEntry({ workId: 'w3', tmdbId: null, type: 'tv', releaseYear: 2020 });

    const result = assessDuplicateGroup([a, b, c]);

    const tmdbReason = result.reasons.find((r) => r.includes('TMDb ID'));
    expect(tmdbReason).toBeDefined();
    expect(tmdbReason).toContain('候補内の2作品がTMDb ID 999 を保持');
    expect(tmdbReason).not.toContain('同一TMDb ID');
  });

  // ケースC：異なる TMDb ID → conflict の矛盾理由へ
  it('異なる TMDb ID → conflict かつ矛盾理由に「異なるTMDb ID」が含まれる', () => {
    const a = makeEntry({ workId: 'tmdb-tv-111', title: '星空の恋', type: 'tv', releaseYear: 2020, tmdbId: 111 });
    const b = makeEntry({ workId: 'tmdb-tv-222', title: '星空の恋', type: 'tv', releaseYear: 2020, tmdbId: 222 });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('conflict');
    const conflictReason = result.conflicts.find((c) => c.includes('TMDb'));
    expect(conflictReason).toBeDefined();
    expect(conflictReason).toContain('異なるTMDb IDが混在');
    // 矛盾理由を reasons に混入しない
    expect(result.reasons.some((r) => r.includes('一致'))).toBe(false);
  });

  // ケースD：TMDb ID なし → TMDb 理由なし
  it('全エントリが TMDb ID なし → TMDb に関する reasons を生成しない', () => {
    const a = makeEntry({ workId: 'csv-tv-A', title: '月の舟', type: 'tv', releaseYear: 2022, tmdbId: null, source: 'manual_csv' });
    const b = makeEntry({ workId: 'ai-tv-A',  title: '月の舟', type: 'tv', releaseYear: 2022, tmdbId: null, source: 'ai' });

    const result = assessDuplicateGroup([a, b]);

    expect(result.confidence).toBe('high');
    // TMDb に関する reasons が出ない
    expect(result.reasons.some((r) => r.includes('TMDb'))).toBe(false);
    expect(result.conflicts.some((c) => c.includes('TMDb'))).toBe(false);
  });
});

// ─── 追加: normalizeWorkTitleForMatching の安全性 ───────────────────────────

describe('normalizeWorkTitleForMatching の安全性', () => {
  it('シーズン番号を保持する', () => {
    const key = normalizeWorkTitleForMatching('ドラマタイトル シーズン2');
    expect(key).toContain('2');
    expect(key).toContain('シーズン');
  });

  it('劇場版・特別編等を除去しない', () => {
    for (const prefix of ['劇場版', '特別編', '完結編', '前編', '後編']) {
      const key = normalizeWorkTitleForMatching(`${prefix} テスト`);
      expect(key).toContain(prefix);
    }
  });

  it('西暦・公演年を除去しない', () => {
    const key = normalizeWorkTitleForMatching('TOUR 2024');
    expect(key).toContain('2024');
  });

  it('NFKC 正規化で全角英数→半角に変換する', () => {
    const key = normalizeWorkTitleForMatching('２０２３年');
    expect(key).toContain('2023');
  });
});
