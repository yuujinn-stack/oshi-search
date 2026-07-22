/**
 * 作品リンク整合性検査スクリプト（dry-runのみ・DB/Redis変更なし）
 *
 * 使用方法:
 *   npx tsx scripts/check-work-links.ts
 *   npx tsx scripts/check-work-links.ts --verbose
 *
 * 確認内容:
 *   - DBの全公開作品のURLが有効かどうか
 *   - Redisのwork:click:*に存在するworkIdがDBに存在するか
 *   - personSlugが欠落している作品の検出
 *   - 論理削除済み・非公開作品の検出
 */

import 'dotenv/config';
import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { getWorkPublicUrl } from '@/lib/work-url';

const isVerbose = process.argv.includes('--verbose');

function log(msg: string) {
  console.log(msg);
}

function logVerbose(msg: string) {
  if (isVerbose) console.log('  ' + msg);
}

async function main() {
  log('=== 作品リンク整合性検査（dry-run）===\n');

  // 1. 全作品（削除済み含む）を取得
  const allRows = await db.select({
    id: worksTable.id,
    personName: worksTable.personName,
    title: worksTable.title,
    status: worksTable.status,
    deleted: worksTable.deleted,
  }).from(worksTable);

  const total = allRows.length;
  const published = allRows.filter((r) => r.status === 'auto_published' && !r.deleted);
  const deleted = allRows.filter((r) => r.deleted);
  const hidden = allRows.filter((r) => r.status === 'hidden' && !r.deleted);
  const needsReview = allRows.filter((r) => r.status === 'needs_review' && !r.deleted);

  log(`[DB統計]`);
  log(`  全作品数:        ${total}`);
  log(`  公開作品:        ${published.length}`);
  log(`  論理削除済み:    ${deleted.length}`);
  log(`  非公開(hidden):  ${hidden.length}`);
  log(`  要確認:          ${needsReview.length}`);
  log('');

  // 2. 公開作品のURL生成チェック
  let validLinks = 0;
  let missingPersonName = 0;

  for (const work of published) {
    const url = getWorkPublicUrl({ workId: work.id, personName: work.personName });
    if (url) {
      validLinks++;
      logVerbose(`✓ ${url}`);
    } else {
      missingPersonName++;
      log(`  ✗ personSlug欠落: id=${work.id} personName="${work.personName ?? '(empty)'}"`);
    }
  }

  log(`[URL生成チェック]`);
  log(`  有効リンク:      ${validLinks}`);
  log(`  personName欠落:  ${missingPersonName}`);
  log('');

  // 3. Redisチェック（接続できる場合のみ）
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (!redis) {
      log('[Redis] 接続なし（スキップ）');
    } else {
      log('[Redis work:click:* チェック]');
      const keys: string[] = [];
      let cursor = 0;
      do {
        const [cur, batch] = await redis.scan(cursor, { match: 'work:click:*', count: 100 });
        cursor = Number(cur);
        keys.push(...(batch as string[]));
      } while (cursor !== 0);

      const dbIds = new Set(published.map((r) => r.id));
      const allDbIds = new Set(allRows.map((r) => r.id));

      let redisValidCount = 0;
      let redisInvalidCount = 0;
      let redisDeletedCount = 0;

      for (const key of keys) {
        const workId = key.replace('work:click:', '');
        if (dbIds.has(workId)) {
          redisValidCount++;
          logVerbose(`✓ Redis key valid: ${workId}`);
        } else if (allDbIds.has(workId)) {
          redisDeletedCount++;
          log(`  ⚠ 非公開/削除済み作品のRedisキー: ${workId}`);
        } else {
          redisInvalidCount++;
          log(`  ✗ DBに存在しないRedisキー: ${workId}`);
        }
      }

      log(`  Redis全キー数:   ${keys.length}`);
      log(`  DB照合OK:        ${redisValidCount}`);
      log(`  非公開/削除済み: ${redisDeletedCount}`);
      log(`  DBに存在しない:  ${redisInvalidCount}`);
      log('');
    }
  } catch (err) {
    log(`[Redis] エラー: ${String(err)}`);
  }

  // 4. サマリー
  log('=== 結果サマリー ===');
  log(`  検査作品数:      ${total}`);
  log(`  有効リンク:      ${validLinks}`);
  log(`  無効リンク:      ${missingPersonName}`);
  log(`  DBスキーマ変更:  なし`);
  log(`  本番DB更新:      なし`);
  log(`  Redis更新:       なし（dry-run）`);
  log('');
  log('完了（DB/Redis変更なし）');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
