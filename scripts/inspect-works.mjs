// @next/env で .env.local を読み込んでから Redis に直接クエリする調査スクリプト
import pkg from '@next/env';
const { loadEnvConfig } = pkg;

const { combinedEnv } = loadEnvConfig(process.cwd());
const url   = combinedEnv.UPSTASH_REDIS_REST_URL;
const token = combinedEnv.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が未設定です');
  process.exit(1);
}

async function hgetall(key) {
  const res = await fetch(`${url}/hgetall/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.result ?? null;
}

const TARGETS = [
  {
    name: '村山美羽',
    titleKeywords: ['村山', 'Vlog', '無題'],
  },
  {
    name: 'ちょこさく',
    titleKeywords: [], // 全件（作品数が少ない前提）
  },
];

for (const { name, titleKeywords } of TARGETS) {
  const raw = await hgetall(`works:${name}`);
  if (!raw) {
    console.log(`\n===== ${name} → Redis に存在しません =====`);
    continue;
  }

  const entries = Object.entries(raw);
  console.log(`\n===== ${name} (総作品数: ${entries.length}) =====`);

  for (const [id, value] of entries) {
    let w;
    try {
      w = typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      console.log(`  [${id}] parse error`);
      continue;
    }

    const title = w.title ?? '';
    if (titleKeywords.length > 0 && !titleKeywords.some((kw) => title.includes(kw))) continue;

    console.log(`\n  ─── ${title} ───`);
    console.log(`  id:        ${id}`);
    console.log(`  source:    ${w.source}`);
    console.log(`  posterUrl: ${w.posterUrl ?? '(なし)'}`);

    const providers = w.vodProviders ?? [];
    if (providers.length === 0) {
      console.log(`  vodProviders: (なし)`);
    } else {
      for (const p of providers) {
        console.log(`  ┌ provider ─────────────────────────`);
        console.log(`  │ source:       ${p.source}`);
        console.log(`  │ providerName: ${p.providerName}`);
        console.log(`  │ type:         ${p.type}`);
        console.log(`  │ officialUrl:  ${p.officialUrl ?? '(なし)'}`);
        console.log(`  │ sourceUrl:    ${p.sourceUrl ?? '(なし)'}`);
        console.log(`  │ link:         ${p.link ?? '(なし)'}`);
        console.log(`  └───────────────────────────────────`);
      }
    }
  }
}
