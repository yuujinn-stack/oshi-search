/**
 * 作品重複候補の dry-run スクリプト
 *
 * 実行方法:
 *   npm run works:dedup:dry-run
 *
 * 効果: なし（DB/Redis への書き込みを一切行わない）
 * 出力: コンソール統計 + tmp/work-dedup-report.json + tmp/work-dedup-report.csv
 */

import 'dotenv/config';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import {
  aggregateEntries,
  detectDuplicates,
  computeStats,
  type WorkRawRow,
} from '@/lib/work-dedup';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('=== 作品重複候補 dry-run ===');
  console.log('DB/Redis への書き込みは行いません。');
  console.log('');

  // ── 1. 全作品を1クエリで取得 ──────────────────────────────────────────────────
  console.log('[1/4] 全作品をDBから取得中...');
  const rows = await db.select({
    id:              worksTable.id,
    personName:      worksTable.personName,
    title:           worksTable.title,
    normalizedTitle: worksTable.normalizedTitle,
    type:            worksTable.type,
    tmdbId:          worksTable.tmdbId,
    source:          worksTable.source,
    releaseYear:     worksTable.releaseYear,
    overview:        worksTable.overview,
    posterUrl:       worksTable.posterUrl,
    status:          worksTable.status,
    deleted:         worksTable.deleted,
    vodData:         worksTable.vodData,
    updatedAt:       worksTable.updatedAt,
    createdAt:       worksTable.createdAt,
  }).from(worksTable);

  const rawRows = rows.map((r): WorkRawRow => ({
    id:              r.id,
    personName:      r.personName,
    title:           r.title,
    normalizedTitle: r.normalizedTitle,
    type:            r.type,
    tmdbId:          r.tmdbId ?? null,
    source:          r.source,
    releaseYear:     r.releaseYear ?? null,
    overview:        r.overview ?? null,
    posterUrl:       r.posterUrl ?? null,
    status:          r.status,
    deleted:         r.deleted,
    vodData:         (r.vodData ?? {}) as Record<string, unknown>,
    updatedAt:       r.updatedAt ?? new Date(),
    createdAt:       r.createdAt ?? new Date(),
  }));

  console.log(`  → ${rawRows.length.toLocaleString()} 行取得`);

  // ── 2. workId 単位に集約 ──────────────────────────────────────────────────────
  console.log('[2/4] workId 単位に集約中...');
  const entries = aggregateEntries(rawRows);
  console.log(`  → ${entries.length.toLocaleString()} workId`);

  // ── 3. 重複候補検出 ──────────────────────────────────────────────────────────
  console.log('[3/4] 重複候補を検出中...');
  const groups = detectDuplicates(entries);
  const stats  = computeStats(rawRows, entries, groups);

  // ── 4. 統計表示 ────────────────────────────────────────────────────────────
  console.log('[4/4] 統計\n');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  作品重複候補レポート                                   │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  全DBレコード数       : ${String(stats.totalWorkRecords).padStart(6)}                     │`);
  console.log(`│  公開中レコード数     : ${String(stats.publishedWorkRecords).padStart(6)}                     │`);
  console.log(`│  ユニーク workId 数   : ${String(stats.uniqueWorkIds).padStart(6)}                     │`);
  console.log(`│  ユニーク dedupKey 数 : ${String(stats.uniqueDedupKeys).padStart(6)}                     │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  重複候補グループ数   : ${String(stats.duplicateCandidateGroups).padStart(6)}                     │`);
  console.log(`│  重複候補作品数       : ${String(stats.duplicateCandidateWorks).padStart(6)}                     │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  exact（外部ID一致）  : ${String(stats.exactGroups).padStart(6)}                     │`);
  console.log(`│  high（全属性一致）   : ${String(stats.highGroups).padStart(6)}                     │`);
  console.log(`│  medium（年欠落）     : ${String(stats.mediumGroups).padStart(6)}                     │`);
  console.log(`│  low（タイトルのみ）  : ${String(stats.lowGroups).padStart(6)}                     │`);
  console.log(`│  conflict（矛盾あり） : ${String(stats.conflictGroups).padStart(6)}                     │`);
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log('│  ⚠ DB/Redis への変更: 0 件（dry-run）                  │');
  console.log('│  ⚠ canApplyAutomatically: 常に false                   │');
  console.log('└─────────────────────────────────────────────────────────┘');

  // ── 5. tmp/ へレポート保存 ──────────────────────────────────────────────────
  const tmpDir = join(process.cwd(), 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  // JSON
  const jsonPath = join(tmpDir, 'work-dedup-report.json');
  writeFileSync(
    jsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), stats, groups }, null, 2),
    'utf-8',
  );
  console.log(`\nJSON: ${jsonPath}`);

  // CSV（グループサマリー）
  const csvRows = [
    ['groupId', 'confidence', 'workId1', 'title1', 'workId2', 'title2', 'reasons', 'conflicts'].join(','),
    ...groups.map((g) => {
      const e0 = g.entries[0];
      const e1 = g.entries[1];
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        g.groupId,
        g.confidence,
        esc(e0?.workId ?? ''),
        esc(e0?.title ?? ''),
        esc(e1?.workId ?? ''),
        esc(e1?.title ?? ''),
        esc(g.reasons.join(' / ')),
        esc(g.conflicts.join(' / ')),
      ].join(',');
    }),
  ].join('\n');

  const csvPath = join(tmpDir, 'work-dedup-report.csv');
  writeFileSync(csvPath, csvRows, 'utf-8');
  console.log(`CSV: ${csvPath}`);

  // ── 6. 先頭グループのプレビュー ────────────────────────────────────────────
  if (groups.length > 0) {
    console.log('\n--- 先頭候補グループのプレビュー ---');
    const top = groups.slice(0, Math.min(3, groups.length));
    for (const g of top) {
      console.log(`\n[${g.confidence.toUpperCase()}] groupId=${g.groupId}`);
      for (const e of g.entries) {
        console.log(`  workId=${e.workId}  title=${e.title}  year=${e.releaseYear}  tmdbId=${e.tmdbId}  persons=${e.personLinkCount}`);
      }
      if (g.reasons.length > 0)   console.log(`  reasons:   ${g.reasons.join(' / ')}`);
      if (g.conflicts.length > 0) console.log(`  conflicts: ${g.conflicts.join(' / ')}`);
      console.log(`  canonical推奨: ${g.canonicalRecommendation.recommendedWorkId}`);
    }
  }

  console.log('\n=== dry-run 完了 (DB 更新: 0件 / Redis 更新: 0件) ===');
}

main().catch((err) => {
  console.error('dry-run エラー:', err);
  process.exit(1);
});
