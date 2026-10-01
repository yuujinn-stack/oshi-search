/**
 * G「推し活、検索しすぎ問題」・J「実際の画面で見せる」の見た目をローカルで確認する（読み取り専用）。
 * 本番と同じ生成処理（src/server/instagram-post/site-ui/builders.ts の SITE_UI_PREPARERS）のページを描画するだけで、
 * Blobへのアップロード・DB・Instagramへの書き込みはしない。J が条件を満たさない人物は、本番と同じく H・G に切り替わる。
 * 出力は tools/canva-instagram/output/gj-preview/<人物名>/ のみ。
 *
 * 実行例（複数人可）:
 *   NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local tools/canva-instagram/gj-preview/run.ts 久保史緒里 梅澤美波
 */
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { SITE_UI_PREPARERS } from '@/server/instagram-post/site-ui/builders';
import { renderPages } from '@/server/instagram-post/candidates/builders';

// src/lib 内の診断ログが大量に出るため標準エラーへ回す
const out = (...a: unknown[]) => process.stdout.write(a.join(' ') + '\n');
console.log = console.error;

async function strip(files: string[], dest: string) {
  const cell = 400, gap = 16;
  const bufs = await Promise.all(files.map((f) => sharp(f).resize(cell, cell).png().toBuffer()));
  await sharp({ create: { width: cell * bufs.length + gap * (bufs.length + 1), height: cell + gap * 2, channels: 3, background: '#E9E8E3' } })
    .composite(bufs.map((b, i) => ({ input: b, top: gap, left: gap + i * (cell + gap) })))
    .jpeg({ quality: 88 })
    .toFile(dest);
}

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) names.push('久保史緒里');
  for (const personName of names) {
    const dir = path.join(__dirname, '..', 'output', 'gj-preview', personName);
    fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    for (const [label, id] of [['G', 'search-too-much'], ['J', 'real-screen']] as const) {
      try {
        const prepared = await SITE_UI_PREPARERS[id](personName);
        const actual = prepared.templateId ?? id;
        const pngs = await renderPages(prepared.pages);
        pngs.forEach((png, i) => {
          const f = path.join(dir, `${label}_${i + 1}${actual !== id ? `_fallback-${actual}` : ''}.png`);
          fs.writeFileSync(f, png);
          files.push(f);
        });
        out(`${personName} ${label}: ${actual === id ? 'OK' : `→ ${actual}（${prepared.fallbackReason}）`}`);
      } catch (e) {
        out(`${personName} ${label}: 生成不可（${e instanceof Error ? e.message : String(e)}）`);
      }
    }
    if (files.length) await strip(files, path.join(dir, 'strip_GJ.jpg'));
  }
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`FAILED ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
