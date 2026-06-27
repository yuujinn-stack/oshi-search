// 作品の vodProviders を Redis から直接確認するスクリプト
//
// 使い方:
//   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io \
//   UPSTASH_REDIS_REST_TOKEN=AXxxxx \
//   node scripts/inspect-works.mjs
//
// 認証情報の取得: Vercel ダッシュボード > プロジェクト > Settings > Environment Variables

const url   = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error('環境変数が未設定です。');
  console.error('実行例:');
  console.error('  UPSTASH_REDIS_REST_URL=https://xxx.upstash.io UPSTASH_REDIS_REST_TOKEN=AXxxx node scripts/inspect-works.mjs');
  process.exit(1);
}

async function hgetall(key) {
  const res = await fetch(`${url}/hgetall/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.result ?? null;
}

const TARGET_PERSON = '村山美羽';
const TARGET_TITLE_KEYWORDS = ['無題', 'Vlog'];

const raw = await hgetall(`works:${TARGET_PERSON}`);
if (!raw) {
  console.log(`works:${TARGET_PERSON} → Redis に存在しません`);
  process.exit(0);
}

const entries = Object.entries(raw);
console.log(`works:${TARGET_PERSON} 総作品数: ${entries.length}\n`);

for (const [id, value] of entries) {
  let w;
  try {
    w = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    continue;
  }

  const title = w.title ?? '';
  if (!TARGET_TITLE_KEYWORDS.some((kw) => title.includes(kw))) continue;

  console.log(`${'─'.repeat(60)}`);
  console.log(`title:     ${title}`);
  console.log(`id:        ${id}`);
  console.log(`source:    ${w.source}`);
  console.log(`posterUrl: ${w.posterUrl ?? '(なし)'}`);
  console.log(`vodProviders: (${(w.vodProviders ?? []).length}件)`);

  for (const [i, p] of (w.vodProviders ?? []).entries()) {
    console.log(`\n  [${i}] ${JSON.stringify({
      providerName: p.providerName,
      source: p.source,
      sourceUrl: p.sourceUrl ?? null,
      officialUrl: p.officialUrl ?? null,
    }, null, 2).replace(/^/gm, '  ')}`);
  }

  if ((w.vodProviders ?? []).length === 0) {
    console.log('  (vodProvidersなし)');
  }
  console.log('');
}
