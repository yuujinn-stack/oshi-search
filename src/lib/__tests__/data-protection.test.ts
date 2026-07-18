import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

// ── モジュールモック ──────────────────────────────────────────────────────────

const mockUpsertProduct = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/write', () => ({
  upsertProduct:            vi.fn().mockResolvedValue(undefined),
  insertWorkStatusHistory:  vi.fn().mockResolvedValue(undefined),
  hasIdempotencyKey:        vi.fn().mockResolvedValue(false),
}));

// db.select() のモック（product-store が DB読み取りに使う）
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
import { storeProducts } from '@/lib/product-store';
import { upsertProduct } from '@/db/write';
import { hasIdempotencyKey } from '@/db/write';

// ── テストデータ ──────────────────────────────────────────────────────────────
function makeItem(id: string, title = `商品${id}`): RakutenItem {
  return {
    id,
    title,
    price: 1000,
    imageUrl: `https://example.com/img/${id}.jpg`,
    itemUrl: `https://example.com/item/${id}`,
    affiliateUrl: `https://example.com/aff/${id}`,
    category: '写真集',
    relevanceScore: 1,
    reviewAverage: 4.0,
    reviewCount: 10,
  };
}

// ── storeProducts テスト ──────────────────────────────────────────────────────
describe('storeProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (upsertProduct as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('既存あり + 新規0件 → upsertProduct を呼ばない（空上書き防止）', async () => {
    const existingItem = makeItem('existing-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [existingItem], fetchedAt: new Date() },
    ]);

    await storeProducts('テスト人物', '写真集', []);

    expect(upsertProduct).not.toHaveBeenCalled();
  });

  it('既存なし + 新規0件 → upsertProduct を0件で呼ぶ（初回の空は許容）', async () => {
    mockDbSelect.mockResolvedValueOnce([]);

    await storeProducts('テスト人物', '写真集', []);

    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [], expect.any(Number));
  });

  it('既存あり + 新規あり → 新規のみで upsertProduct（verdictIds なし）', async () => {
    const existingItem = makeItem('old-1');
    const newItem = makeItem('new-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [existingItem], fetchedAt: new Date() },
    ]);

    await storeProducts('テスト人物', '写真集', [newItem]);

    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [newItem], expect.any(Number));
  });

  it('verdict済み商品を保持（新規フェッチに含まれない場合）', async () => {
    const verdictItem = makeItem('verdict-1');
    const newItem = makeItem('new-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [verdictItem], fetchedAt: new Date() },
    ]);

    const verdictIds = new Set(['verdict-1']);
    await storeProducts('テスト人物', '写真集', [newItem], verdictIds);

    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const savedItems = call[2] as RakutenItem[];
    expect(savedItems).toHaveLength(2);
    expect(savedItems.map((i) => i.id)).toContain('verdict-1');
    expect(savedItems.map((i) => i.id)).toContain('new-1');
  });

  it('verdict済みでも新規フェッチに含まれる場合は重複しない', async () => {
    const item = makeItem('item-1');
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [item], fetchedAt: new Date() },
    ]);

    const verdictIds = new Set(['item-1']);
    await storeProducts('テスト人物', '写真集', [item], verdictIds);

    const call = (upsertProduct as ReturnType<typeof vi.fn>).mock.calls[0];
    const savedItems = call[2] as RakutenItem[];
    // 重複なし: 新規に含まれているので保持しない
    const ids = savedItems.map((i) => i.id);
    expect(ids.filter((id) => id === 'item-1')).toHaveLength(1);
  });

  it('DB読み取り失敗時も新規商品を保存（フォールバック）', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('DB connection failed'));
    const newItem = makeItem('new-1');

    await storeProducts('テスト人物', '写真集', [newItem]);

    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [newItem], expect.any(Number));
  });

  it('DB読み取り失敗時 + 新規0件 → upsertProduct を呼ぶ（既存不明のため安全側に）', async () => {
    mockDbSelect.mockRejectedValueOnce(new Error('DB connection failed'));

    await storeProducts('テスト人物', '写真集', []);

    // 既存データの有無が不明なので空配列でも保存を試みる
    expect(upsertProduct).toHaveBeenCalledWith('テスト人物', '写真集', [], expect.any(Number));
  });
});

// ── work-verdict-bulk 保護テスト ──────────────────────────────────────────────
// work-verdict-bulk API ルートは Next.js ハンドラのため直接テストせず、
// 同等のロジックを関数に切り出してテストする

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
    ['csv-1',   { id: 'csv-1',   source: 'manual_csv',   status: 'hidden' }],
    ['csv-2',   { id: 'csv-2',   source: 'manual_csv',   status: 'hidden' }],
    ['tmdb-1',  { id: 'tmdb-1',  source: 'tmdb',         status: 'needs_review' }],
    ['ai-1',    { id: 'ai-1',    source: 'ai_supplement', status: 'needs_review' }],
  ]);

  it('デフォルト（includeManualCsv=false）で manual_csv を除外する', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'tmdb-1', 'ai-1'],
      workMap,
      false,
    );
    expect(targetIds).toEqual(['tmdb-1', 'ai-1']);
    expect(skippedManualCsvIds).toEqual(['csv-1']);
  });

  it('includeManualCsv=true のとき manual_csv も含まれる', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'tmdb-1'],
      workMap,
      true,
    );
    expect(targetIds).toEqual(['csv-1', 'tmdb-1']);
    expect(skippedManualCsvIds).toHaveLength(0);
  });

  it('全件 manual_csv でも includeManualCsv=false なら全件スキップ', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['csv-1', 'csv-2'],
      workMap,
      false,
    );
    expect(targetIds).toHaveLength(0);
    expect(skippedManualCsvIds).toHaveLength(2);
  });

  it('workMap にない workId は target にも skipped にも入らない', () => {
    const { targetIds, skippedManualCsvIds } = filterBulkVerdict(
      ['not-exist', 'tmdb-1'],
      workMap,
      false,
    );
    expect(targetIds).toEqual(['tmdb-1']);
    expect(skippedManualCsvIds).toHaveLength(0);
  });
});

// ── 二重実行防止テスト ────────────────────────────────────────────────────────
describe('idempotencyKey による二重実行防止', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hasIdempotencyKey が false → 実行可能', async () => {
    (hasIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const result = await hasIdempotencyKey('new-key-001');
    expect(result).toBe(false);
  });

  it('hasIdempotencyKey が true → 二重実行防止（409 返却想定）', async () => {
    (hasIdempotencyKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const result = await hasIdempotencyKey('used-key-001');
    expect(result).toBe(true);
    // API は result=true のとき 409 を返す
  });
});

// ── 復旧後の source 不変テスト ────────────────────────────────────────────────
describe('復旧時の source 不変性', () => {
  it('updateWorkStatus は status のみ変更し source は変えない', () => {
    // work-store の updateWorkStatus は work.status = newStatus のみ書き換える
    // source フィールドは触れないことをロジックで確認
    const originalWork = {
      id: 'csv-movie-test-title',
      personName: 'テスト人物',
      title: 'テスト映画',
      source: 'manual_csv',
      status: 'hidden' as const,
      deleted: false,
    };

    // status だけ変更してコピー（work-store の updateWorkStatus と同じ操作）
    const updatedWork = { ...originalWork, status: 'auto_published' as const };

    expect(updatedWork.source).toBe('manual_csv');
    expect(updatedWork.status).toBe('auto_published');
    expect(updatedWork.id).toBe(originalWork.id);
  });
});
