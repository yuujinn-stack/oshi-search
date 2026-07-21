// dry-run: vod_providers テーブルの終了済みサービス確認
// 実行: dotenv -e .env.local -- npx tsx scripts/dry-run-vod-providers.ts
// applyは行わない・DB書き込み一切なし

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { vodProviders } from '../src/db/schema';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL が未設定です');
    process.exit(1);
  }

  const sql = neon(url);
  const db = drizzle(sql, { schema: { vodProviders } });

  console.log('=== vod_providers 全件 ===\n');
  const all = await db.select().from(vodProviders).orderBy(vodProviders.slug);

  const active   = all.filter((r) => r.isActive);
  const inactive = all.filter((r) => !r.isActive);

  console.log(`合計: ${all.length}件  |  active: ${active.length}件  |  ended(isActive=false): ${inactive.length}件\n`);

  console.log('--- isActive=false（終了済み）---');
  if (inactive.length === 0) {
    console.log('  (なし)');
  } else {
    for (const r of inactive) {
      console.log(`  slug="${r.slug}"  name="${r.name}"`);
    }
  }

  console.log('\n--- isActive=true（有効）---');
  for (const r of active) {
    console.log(`  slug="${r.slug}"  name="${r.name}"`);
  }

  // 特定サービスの検索
  const targets = ['dtv', 'gyao', 'paravi', 'lemino', 'unext'];
  console.log('\n=== 注目サービスの状態 ===');
  for (const t of targets) {
    const hit = all.find(
      (r) => r.slug.toLowerCase().replace(/[-_\s]/g, '') === t ||
             r.name.toLowerCase().replace(/[-_\s]/g, '') === t,
    );
    if (hit) {
      console.log(`  ${t}: slug="${hit.slug}" name="${hit.name}" isActive=${hit.isActive}`);
    } else {
      console.log(`  ${t}: (vod_providersテーブルに未登録)`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
