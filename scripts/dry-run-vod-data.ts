// dry-run: 全作品のVOD配信レコードを集計する（読み取り専用・書き込みなし）
// 実行: npm run dotenv -- npx tsx scripts/dry-run-vod-data.ts
// または: npx dotenv-cli -e .env.local -- npx tsx scripts/dry-run-vod-data.ts

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { works as worksTable, vodProviders as vodProvidersTable } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import type { VodProvider } from '../src/types/vod';
import { normalizeProviderName } from '../src/lib/vod-dedup';

const KNOWN_TERMINATED_SLUGS = new Set(['dtv', 'gyao', 'paravi']);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL 未設定'); process.exit(1); }

  const sql  = neon(url);
  const db   = drizzle(sql, { schema: { works: worksTable, vodProviders: vodProvidersTable } });

  // ── 1. vod_providers マスタ読み込み ──
  const masterRows = await db.select().from(vodProvidersTable);
  const masterSlugs = new Set(masterRows.map((r) => r.slug));
  const activeSlugs  = new Set(masterRows.filter((r) => r.isActive).map((r) => r.slug));
  const inactiveSlugs = new Set([
    ...KNOWN_TERMINATED_SLUGS,
    ...masterRows.filter((r) => !r.isActive).map((r) => normalizeProviderName(r.slug)),
  ]);

  // ── 2. 全公開作品の vodData を取得 ──
  const rows = await db
    .select({ id: worksTable.id, personName: worksTable.personName, title: worksTable.title, vodData: worksTable.vodData })
    .from(worksTable)
    .where(eq(worksTable.status, 'auto_published'));

  console.log(`\n対象作品数（auto_published）: ${rows.length}件\n`);

  // ── 3. 集計 ──
  let totalVodRecords   = 0;
  let unknownCount      = 0;
  let terminatedCount   = 0;
  let hiddenCount       = 0;
  let lowConfAiCount    = 0;
  let publicCount       = 0;

  const providerNameCounts   = new Map<string, number>();   // raw name → count
  const normalizedCounts     = new Map<string, number>();   // normalized slug → count
  const unregisteredNames    = new Map<string, Set<string>>(); // norm slug → set of raw names
  const aliasMatchNames      = new Map<string, string>();   // raw → normalized (alias変換あり)
  const terminatedWorks      = new Map<string, string[]>(); // workKey → provider names
  const duplicateWorks: { workKey: string; slug: string; names: string[] }[] = [];
  const primeVideoChannels   = new Set<string>();

  for (const row of rows) {
    const vodProviders = ((row.vodData as Record<string, unknown> | null)?.vodProviders ?? []) as VodProvider[];
    if (!vodProviders.length) continue;

    totalVodRecords += vodProviders.length;

    // 重複検出用（この作品内）
    const seenNormalized = new Map<string, string[]>(); // norm → raw names

    for (const p of vodProviders) {
      const raw  = p.providerName ?? '';
      const norm = normalizeProviderName(raw);
      const workKey = `${row.personName}/${row.id}`;

      // カウント
      providerNameCounts.set(raw, (providerNameCounts.get(raw) ?? 0) + 1);
      normalizedCounts.set(norm,  (normalizedCounts.get(norm)  ?? 0) + 1);

      // alias変換検出
      const afterJpOnly = raw.trim().toLowerCase()
        .replace(/\s*csv\s*$/i, '').replace(/^csv\s+/i, '')
        .replace(/\s*[|｜]\s*.*$/g, '').replace(/[+＋]/g, 'plus')
        .replace(/[-‐‑‒–—―－_\s・　]/g, '').replace(/[（(][^)）]*[)）]/g, '').trim()
        .replace(/jp$/, '');
      const simpleNorm = afterJpOnly.length >= 2 ? afterJpOnly : raw.trim().toLowerCase().replace(/[-_\s・　]/g, '');
      if (simpleNorm !== norm) {
        aliasMatchNames.set(raw, norm);
      }

      // Prime Videoチャンネル候補（prime含む名称）
      if (norm !== 'primevideo' && (norm.includes('prime') || raw.toLowerCase().includes('prime'))) {
        primeVideoChannels.add(raw);
      }

      // 終了サービス
      if (inactiveSlugs.has(norm)) {
        terminatedCount++;
        const list = terminatedWorks.get(workKey) ?? [];
        list.push(raw);
        terminatedWorks.set(workKey, list);
      }

      // unknown
      if (!raw || raw.trim().toLowerCase() === 'unknown' || p.type === 'unknown') {
        unknownCount++;
      }

      // hidden
      if (p.hidden) hiddenCount++;

      // AI low confidence
      const isAi = p.source === 'openai_supplement' || p.source === 'openai_web_search';
      if (isAi && p.confidence === 'low') lowConfAiCount++;

      // 未登録（マスタに存在しない）
      if (!masterSlugs.has(norm) && !inactiveSlugs.has(norm) && raw.trim().toLowerCase() !== 'unknown') {
        const existing = unregisteredNames.get(norm) ?? new Set<string>();
        existing.add(raw);
        unregisteredNames.set(norm, existing);
      }

      // 作品内重複検出
      const existing = seenNormalized.get(norm) ?? [];
      existing.push(raw);
      seenNormalized.set(norm, existing);
    }

    // 作品内重複
    for (const [slug, names] of seenNormalized.entries()) {
      if (names.length > 1) {
        duplicateWorks.push({ workKey: `${row.personName}/${row.title}`, slug, names });
      }
    }

    // 公開対象件数（今のルールで表示される件数）
    const displayed = new Set<string>();
    for (const p of vodProviders) {
      const raw  = p.providerName ?? '';
      const norm = normalizeProviderName(raw);
      if (p.hidden) continue;
      if (!raw || raw.trim().toLowerCase() === 'unknown') continue;
      if (p.type === 'unknown') continue;
      const isAi = p.source === 'openai_supplement' || p.source === 'openai_web_search';
      if (isAi && p.confidence === 'low') continue;
      if (inactiveSlugs.has(norm)) continue;
      displayed.add(norm);
    }
    publicCount += displayed.size;
  }

  // ── 4. 出力 ──
  console.log('=== VOD配信レコード集計（dry-run・書き込みなし）===\n');
  console.log(`VOD配信レコード総数: ${totalVodRecords}件`);
  console.log(`終了サービス件数   : ${terminatedCount}件`);
  console.log(`unknown件数        : ${unknownCount}件`);
  console.log(`hidden件数         : ${hiddenCount}件`);
  console.log(`AI low-conf件数    : ${lowConfAiCount}件`);
  console.log(`作品内重複件数      : ${duplicateWorks.length}件`);
  console.log(`alias変換対象件数   : ${aliasMatchNames.size}種類（${[...aliasMatchNames.keys()].join(', ') || 'なし'}）`);
  console.log(`公開対象（除外後）  : ${publicCount}件（作品×サービスの延べ数）`);

  console.log('\n--- 一意なproviderName（正規化前・上位50件）---');
  const sortedRaw = [...providerNameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  for (const [name, cnt] of sortedRaw) {
    const norm = normalizeProviderName(name);
    const master = masterSlugs.has(norm) ? '✓' : (inactiveSlugs.has(norm) ? '✗終了' : '?未登録');
    console.log(`  ${master}  "${name}" (${cnt}件) → slug="${norm}"`);
  }

  console.log('\n--- 未登録サービス名（vod_providersに存在しない）---');
  if (unregisteredNames.size === 0) {
    console.log('  (なし)');
  } else {
    for (const [norm, names] of [...unregisteredNames.entries()].sort()) {
      console.log(`  slug="${norm}" ← 表記: ${[...names].join(' / ')}`);
    }
  }

  console.log('\n--- alias変換が発生するサービス名（正規化前後が異なる）---');
  if (aliasMatchNames.size === 0) {
    console.log('  (なし)');
  } else {
    for (const [raw, norm] of aliasMatchNames.entries()) {
      console.log(`  "${raw}" → "${norm}"`);
    }
  }

  console.log('\n--- 作品内で正規化後に重複するサービス ---');
  if (duplicateWorks.length === 0) {
    console.log('  (なし)');
  } else {
    for (const d of duplicateWorks.slice(0, 20)) {
      console.log(`  [${d.workKey}] slug="${d.slug}" : ${d.names.join(' vs ')}`);
    }
    if (duplicateWorks.length > 20) console.log(`  ... 他 ${duplicateWorks.length - 20}件`);
  }

  console.log('\n--- 終了サービスが登録されている作品（最大20件）---');
  if (terminatedWorks.size === 0) {
    console.log('  (なし)');
  } else {
    let shown = 0;
    for (const [wk, names] of terminatedWorks.entries()) {
      if (shown++ >= 20) { console.log(`  ... 他 ${terminatedWorks.size - 20}件`); break; }
      console.log(`  [${wk}] ${names.join(', ')}`);
    }
  }

  console.log('\n--- Prime Videoチャンネル候補 ---');
  if (primeVideoChannels.size === 0) {
    console.log('  (なし)');
  } else {
    for (const n of primeVideoChannels) {
      console.log(`  "${n}"`);
    }
  }

  console.log('\n--- vod_providersへ追加が必要なサービス候補 ---');
  const needsRegistration = [...unregisteredNames.keys()].filter(
    (n) => !['unknown', '配信確認できず', ''].includes(n) && !n.includes('unknown'),
  );
  if (needsRegistration.length === 0) {
    console.log('  (なし)');
  } else {
    for (const slug of needsRegistration) {
      const names = unregisteredNames.get(slug)!;
      const cnt   = normalizedCounts.get(slug) ?? 0;
      console.log(`  slug="${slug}" (${cnt}件) ← "${[...names].join('", "')}"`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
