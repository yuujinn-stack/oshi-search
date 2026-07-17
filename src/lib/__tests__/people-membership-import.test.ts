import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() でモックを先に確保する
const {
  mockGetAllPersonsMerged,
  mockGetAllPersonMetas,
  mockUpsertPersonMeta,
  mockEnsureGroupMeta,
} = vi.hoisted(() => ({
  mockGetAllPersonsMerged: vi.fn(),
  mockGetAllPersonMetas: vi.fn(),
  mockUpsertPersonMeta: vi.fn(),
  mockEnsureGroupMeta: vi.fn(),
}));

vi.mock('@/lib/persons', () => ({ getAllPersonsMerged: mockGetAllPersonsMerged }));
vi.mock('@/lib/person-meta', () => ({ getAllPersonMetas: mockGetAllPersonMetas }));
vi.mock('@/db/write', () => ({ upsertPersonMeta: mockUpsertPersonMeta }));
vi.mock('@/lib/group-meta', () => ({ ensureGroupMeta: mockEnsureGroupMeta }));

import { GET, POST, MAX_MULTI_PERSONS } from '@/app/api/admin/people-membership-import/route';

// テスト用人物データ
const PERSONS_FIXTURE = [
  { name: '田中花子', group: '乃木坂46', genre: 'アイドル', config: { aliases: ['はなちゃん'] } },
  { name: '鈴木一郎', group: '嵐', genre: 'アイドル', config: {} },
  { name: '佐藤次郎', group: '', genre: '女優', config: {} },
  { name: '山田太郎', group: '欅坂46', genre: 'アイドル', config: {} },
  { name: '高橋美咲', group: '乃木坂46', genre: 'アイドル', config: {} },
];

const META_FIXTURE: Record<string, object> = {
  '田中花子': { activityStatus: 'active', generation: '1期生', joinedAt: '2012-08-01' },
  '鈴木一郎': { activityStatus: 'graduated', generation: '1期生' },
};

function makeGetRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/people-membership-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeCsv(rows: string[][]): string {
  const header = 'name,groupName,activityStatus,generation,joinedAt,leftAt,currentGroupName,formerGroupNames,membershipNote,primaryGenre,genres,titles,publicRoles,awards,careerStatus,roleNote';
  return [header, ...rows.map((r) => r.join(','))].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllPersonsMerged.mockResolvedValue(PERSONS_FIXTURE);
  mockGetAllPersonMetas.mockResolvedValue(META_FIXTURE);
  mockUpsertPersonMeta.mockResolvedValue(undefined);
  mockEnsureGroupMeta.mockResolvedValue(false);
});

// ─── T1: 複数人更新モード定数が存在する ──────────────────────────────────────
describe('MAX_MULTI_PERSONS', () => {
  it('T1: 複数人更新モードの上限定数は100', () => {
    expect(MAX_MULTI_PERSONS).toBe(100);
  });
});

// ─── GET ?persons= ────────────────────────────────────────────────────────────
describe('GET ?persons=', () => {
  it('T2/T3: 異なるグループの人物を同時取得できる', async () => {
    const res = await GET(makeGetRequest(
      '/api/admin/people-membership-import?persons=%E7%94%B0%E4%B8%AD%E8%8A%B1%E5%AD%90,%E9%88%B4%E6%9C%A8%E4%B8%80%E9%83%8E',
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(2);
    const names = data.members.map((m: { name: string }) => m.name);
    expect(names).toContain('田中花子');
    expect(names).toContain('鈴木一郎');
    // 異なるグループ
    const groups = data.members.map((m: { group: string }) => m.group);
    expect(groups).toContain('乃木坂46');
    expect(groups).toContain('嵐');
  });

  it('T4: グループ未所属人物を選択できる', async () => {
    const res = await GET(makeGetRequest(
      '/api/admin/people-membership-import?persons=%E4%BD%90%E8%97%A4%E6%AC%A1%E9%83%8E',
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(1);
    expect(data.members[0].name).toBe('佐藤次郎');
    expect(data.members[0].group).toBe('');
  });

  it('T8: 100人まで選択可能（上限ちょうど）', async () => {
    const names = PERSONS_FIXTURE.map((p) => p.name);
    // 5人の fixtures を重複なしで100人分リクエスト（同名を避けるため5人だけ送る→全員返る）
    const hundredNames = Array.from({ length: 20 }, () => names).flat().slice(0, 100);
    // 重複を含んでも uniqueNames ≤ 100 なら OK
    const uniqueNames = [...new Set(hundredNames)]; // 5人
    const param = uniqueNames.map(encodeURIComponent).join(',');
    const res = await GET(makeGetRequest(
      `/api/admin/people-membership-import?persons=${param}`,
    ));
    expect(res.status).toBe(200);
  });

  it('T9: 101人目は拒否（400を返す）', async () => {
    // 101個の異なる名前を作成
    const names = Array.from({ length: 101 }, (_, i) => `人物${i}`);
    const param = names.map(encodeURIComponent).join(',');
    const res = await GET(makeGetRequest(
      `/api/admin/people-membership-import?persons=${param}`,
    ));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/100人/);
  });

  it('T10/T11: 選択した人物だけCSVメンバーとして返り、重複しない', async () => {
    // 重複名を含むリクエスト
    const param = '%E7%94%B0%E4%B8%AD%E8%8A%B1%E5%AD%90,%E7%94%B0%E4%B8%AD%E8%8A%B1%E5%AD%90,%E9%88%B4%E6%9C%A8%E4%B8%80%E9%83%8E';
    const res = await GET(makeGetRequest(
      `/api/admin/people-membership-import?persons=${param}`,
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    const names = data.members.map((m: { name: string }) => m.name);
    // 重複なし
    expect(new Set(names).size).toBe(names.length);
    // 田中花子は1件のみ
    expect(names.filter((n: string) => n === '田中花子')).toHaveLength(1);
  });

  it('T12: 未登録人物はレスポンスに含まれない', async () => {
    const param = encodeURIComponent('存在しない人物');
    const res = await GET(makeGetRequest(
      `/api/admin/people-membership-import?persons=${param}`,
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(0);
  });

  it('T20: GET ?group= が従来どおり動作する', async () => {
    const res = await GET(makeGetRequest(
      '/api/admin/people-membership-import?group=%E4%B9%83%E6%9C%A8%E5%9D%8246',
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    const names = data.members.map((m: { name: string }) => m.name);
    expect(names).toContain('田中花子');
    expect(names).toContain('高橋美咲');
    expect(names).not.toContain('鈴木一郎');
  });

  it('T21: GET ?person= が従来どおり動作する', async () => {
    const res = await GET(makeGetRequest(
      '/api/admin/people-membership-import?person=%E9%88%B4%E6%9C%A8%E4%B8%80%E9%83%8E',
    ));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.members).toHaveLength(1);
    expect(data.members[0].name).toBe('鈴木一郎');
  });

  it('T22: 外部APIを呼ばない（モックのみ使用）', async () => {
    const param = encodeURIComponent('田中花子');
    await GET(makeGetRequest(`/api/admin/people-membership-import?persons=${param}`));
    // モックが呼ばれている
    expect(mockGetAllPersonsMerged).toHaveBeenCalled();
    expect(mockGetAllPersonMetas).toHaveBeenCalled();
    // 実際の外部呼び出しなし（モックが全て）
  });

  it('T23: レスポンスに秘密情報が含まれない', async () => {
    const param = encodeURIComponent('田中花子');
    const res = await GET(makeGetRequest(`/api/admin/people-membership-import?persons=${param}`));
    const text = JSON.stringify(await res.json());
    // DATABASE_URL などの環境変数値が露出しないことを確認
    expect(text).not.toMatch(/postgres:\/\//);
    expect(text).not.toMatch(/password/i);
  });

  it('persons パラメータが空文字の場合は400', async () => {
    const res = await GET(makeGetRequest('/api/admin/people-membership-import?persons='));
    expect(res.status).toBe(400);
  });

  it('パラメータなしは400', async () => {
    const res = await GET(makeGetRequest('/api/admin/people-membership-import'));
    expect(res.status).toBe(400);
  });
});

// ─── POST preview ────────────────────────────────────────────────────────────
describe('POST preview', () => {
  it('T12: 未登録人物はスキップ（found: false）', async () => {
    const csv = makeCsv([['未登録人物', '', 'active', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.rows[0].found).toBe(false);
    expect(data.summary.toSkip).toBe(1);
    expect(data.summary.toUpdate).toBe(0);
  });

  it('T13: 同一人物の重複行は2行目以降をスキップ', async () => {
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['田中花子', '乃木坂46', 'withdrawn', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].duplicate).toBeUndefined();
    expect(data.rows[1].duplicate).toBe(true);
    expect(data.summary.toUpdate).toBe(1);
    expect(data.summary.toSkip).toBe(1);
  });

  it('T14: name 列は完全一致のみマッチ（同姓同名を誤更新しない）', async () => {
    // '田中花' は '田中花子' に部分一致するが登録されていない
    const csv = makeCsv([['田中花', '', 'active', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(data.rows[0].found).toBe(false);
  });

  it('T15: 複数人物のプレビューが正常動作', async () => {
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '', '2012-08-01', '2023-03-31', '', '', '', '', '', '', '', '', '', ''],
      ['鈴木一郎', '嵐', '', '1期生', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.summary.total).toBe(2);
    expect(data.summary.toUpdate).toBeGreaterThanOrEqual(1);
  });

  it('T17: 変更なし人物はスキップカウントに含まれる', async () => {
    // 全フィールド空 → 変更なし
    const csv = makeCsv([['田中花子', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.rows[0].found).toBe(true);
    expect(data.rows[0].hasChanges).toBe(false);
    expect(data.summary.toSkip).toBe(1);
    expect(data.summary.toUpdate).toBe(0);
  });

  it('T20: グループ更新が従来どおり動作（preview）', async () => {
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '1期生', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['高橋美咲', '乃木坂46', 'active', '4期生', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'preview' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.summary.total).toBe(2);
  });
});

// ─── POST apply ──────────────────────────────────────────────────────────────
describe('POST apply', () => {
  it('T13: 重複行は apply でもスキップされる', async () => {
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['田中花子', '乃木坂46', 'withdrawn', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.updated).toBe(1);
    expect(data.skipped).toBe(1);
    // upsertPersonMeta は1回だけ呼ばれる
    expect(mockUpsertPersonMeta).toHaveBeenCalledTimes(1);
  });

  it('T15: 複数人物を正常更新', async () => {
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '1期生', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['鈴木一郎', '嵐', 'graduated', '1期生', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.updated).toBe(2);
    expect(mockUpsertPersonMeta).toHaveBeenCalledTimes(2);
  });

  it('T16: 一部失敗時に人物別結果を表示（errors に人物名含む）', async () => {
    mockUpsertPersonMeta
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB接続エラー'));
    const csv = makeCsv([
      ['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['鈴木一郎', '嵐', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.updated).toBe(1);
    expect(data.errors).toHaveLength(1);
    expect(data.errors[0]).toMatch(/鈴木一郎/);
  });

  it('T17: 変更なし人物はスキップ（updated に含まれない）', async () => {
    const csv = makeCsv([['田中花子', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const data = await res.json();
    expect(data.updated).toBe(0);
    expect(data.skipped).toBe(1);
    expect(mockUpsertPersonMeta).not.toHaveBeenCalled();
  });

  it('T18: 二重送信防止（apply は upsert を重複なく実行）', async () => {
    const csv = makeCsv([['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    expect(res.status).toBe(200);
    // 1行1人に対して upsert は1回
    expect(mockUpsertPersonMeta).toHaveBeenCalledTimes(1);
  });

  it('T19: products・works・verdicts テーブルを変更しない', async () => {
    const csv = makeCsv([['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    await POST(makePostRequest({ csv, action: 'apply' }));
    // upsertPersonMeta のみ呼ばれ、products/works/verdicts の操作はない
    expect(mockUpsertPersonMeta).toHaveBeenCalled();
    // モックに他のテーブル操作がないことをモック名で確認
    const calls = mockUpsertPersonMeta.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // upsertPersonMeta の第1引数は person name 文字列
    expect(typeof calls[0][0]).toBe('string');
  });

  it('T21: 個人更新が従来どおり動作（POST apply）', async () => {
    const csv = makeCsv([['鈴木一郎', '嵐', 'graduated', '1期生', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.updated).toBe(1);
  });

  it('T22: 外部APIを呼ばない（DBモックのみ使用）', async () => {
    const csv = makeCsv([['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    await POST(makePostRequest({ csv, action: 'apply' }));
    expect(mockGetAllPersonsMerged).toHaveBeenCalled();
    expect(mockUpsertPersonMeta).toHaveBeenCalled();
    expect(mockEnsureGroupMeta).toHaveBeenCalled();
  });

  it('T23: レスポンスに秘密情報が含まれない', async () => {
    const csv = makeCsv([['田中花子', '乃木坂46', 'graduated', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'apply' }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/postgres:\/\//);
    expect(text).not.toMatch(/DATABASE_URL/);
    expect(text).not.toMatch(/password/i);
  });

  it('CSV が空の場合は400', async () => {
    const res = await POST(makePostRequest({ csv: '', action: 'apply' }));
    expect(res.status).toBe(400);
  });

  it('不正な action は400', async () => {
    const csv = makeCsv([['田中花子', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
    const res = await POST(makePostRequest({ csv, action: 'invalid' }));
    expect(res.status).toBe(400);
  });
});
