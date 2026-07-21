// Lemino系プロバイダーのDB実データ確認（dry-run・書き込みなし）
// 実行: npx dotenv-cli -e .env.local -- npx tsx scripts/check-lemino.ts

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql as drizzleSql } from 'drizzle-orm';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL 未設定'); process.exit(1); }

  const sqlClient = neon(url);
  const db = drizzle(sqlClient);

  // vod_providers の Lemino 系エントリ
  console.log('=== vod_providers: Lemino 系 ===');
  const providers = await db.execute(
    drizzleSql`SELECT slug, name, is_active FROM vod_providers WHERE slug ILIKE '%lemino%' OR name ILIKE '%lemino%' ORDER BY slug`
  );
  for (const r of providers.rows) {
    console.log(`  slug="${r.slug}" name="${r.name}" isActive=${r.is_active}`);
  }

  // works に含まれる Lemino 系 providerName を集計
  console.log('\n=== works.vod_data: Lemino 系 providerName ===');
  const works = await db.execute(
    drizzleSql`
      SELECT
        p->>'providerName' AS provider_name,
        COUNT(*) AS cnt
      FROM works,
           jsonb_array_elements(vod_data->'vodProviders') AS p
      WHERE p->>'providerName' ILIKE '%lemino%'
      GROUP BY 1
      ORDER BY cnt DESC
    `
  );
  for (const r of works.rows) {
    console.log(`  "${r.provider_name}" : ${r.cnt}件`);
  }

  // 同一作品に Lemino と Leminoプレミアム 両方あるケース
  console.log('\n=== 同一作品に Lemino と Leminoプレミアム が共存 ===');
  const dups = await db.execute(
    drizzleSql`
      SELECT w.title
      FROM works w
      WHERE vod_data->'vodProviders' @> '[{"providerName":"Lemino"}]'
        AND vod_data::text ILIKE '%leminoプレミアム%'
      LIMIT 10
    `
  );
  if (dups.rows.length === 0) {
    console.log('  なし');
  }
  for (const r of dups.rows) {
    console.log(`  ${r.title}`);
  }

  // Netflix 系 providerName を集計
  console.log('\n=== works.vod_data: Netflix 系 providerName ===');
  const netflix = await db.execute(
    drizzleSql`
      SELECT
        p->>'providerName' AS provider_name,
        COUNT(*) AS cnt
      FROM works,
           jsonb_array_elements(vod_data->'vodProviders') AS p
      WHERE p->>'providerName' ILIKE '%netflix%'
      GROUP BY 1
      ORDER BY cnt DESC
    `
  );
  for (const r of netflix.rows) {
    console.log(`  "${r.provider_name}" : ${r.cnt}件`);
  }

  // 同一作品に Netflix と Netflix Standard with Ads 両方あるケース（先頭5件）
  console.log('\n=== 同一作品に Netflix と Netflix Standard with Ads が共存（先頭5件）===');
  const nfDups = await db.execute(
    drizzleSql`
      SELECT w.title
      FROM works w
      WHERE vod_data->'vodProviders' @> '[{"providerName":"Netflix"}]'
        AND vod_data::text ILIKE '%netflix standard with ads%'
      LIMIT 5
    `
  );
  if (nfDups.rows.length === 0) {
    console.log('  なし');
  }
  for (const r of nfDups.rows) {
    console.log(`  ${r.title}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
