// Client / Server boundary 再発防止テスト。
//
// 背景: work-review-signals.ts が neonSql（@/db/client）とクライアント安全な純粋関数
// （isReleaseYearTooOld等）を同一ファイルに同居させていたため、PersonWorks.tsx
// （'use client'）がこのファイルをimportした際、ファイル全体（DBスキーマ・
// @neondatabase/serverlessを含む）がブラウザ向けクライアントバンドルへ巻き込まれ、
// ブラウザ実行時に `neon()` が DATABASE_URL なしで呼ばれてクラッシュした
// （/admin/work-check が "This page couldn't load" になった実インシデント）。
//
// このテストは、'use client' が付与された全ファイルの静的import（TypeScript AST等は
// 使わず正規表現で十分・importの構文は限定的なため）を辿り、DBへアクセスする
// server-onlyモジュール（src/db/client.ts・src/db/write.ts・src/db/schema.ts）へ
// 到達しないことを機械的に検証する。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';

const ROOT = resolve(__dirname, '../../..');
const SRC = resolve(ROOT, 'src');

// glob等の外部パッケージに依存せず、.tsxファイルを再帰的に列挙する簡易ヘルパー
function findTsxFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findTsxFilesRecursive(full));
    } else if (entry.endsWith('.tsx') && !entry.includes('__tests__')) {
      results.push(full);
    }
  }
  return results;
}

// これらのファイルはDBへアクセスすることが許可されている（server-onlyエントリ）。
// Client Componentの到達グラフにこれらが含まれていたら失敗とする。
const FORBIDDEN_SERVER_ONLY_FILES = [
  'src/db/client.ts',
  'src/db/write.ts',
  'src/db/schema.ts',
];

// import文（value import・re-export含む。`import type` は除外＝型はビルド時に消える）
const IMPORT_RE = /^\s*import\s+(?!type\s)(?:[\s\S]*?from\s+)?['"]([^'"]+)['"];?/gm;
const EXPORT_FROM_RE = /^\s*export\s+(?!type\s)(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"];?/gm;

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) specs.push(m[1]);
  }
  return specs;
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let target: string;
  if (spec.startsWith('@/')) {
    target = resolve(SRC, spec.slice(2));
  } else if (spec.startsWith('.')) {
    target = resolve(dirname(fromFile), spec);
  } else {
    return null; // 外部パッケージ（node_modules）はここでは追跡しない
  }
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    join(target, 'index.ts'),
    join(target, 'index.tsx'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

// fromFileを起点に、'@/lib/**' '@/db/**' などプロジェクト内モジュールだけを
// 深さ優先で辿り、FORBIDDEN_SERVER_ONLY_FILESに到達するパスがあれば返す。
function findForbiddenPath(entryFile: string): string[] | null {
  const visited = new Set<string>();
  const forbiddenAbs = new Set(FORBIDDEN_SERVER_ONLY_FILES.map((f) => resolve(ROOT, f)));

  function walk(file: string, path: string[]): string[] | null {
    const rel = file.replace(ROOT + '/', '');
    if (forbiddenAbs.has(file)) return [...path, rel];
    if (visited.has(file)) return null;
    visited.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
    for (const spec of extractImportSpecifiers(source)) {
      const resolved = resolveSpecifier(file, spec);
      if (!resolved) continue;
      const hit = walk(resolved, [...path, rel]);
      if (hit) return hit;
    }
    return null;
  }

  return walk(entryFile, []);
}

// 元々 app/admin 配下のみを対象にしていたが、公開ページ（/vod/[provider] 等）への
// 追加変更でも同種の事故が起きないよう、app配下全体（公開ページ含む）を対象にする。
const allAppTsxFiles = findTsxFilesRecursive(resolve(SRC, 'app'));
const clientFiles = allAppTsxFiles.filter((f) => {
  const head = readFileSync(f, 'utf-8').slice(0, 200);
  return /^\s*['"]use client['"]/.test(head);
});

describe('Client/Server boundary: use clientファイルはDBモジュールへ到達しない', () => {
  it('少なくとも1件以上の use client ファイルが検出される（テスト自体の健全性確認）', () => {
    expect(clientFiles.length).toBeGreaterThan(0);
  });

  it('work-review-signals.ts はDBモジュール(@/db/*)をimportしていない（今回の直接原因の再発防止）', () => {
    const file = resolve(SRC, 'lib/work-review-signals.ts');
    const source = readFileSync(file, 'utf-8');
    const specs = extractImportSpecifiers(source);
    expect(specs.some((s) => s.startsWith('@/db/'))).toBe(false);
  });

  it('pending-dedup-store.ts（DBアクセスあり）は server-only を宣言している', () => {
    const source = readFileSync(resolve(SRC, 'lib/pending-dedup-store.ts'), 'utf-8');
    expect(source).toMatch(/import ['"]server-only['"];?/);
  });

  it.each(clientFiles.map((f) => [f.replace(ROOT + '/', ''), f] as const))(
    '%s は db/client・db/write・db/schema へ到達しない',
    (_label, file) => {
      const hit = findForbiddenPath(file);
      expect(hit, hit ? `import chain: ${hit.join(' -> ')}` : undefined).toBeNull();
    },
  );
});
