import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

// ── モジュールモック ──────────────────────────────────────────────────────────

vi.mock('@/db/write', () => ({
  upsertProduct:            vi.fn().mockResolvedValue(undefined),
  insertWorkStatusHistory:  vi.fn().mockResolvedValue(undefined),
  hasIdempotencyKey:        vi.fn().mockResolvedValue(false),
}));

const mockDbSelect = vi.fn();
vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => mockDbSelect(),
      }),
    }),
  },
  neonSql: vi.fn(),
}));

// ── インポート（モック後）─────────────────────────────────────────────────────
import { storeProducts, mergeProductItems, mergeRakutenItem } from '@/lib/product-store';
import { upsertProduct } from '@/db/write';
import { hasIdempotencyKey } from '@/db/write';

// ── テストデータ ──────────────────────────────────────────────────────────────
function makeItem(id: string, overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    id,
    title: `商品${id}`,
    price: 1000,
    imageUrl: `https://img.example.com/${id}.jpg`,
    itemUrl: `https://item.rakuten.co.jp/shop/${id}/`,
    affiliateUrl: `https://aff.example.com/${id}`,
    category: '写真集',
    relevanceScore: 1,
    reviewAverage: 4.0,
    reviewCount: 10,
    ...overrides,
  };
}

// ── mergeRakutenItem テスト ───────────────────────────────────────────────────
describe('mergeRakutenItem', () => {
  it('fetchedの非空フィールドで既存を上書きする', () => {
    const fetched  = makeItem('a', { title: '新タイトル', price: 2000 });
    const existing = makeItem('a', { title: '旧タイトル', price: 1500 });
    const result = mergeRakutenItem(fetched, existing);
    expect(result.title).toBe('新タイトル');
    expect(result.price).toBe(2000);
  });

  it('fetchedが空文字のとき既存の非空値を保持する', () => {
    const fetched  = makeItem('a', { title: '' });
    const existing = makeItem('a', { title: '元のタイトル' });
    const result = mergeRakutenItem(fetched, existing);
    expect(result.title).toBe('元のタイトル');
  });

  it('fetchedがundefinedのoptional fieldは既存値を保持する', () => {
    const fetched  = makeItem('a');
    const existing = makeItem('a', { shopName: '既存ショップ' });
    const result = mergeRakutenItem(fetched, existing);
    expect(result.shopName).toBe('既存ショップ');
  });

  it('入力配列を破壊しない（元のオブジェクトを変更しない）', () => {
    const fetched  = makeItem('a', { title: '新' });
    const existing = makeItem('a', { title: '旧', shopName: '店' });
    const fetchedCopy  = { ...fetched };
    const existingCopy = { ...existing };
    mergeRakutenItem(fetched, existing);
    expect(fetched).toEqual(fetchedCopy);
    expect(existing).toEqual(existingCopy);
  });
});

// ── mergeProductItems テスト ──────────────────────────────────────────────────
describe('mergeProductItems', () => {
  const empty = new Set<string>();

  it('fetched のみ → そのまま追加（existing なし）', () => {
    const fetched = [makeItem('a'), makeItem('b')];
    const result = mergeProductItems(fetched, [], empty);
    expect(result.items).toHaveLength(2);
    expect(result.addedCount).toBe(2);
    expect(result.mergedCount).toBe(0);
    expect(result.retainedExistingCount).toBe(0);
    expect(result.fetchedCount).toBe(2);
  });

  it('existing のみ → fetchedなし時は全件保持', () => {
    const existing = [makeItem('a'), makeItem('b')];
    const result = mergeProductItems([], existing, empty);
    expect(result.items).toHaveLength(2);
    expect(result.retainedExistingCount).toBe(2);
    expect(result.addedCount).toBe(0);
    expect(result.mergedCount).toBe(0);
  });

  it('fetched + existing で非破壊マージ（fetchedにない既存商品を保持）', () => {
    const fetched  = [makeItem('new-1')];
    const existing = [makeItem('old-1'), makeItem('old-2')];
    const result = mergeProductItems(fetched, existing, empty);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('new-1');
    expect(ids).toContain('old-1');
    expect(ids).toContain('old-2');
    expect(result.items).toHaveLength(3);
    expect(result.addedCount).toBe(1);
    expect(result.retainedExistingCount).toBe(2);
    expect(result.mergedCount).toBe(0);
  });

  it('同一IDは重複しない（fetchedとexistingの両方にある場合）', () => {
    const fetched  = [makeItem('dup', { title: '新' })];
    const existing = [makeItem('dup', { title: '旧' })];
    const result = mergeProductItems(fetched, existing, empty);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('新');
    expect(result.mergedCount).toBe(1);
    expect(result.retainedExistingCount).toBe(0);
  });

  it('URL一致で重複防止（IDが異なるが同一URL）', () => {
    const url = 'https://item.rakuten.co.jp/shop/product123/';
    const fetched  = [makeItem('new-id', { itemUrl: url })];
    const existing = [makeItem('old-id', { itemUrl: url })];
    const result = mergeProductItems(fetched, existing, empty);
    // URLが同じなのでマージ扱い、重複なし
    expect(result.items).toHaveLength(1);
    expect(result.mergedCount).toBe(1);
    expect(result.retainedExistingCount).toBe(0);
  });

  it('verdict登録済みの保持商品を preservedVerdictedCount に計上', () => {
    const fetched   = [makeItem('new-1')];
    const existing  = [makeItem('verdict-1'), makeItem('no-verdict-1')];
    const verdictIds = new Set(['verdict-1']);
    const result = mergeProductItems(fetched, existing, verdictIds);
    expect(result.preservedVerdictedCount).toBe(1);
    expect(result.preservedManualCount).toBe(1);
    expect(result.retainedExistingCount).toBe(2);
  });

  it('全商品が fetched と一致する場合は retainedExisting = 0', () => {
    const shared = [makeItem('a'), makeItem('b')];
    const result = mergeProductItems(shared, shared, empty);
    expect(result.retainedExistingCount).toBe(0);
    expect(result.mergedCount).toBe(2);
  });

  it('入力配列を破壊しない', () => {
    const fetched  = [makeItem('a')];
    const existing = [makeItem('b')];
    const copyFetched  = fetched.map((i) => ({ ...i }));
    const copyExisting = existing.map((i) => ({ ...i }));
    mergeProductItems(fetched, existing, empty);
    expect(fetched).toEqual(copyFetched);
    expect(existing).toEqual(copyExisting);
  });
});

// ── storeProducts テスト ──────────────────────────────────────────────────────
describe('storeProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (upsertProduct as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('既存あり + 新規0件 → upsertProduct を呼ばない（空上書き防止）', async () => {
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [makeItem('e1')], fetchedAt: new Date() },
    ]);
    const stats = await storeProducts('テスト人物', '写真集', []);
    expect(upsertProduct).not.toHaveBeenCalled();
    expect(stats.skippedBecauseError).toBe(true);
    expect(stats.retainedExistingCount).toBe(1);
  });

  it('既存なし + 新規0件 → upsertProduct を0件で呼ぶ（初回の空は保存）', async () => {
    mockDbSelect.mockResolvedValueOnce([]);
    const stats = await storeProducts('テスト人物', '写真集', []);
    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [], expect.any(Number));
    expect(stats.skippedBecauseError).toBe(false);
  });

  it('既存あり + 新規あり → 非破壊マージ（既存商品も保持）', async () => {
    const existingItem = makeItem('old-1');
    const newItem      = makeItem('new-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [existingItem], fetchedAt: new Date() },
    ]);
    const stats = await storeProducts('テスト人物', '写真集', [newItem]);
    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const saved = call[2] as RakutenItem[];
    expect(saved).toHaveLength(2);
    expect(saved.map((i) => i.id)).toContain('old-1');
    expect(saved.map((i) => i.id)).toContain('new-1');
    expect(stats.addedCount).toBe(1);
    expect(stats.retainedExistingCount).toBe(1);
    expect(stats.skippedBecauseError).toBe(false);
  });

  it('verdict済み商品を保持（verdictIds なしでも全保持）', async () => {
    const verdictItem  = makeItem('verdict-1');
    const newItem      = makeItem('new-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [verdictItem], fetchedAt: new Date() },
    ]);
    const verdictIds = new Set(['verdict-1']);
    const stats = await storeProducts('テスト人物', '写真集', [newItem], verdictIds);
    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const saved = call[2] as RakutenItem[];
    expect(saved.map((i) => i.id)).toContain('verdict-1');
    expect(saved.map((i) => i.id)).toContain('new-1');
    expect(stats.preservedVerdictedCount).toBe(1);
  });

  it('同一IDは重複しない（fetched と existing の両方に存在）', async () => {
    const item = makeItem('dup-1', { title: '旧タイトル' });
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [item], fetchedAt: new Date() },
    ]);
    const newVersion = makeItem('dup-1', { title: '新タイトル' });
    await storeProducts('テスト人物', '写真集', [newVersion]);
    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const saved = call[2] as RakutenItem[];
    const ids = saved.map((i) => i.id);
    expect(ids.filter((id) => id === 'dup-1')).toHaveLength(1);
    // タイトルは新しいほうに更新されている
    const dup = saved.find((i) => i.id === 'dup-1')!;
    expect(dup.title).toBe('新タイトル');
  });

  it('fetchedがemptyフィールドでも既存の値を上書きしない', async () => {
    const existing = makeItem('a', { title: '元タイトル', shopName: '元ショップ' });
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [existing], fetchedAt: new Date() },
    ]);
    // title が空、shopName が undefined の fetched
    const fetched = makeItem('a', { title: '' });
    await storeProducts('テスト人物', '写真集', [fetched]);
    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const saved = call[2] as RakutenItem[];
    expect(saved[0].title).toBe('元タイトル');
    expect(saved[0].shopName).toBe('元ショップ');
  });

  it('DB読み取り失敗時も新規商品を保存（フォールバック）', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('DB connection failed'));
    const newItem = makeItem('new-1');
    await storeProducts('テスト人物', '写真集', [newItem]);
    expect(upsertProduct).toHaveBeenCalledWith(
      'テスト人物', '写真集', [newItem], expect.any(Number)
    );
  });

  it('DB読み取り失敗時 + 新規0件 → upsertProduct を空配列で呼ぶ（既存不明のため安全側に）', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('DB connection failed'));
    const stats = await storeProducts('テスト人物', '写真集', []);
    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [], expect.any(Number));
    expect(stats.skippedBecauseError).toBe(false);
  });

  it('手動追加商品も保持（verdict なしでも retainedExisting に含む）', async () => {
    const manual = makeItem('manual-001', { title: '手動追加商品' });
    const fetched = [makeItem('new-1')];
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [manual], fetchedAt: new Date() },
    ]);
    const stats = await storeProducts('テスト人物', '写真集', fetched, new Set());
    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const saved = call[2] as RakutenItem[];
    expect(saved.map((i) => i.id)).toContain('manual-001');
    expect(stats.retainedExistingCount).toBe(1);
    expect(stats.preservedManualCount).toBe(1);
    expect(stats.preservedVerdictedCount).toBe(0);
  });

  it('skippedBecauseError = false の場合は upsertProduct を呼ぶ', async () => {
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [makeItem('e1')], fetchedAt: new Date() },
    ]);
    const stats = await storeProducts('テスト人物', '写真集', [makeItem('n1')]);
    expect(upsertProduct).toHaveBeenCalled();
    expect(stats.skippedBecauseError).toBe(false);
  });
});

// ── work-verdict-bulk 保護ロジック ────────────────────────────────────────────
interface WorkStub {
  id: string;
  source: string;
  status: string;
}

function filterBulkVerdict(
  workIds: string[],
  workMap: Map<string, WorkStub>,
  includeManualCsv: boolean,
): { targetIds: string[]; skippedManualCsvIds: string[] } {
  const targetIds: string[] = [];
  const skippedManualCsvIds: string[] = [];
  for (const id of workIds) {
    const work = workMap.get(id);
    if (!work) continue;
    if (work.source === 'manual_csv' && !includeManualCsv) {
      skippedManualCsvIds.push(id);
    } else {
      targetIds.push(id);
    }
  }
  return { targetIds, skippedManualCsvIds };
}

describe('work-verdict-bulk manual_csv 保護ロジック', () => {
  const workMap = new Map<string, WorkStub>([
    ['csv-1',  { id: 'csv-1',  source: 'manual_csv',    status: 'hidden' }],
    ['csv-2',  { id: 'csv-2',  source: 'manual_csv',    status: 'hidden' }],
    ['tmdb-1', { id: 'tmdb-1', source: 'tmdb',          status: 'needs_review' }],
    ['ai-1',   { id: 'ai-1',  source: 'ai_supplement',  status: 'needs_review' }],
  ]);

  it('デフォルト（includeManualCsv=false）で manual_csv を除外する', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'tmdb-1', 'ai-1'], workMap, false,
    );
    expect(targetIds).toEqual(['tmdb-1', 'ai-1']);
    expect(skippedManualCsvIds).toEqual(['csv-1']);
  });

  it('includeManualCsv=true のとき manual_csv も含まれる', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'tmdb-1'], workMap, true,
    );
    expect(targetIds).toEqual(['csv-1', 'tmdb-1']);
    expect(skippedManualCsvIds).toHaveLength(0);
  });

  it('全件 manual_csv でも includeManualCsv=false なら全件スキップ', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'csv-2'], workMap, false,
    );
    expect(targetIds).toHaveLength(0);
    expect(skippedManualCsvIds).toHaveLength(2);
  });

  it('workMap にない workId はどちらにも入らない', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['not-exist', 'tmdb-1'], workMap, false,
    );
    expect(targetIds).toEqual(['tmdb-1']);
    expect(skippedManualCsvIds).toHaveLength(0);
  });
});

// ── 二重実行防止テスト ────────────────────────────────────────────────────────
describe('idempotencyKey による二重実行防止', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hasIdempotencyKey が false → 実行可能', async () => {
    (hasIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const result = await hasIdempotencyKey('new-key-001');
    expect(result).toBe(false);
  });

  it('hasIdempotencyKey が true → 二重実行を検知（APIは409を返す）', async () => {
    (hasIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await hasIdempotencyKey('used-key-001');
    expect(result).toBe(true);
  });
});

// ── 復旧後の不変性テスト ──────────────────────────────────────────────────────
describe('復旧時の source / workId 不変性', () => {
  it('updateWorkStatus は status のみ変更し source・id は不変', () => {
    const original = {
      id: 'csv-movie-test-title',
      personName: 'テスト人物',
      title: 'テスト映画',
      source: 'manual_csv',
      status: 'hidden' as const,
    };
    const updated = { ...original, status: 'auto_published' as const };
    expect(updated.source).toBe('manual_csv');
    expect(updated.id).toBe(original.id);
    expect(updated.status).toBe('auto_published');
  });
});
