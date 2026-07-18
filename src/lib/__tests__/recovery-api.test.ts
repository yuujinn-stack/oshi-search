/**
 * 復旧 API のルートハンドラーテスト + 純粋関数テスト
 *
 * カバー範囲:
 *   - VERCEL_ENV=production かつ DATA_RECOVERY_EXECUTION_ENABLED=true のみ実行許可
 *   - VERCEL_ENV=preview / development → 必ず 403
 *   - dry-run 時の DB 非書き込み
 *   - 101件以上の拒否（400）
 *   - 冪等性キーの二重実行拒否（409）
 *   - confirmToken 不一致の拒否（400）
 *   - 429/upstream_error 時に storeProducts が空配列を受け取り既存データを保持
 *   - canExecuteWorkRecovery / canExecuteProductRecovery 純粋関数
 *   - decideBulkVerdictCsvHandling 純粋関数（キャンセル時 API 未呼び出し保証）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── vi.hoisted でモックを先に確保 ────────────────────────────────────────────

const {
  mockNeonSql,
  mockHasIdempotencyKey,
  mockInsertWorkStatusHistory,
  mockGetWork,
  mockUpdateWorkStatus,
  mockDbSelect,
  mockUpsertProduct,
  mockGetRedis,
} = vi.hoisted(() => ({
  mockNeonSql:                vi.fn(),
  mockHasIdempotencyKey:      vi.fn().mockResolvedValue(false),
  mockInsertWorkStatusHistory: vi.fn().mockResolvedValue(undefined),
  mockGetWork:                vi.fn(),
  mockUpdateWorkStatus:       vi.fn().mockResolvedValue(undefined),
  mockDbSelect:               vi.fn(),
  mockUpsertProduct:          vi.fn().mockResolvedValue(undefined),
  mockGetRedis:               vi.fn(),
}));

vi.mock('@/db/client', () => ({
  neonSql: mockNeonSql,
  db: {
    select: () => ({
      from: () => ({ where: () => mockDbSelect() }),
    }),
  },
}));

vi.mock('@/db/write', () => ({
  hasIdempotencyKey:        mockHasIdempotencyKey,
  insertWorkStatusHistory:  mockInsertWorkStatusHistory,
  upsertProduct:            mockUpsertProduct,
}));

vi.mock('@/lib/work-store', () => ({
  getWork:          mockGetWork,
  updateWorkStatus: mockUpdateWorkStatus,
}));

vi.mock('@/lib/redis', () => ({
  getRedis: mockGetRedis,
}));

// ── ルートハンドラーのインポート（モック後）─────────────────────────────────
import { POST as workRecoveryPost } from '@/app/api/admin/work-recovery/route';
import { POST as productRecoveryPost } from '@/app/api/admin/product-recovery/route';

// ── 純粋関数のインポート ──────────────────────────────────────────────────────
import {
  canExecuteWorkRecovery,
  canExecuteProductRecovery,
} from '@/lib/recovery-guard';
import { decideBulkVerdictCsvHandling } from '@/lib/bulk-verdict-guard';

// ── ヘルパー ──────────────────────────────────────────────────────────────────
function makePost(url: string, body: object): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── work-recovery API テスト ──────────────────────────────────────────────────

describe('POST /api/admin/work-recovery', () => {
  const VALID_EXEC_BODY = {
    dryRun:         false,
    personName:     'テスト人物',
    workIds:        ['w-001'],
    targetStatus:   'auto_published',
    reason:         '孤立作品復旧テスト',
    idempotencyKey: 'test-key-001',
    confirmToken:   'RECOVER',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasIdempotencyKey.mockResolvedValue(false);
    mockInsertWorkStatusHistory.mockResolvedValue(undefined);
    mockUpdateWorkStatus.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DATA_RECOVERY_EXECUTION_ENABLED;
    delete process.env.VERCEL_ENV;
  });

  // ── 403: VERCEL_ENV 未設定（ローカル環境） ────────────────────────────────
  it('VERCEL_ENV 未設定で実行 → 403', async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.DATA_RECOVERY_EXECUTION_ENABLED;
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/本番環境|VERCEL_ENV/);
  });

  // ── 403: VERCEL_ENV=preview → Preview 環境では実行不可 ───────────────────
  it('VERCEL_ENV=preview で実行 → 403 (Preview禁止)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Preview/);
  });

  // ── 403: VERCEL_ENV=development → 開発環境も実行不可 ─────────────────────
  it('VERCEL_ENV=development で実行 → 403', async () => {
    process.env.VERCEL_ENV = 'development';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/開発環境/);
  });

  // ── 403: VERCEL_ENV=production だがフラグ未設定 ───────────────────────────
  it('VERCEL_ENV=production かつ DATA_RECOVERY_EXECUTION_ENABLED 未設定 → 403', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.DATA_RECOVERY_EXECUTION_ENABLED;
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DATA_RECOVERY_EXECUTION_ENABLED/);
  });

  // ── 403: execution flag = false ───────────────────────────────────────────
  it('DATA_RECOVERY_EXECUTION_ENABLED=false で実行 → 403', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'false';
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(403);
  });

  // ── dry-run: DB 書き込みなし ──────────────────────────────────────────────
  it('dryRun=true では updateWorkStatus を呼ばない', async () => {
    mockNeonSql.mockResolvedValueOnce([
      {
        person_name: 'テスト人物', work_id: 'w-001', title: 'テスト作品',
        type: '映画', source: 'manual_csv', status: 'hidden',
        checked_at: null, created_at: new Date(), updated_at: new Date(),
      },
    ]);
    const req = makePost('/api/admin/work-recovery', {
      dryRun: true, personName: 'テスト人物', workIds: ['w-001'],
    });
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { dryRun: boolean; count: number };
    expect(data.dryRun).toBe(true);
    expect(mockUpdateWorkStatus).not.toHaveBeenCalled();
  });

  // ── 400: 101件以上拒否 ────────────────────────────────────────────────────
  it('101件の workIds を指定 → 400', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const ids = Array.from({ length: 101 }, (_, i) => `w-${i.toString().padStart(3, '0')}`);
    const req = makePost('/api/admin/work-recovery', {
      ...VALID_EXEC_BODY,
      workIds: ids,
    });
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/100/);
  });

  // ── 409: 冪等性キーの二重実行拒否 ────────────────────────────────────────
  it('同一 idempotencyKey の二度目実行 → 409', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    mockHasIdempotencyKey.mockResolvedValueOnce(true);
    const req = makePost('/api/admin/work-recovery', VALID_EXEC_BODY);
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/既に実行済み/);
  });

  // ── 400: confirmToken 不一致 ──────────────────────────────────────────────
  it('confirmToken が "RECOVER" でない → 400', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/work-recovery', {
      ...VALID_EXEC_BODY,
      confirmToken: 'WRONG',
    });
    const res = await workRecoveryPost(req as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/RECOVER/);
  });
});

// ── product-recovery API テスト ───────────────────────────────────────────────

describe('POST /api/admin/product-recovery', () => {
  const VALID_CANDIDATES = [
    { productId: 'bk-abc123', redisCategory: '写真集' },
  ];
  const VALID_EXEC_BODY = {
    dryRun:         false,
    personName:     'テスト人物',
    candidates:     VALID_CANDIDATES,
    reason:         '孤立verdict復旧テスト',
    idempotencyKey: 'prod-key-001',
    confirmToken:   'RECOVER_PRODUCTS',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHasIdempotencyKey.mockResolvedValue(false);
    mockInsertWorkStatusHistory.mockResolvedValue(undefined);
    mockUpsertProduct.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.DATA_RECOVERY_EXECUTION_ENABLED;
    delete process.env.VERCEL_ENV;
  });

  // ── 503: Redis 未接続 ─────────────────────────────────────────────────────
  it('Redis 未接続 → 503', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    mockGetRedis.mockReturnValue(null);
    const req = makePost('/api/admin/product-recovery', VALID_EXEC_BODY);
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(503);
  });

  // ── 403: VERCEL_ENV=preview → Preview 環境では実行不可 ───────────────────
  it('VERCEL_ENV=preview で実行 → 403 (Preview禁止)', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/product-recovery', VALID_EXEC_BODY);
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Preview/);
  });

  // ── 403: VERCEL_ENV=development → 開発環境も実行不可 ─────────────────────
  it('VERCEL_ENV=development で実行 → 403', async () => {
    process.env.VERCEL_ENV = 'development';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/product-recovery', VALID_EXEC_BODY);
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(403);
  });

  // ── 403: execution flag 未設定 ────────────────────────────────────────────
  it('DATA_RECOVERY_EXECUTION_ENABLED 未設定で実行 → 403', async () => {
    process.env.VERCEL_ENV = 'production';
    delete process.env.DATA_RECOVERY_EXECUTION_ENABLED;
    const req = makePost('/api/admin/product-recovery', VALID_EXEC_BODY);
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/DATA_RECOVERY_EXECUTION_ENABLED/);
  });

  // ── 400: 101件以上拒否 ────────────────────────────────────────────────────
  it('101件の candidates を指定 → 400', async () => {
    const candidates = Array.from({ length: 101 }, (_, i) => ({
      productId:     `bk-${i.toString().padStart(4, '0')}`,
      redisCategory: '写真集',
    }));
    const req = makePost('/api/admin/product-recovery', {
      ...VALID_EXEC_BODY,
      candidates,
    });
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/100/);
  });

  // ── 409: 冪等性キーの二重実行拒否 ────────────────────────────────────────
  it('同一 idempotencyKey の二度目実行 → 409', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const redisMock = { hgetall: vi.fn().mockResolvedValue({}) };
    mockGetRedis.mockReturnValue(redisMock);
    mockDbSelect.mockResolvedValue([]);
    mockHasIdempotencyKey.mockResolvedValueOnce(true);
    const req = makePost('/api/admin/product-recovery', VALID_EXEC_BODY);
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/既に実行済み/);
  });

  // ── 400: confirmToken 不一致 ──────────────────────────────────────────────
  it('confirmToken が "RECOVER_PRODUCTS" でない → 400', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.DATA_RECOVERY_EXECUTION_ENABLED = 'true';
    const req = makePost('/api/admin/product-recovery', {
      ...VALID_EXEC_BODY,
      confirmToken: 'RECOVER',
    });
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/RECOVER_PRODUCTS/);
  });

  // ── dry-run: DB 書き込みなし ──────────────────────────────────────────────
  it('dryRun=true では upsertProduct を呼ばない', async () => {
    const redisMock = {
      hgetall: vi.fn().mockResolvedValue({
        '写真集': JSON.stringify([{
          id: 'bk-abc123', title: 'テスト写真集', price: 2000,
          imageUrl: '', itemUrl: 'https://books.rakuten.co.jp/rb/abc123/',
          affiliateUrl: '', category: '写真集', relevanceScore: 1,
          reviewAverage: 4.0, reviewCount: 5,
        }]),
      }),
    };
    mockGetRedis.mockReturnValue(redisMock);
    mockDbSelect.mockResolvedValue([]);

    const req = makePost('/api/admin/product-recovery', {
      personName:  'テスト人物',
      candidates:  VALID_CANDIDATES,
      dryRun:      true,
    });
    const res = await productRecoveryPost(req as never);
    expect(res.status).toBe(200);
    const data = await res.json() as { dryRun: boolean; recoverableCount: number };
    expect(data.dryRun).toBe(true);
    expect(data.recoverableCount).toBe(1);
    expect(mockUpsertProduct).not.toHaveBeenCalled();
  });

  // ── DB既存商品は復旧対象外 ────────────────────────────────────────────────
  it('DB に同一 productId が存在する場合は alreadyInDb にカウント', async () => {
    const redisMock = {
      hgetall: vi.fn().mockResolvedValue({
        '写真集': JSON.stringify([{
          id: 'bk-abc123', title: 'テスト', price: 1000,
          imageUrl: '', itemUrl: 'https://books.rakuten.co.jp/rb/abc123/',
          affiliateUrl: '', category: '写真集', relevanceScore: 1,
          reviewAverage: 3.5, reviewCount: 2,
        }]),
      }),
    };
    mockGetRedis.mockReturnValue(redisMock);
    // DB には既に bk-abc123 が存在
    mockDbSelect.mockResolvedValue([{
      category: '写真集',
      items: [{ id: 'bk-abc123', title: 'DB既存', price: 1000, imageUrl: '', itemUrl: '', affiliateUrl: '', category: '写真集', relevanceScore: 1, reviewAverage: 0, reviewCount: 0 }],
      fetchedAt: new Date(),
    }]);

    const req = makePost('/api/admin/product-recovery', {
      personName: 'テスト人物',
      candidates: VALID_CANDIDATES,
      dryRun:     true,
    });
    const res = await productRecoveryPost(req as never);
    const data = await res.json() as { recoverableCount: number; alreadyInDbCount: number };
    expect(data.recoverableCount).toBe(0);
    expect(data.alreadyInDbCount).toBe(1);
    expect(mockUpsertProduct).not.toHaveBeenCalled();
  });
});

// ── storeProducts の 429/error 耐性（明示的なラベル付きテスト） ─────────────

describe('storeProducts — 429/upstream_error 耐性', () => {
  afterEach(() => {
    delete process.env.VERCEL_ENV;
  });

  it('0件取得 + 既存あり = スキップして既存保持（429・タイムアウト時と同等）', async () => {
    const { storeProducts } = await import('@/lib/product-store');
    const { upsertProduct } = await import('@/db/write');
    const mockUpsert = vi.mocked(upsertProduct);

    vi.clearAllMocks();
    mockDbSelect.mockResolvedValueOnce([
      { category: '写真集', items: [{ id: 'e-1', title: '既存', price: 1000, imageUrl: '', itemUrl: '', affiliateUrl: '', category: '写真集', relevanceScore: 1, reviewAverage: 0, reviewCount: 0 }], fetchedAt: new Date() },
    ]);

    // 楽天APIが upstream_error / 429 → batch は products=[] を渡す
    const stats = await storeProducts('人物A', '写真集', []);

    expect(mockUpsert).not.toHaveBeenCalled();
    expect(stats.skippedBecauseError).toBe(true);
    expect(stats.retainedExistingCount).toBe(1);
    expect(stats.fetchedCount).toBe(0);
  });
});

// ── canExecuteWorkRecovery 純粋関数テスト ─────────────────────────────────────

describe('canExecuteWorkRecovery — 純粋関数', () => {
  const BASE = {
    confirmInput:    'RECOVER',
    reason:          '復旧テスト',
    selectedCount:   5,
    recoveryEnabled: true,
  };

  it('全条件揃い → true', () => {
    expect(canExecuteWorkRecovery(BASE)).toBe(true);
  });

  it('confirmInput が "RECOVER" でない → false（キャンセル相当）', () => {
    expect(canExecuteWorkRecovery({ ...BASE, confirmInput: '' })).toBe(false);
    expect(canExecuteWorkRecovery({ ...BASE, confirmInput: 'WRONG' })).toBe(false);
  });

  it('reason が空 → false', () => {
    expect(canExecuteWorkRecovery({ ...BASE, reason: '' })).toBe(false);
    expect(canExecuteWorkRecovery({ ...BASE, reason: '   ' })).toBe(false);
  });

  it('selectedCount が 0 → false', () => {
    expect(canExecuteWorkRecovery({ ...BASE, selectedCount: 0 })).toBe(false);
  });

  it('recoveryEnabled=false（Preview 等）→ false', () => {
    expect(canExecuteWorkRecovery({ ...BASE, recoveryEnabled: false })).toBe(false);
  });
});

// ── canExecuteProductRecovery 純粋関数テスト ──────────────────────────────────

describe('canExecuteProductRecovery — 純粋関数', () => {
  const BASE = {
    confirmInput:     'RECOVER_PRODUCTS',
    reason:           '商品復旧テスト',
    idempotencyKey:   'key-001',
    recoverableCount: 3,
    recoveryEnabled:  true,
  };

  it('全条件揃い → true', () => {
    expect(canExecuteProductRecovery(BASE)).toBe(true);
  });

  it('confirmInput が "RECOVER_PRODUCTS" でない → false（キャンセル相当）', () => {
    expect(canExecuteProductRecovery({ ...BASE, confirmInput: '' })).toBe(false);
    expect(canExecuteProductRecovery({ ...BASE, confirmInput: 'RECOVER' })).toBe(false);
  });

  it('reason が空 → false', () => {
    expect(canExecuteProductRecovery({ ...BASE, reason: '' })).toBe(false);
  });

  it('idempotencyKey が空 → false', () => {
    expect(canExecuteProductRecovery({ ...BASE, idempotencyKey: '' })).toBe(false);
    expect(canExecuteProductRecovery({ ...BASE, idempotencyKey: '   ' })).toBe(false);
  });

  it('recoverableCount が 0 → false', () => {
    expect(canExecuteProductRecovery({ ...BASE, recoverableCount: 0 })).toBe(false);
  });

  it('recoveryEnabled=false（Preview 等）→ false', () => {
    expect(canExecuteProductRecovery({ ...BASE, recoveryEnabled: false })).toBe(false);
  });
});

// ── decideBulkVerdictCsvHandling 純粋関数テスト ───────────────────────────────
// キャンセル時に fetch が呼ばれないことの根拠: proceed=false のとき
// PersonWorks.tsx の handleBulkWorkVerdict は即 return するため fetch に到達しない

describe('decideBulkVerdictCsvHandling — CSV 一括非表示キャンセル', () => {
  // ── キャンセル: 全件 CSV → proceed=false (API 未呼び出し) ─────────────────
  it('全件 CSV + キャンセル → proceed=false（API 呼ばない）', () => {
    const result = decideBulkVerdictCsvHandling('hidden', 3, 3, false);
    expect(result.proceed).toBe(false);
    expect(result.includeManualCsv).toBe(false);
  });

  // ── キャンセル: CSV + 非CSV 混在 → proceed=true, includeManualCsv=false ──
  it('CSV + 非CSV 混在 + キャンセル → proceed=true, CSV除外で続行', () => {
    const result = decideBulkVerdictCsvHandling('hidden', 5, 2, false);
    expect(result.proceed).toBe(true);
    expect(result.includeManualCsv).toBe(false);
  });

  // ── 確認: 全件 CSV + OK → proceed=true, includeManualCsv=true ────────────
  it('全件 CSV + OK → proceed=true, includeManualCsv=true', () => {
    const result = decideBulkVerdictCsvHandling('hidden', 3, 3, true);
    expect(result.proceed).toBe(true);
    expect(result.includeManualCsv).toBe(true);
  });

  // ── CSV 0件 → 確認なしで続行 ────────────────────────────────────────────
  it('CSV 0件 → 常に proceed=true, includeManualCsv=false', () => {
    const result = decideBulkVerdictCsvHandling('hidden', 5, 0, false);
    expect(result.proceed).toBe(true);
    expect(result.includeManualCsv).toBe(false);
  });

  // ── status が hidden 以外 → 確認不要 ─────────────────────────────────────
  it('status=auto_published は CSV 確認不要', () => {
    const result = decideBulkVerdictCsvHandling('auto_published', 5, 5, false);
    expect(result.proceed).toBe(true);
    expect(result.includeManualCsv).toBe(false);
  });

  // ── 作品復旧の最終確認キャンセル（confirmInput 不一致）= fetch 未呼び出し ─
  it('作品復旧: confirmInput 不一致 → canExecuteWorkRecovery=false（API 呼ばない）', () => {
    const result = canExecuteWorkRecovery({
      confirmInput:    '',
      reason:          '理由あり',
      selectedCount:   3,
      recoveryEnabled: true,
    });
    expect(result).toBe(false);
  });

  // ── 商品復旧の最終確認キャンセル（confirmInput 不一致）= fetch 未呼び出し ─
  it('商品復旧: confirmInput 不一致 → canExecuteProductRecovery=false（API 呼ばない）', () => {
    const result = canExecuteProductRecovery({
      confirmInput:     '',
      reason:           '理由あり',
      idempotencyKey:   'key-001',
      recoverableCount: 3,
      recoveryEnabled:  true,
    });
    expect(result).toBe(false);
  });
});
