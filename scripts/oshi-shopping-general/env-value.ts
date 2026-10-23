// 推し活お買い物診断の一般商品の選定リスト（ローカルの JSON。git 管理外）から、Vercel の環境変数
// OSHI_SHOPPING_GENERAL_ITEMS に設定する値を作る（本番でファイルは読まないため、値そのものを環境変数に入れる）。
//
//   npx tsx scripts/oshi-shopping-general/env-value.ts [tmp/oshi-shopping-general/general-items.json]
//
// - アプリと同じ検証（src/lib/oshi-shopping/general-items.ts の parseGeneralItemEntries）を通した件数を表示する。
// - 値は `base64:<JSON を base64 にしたもの>`（Vercel の画面やシェルで引用符が崩れない形）にして
//   tmp/oshi-shopping-general/vercel-env-value.txt（git 管理外）に書く。画面には件数・長さだけを出し、itemCode は出さない。
// - 設定後は、本番の診断結果ページで一般商品欄が表示されること（「準備中」でないこと）を確認する。
import fs from 'node:fs';
import path from 'node:path';
import { GENERAL_ITEMS_BASE64_PREFIX, decodeGeneralItemsValue, parseGeneralItemEntries } from '../../src/lib/oshi-shopping/general-items';

const src = process.argv[2] ?? 'tmp/oshi-shopping-general/general-items.json';
const out = path.join(path.dirname(src), 'vercel-env-value.txt');

const raw = fs.readFileSync(src, 'utf8');
const list = JSON.parse(raw) as unknown[];
if (!Array.isArray(list)) throw new Error('選定リストが配列ではありません');
const entries = parseGeneralItemEntries(JSON.stringify(list));
// 余分な項目を持たせない（itemCode・use・label のみ）
const minimal = JSON.stringify(entries.map((e) => ({ itemCode: e.itemCode, use: e.use, label: e.label })));
const value = GENERAL_ITEMS_BASE64_PREFIX + Buffer.from(minimal, 'utf8').toString('base64');
// 作った値をアプリと同じ手順で読み戻して一致を確認する
const roundTrip = parseGeneralItemEntries(value);
if (JSON.stringify(roundTrip) !== JSON.stringify(entries) || decodeGeneralItemsValue(value) !== minimal) throw new Error('読み戻しが一致しません');

const byUse: Record<string, number> = {};
for (const e of entries) byUse[e.use] = (byUse[e.use] ?? 0) + 1;
fs.writeFileSync(out, value + '\n', { mode: 0o600 });
console.log(JSON.stringify({ source: src, items: list.length, valid: entries.length, invalid: list.length - entries.length, byUse, valueLength: value.length, saved: out }));
if (entries.length !== list.length) process.exitCode = 1;
