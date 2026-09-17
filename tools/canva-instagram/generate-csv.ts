/**
 * Canva一括作成用CSV生成ツール
 *
 * 使い方:
 *   人物1人: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名"
 *   複数人物（一括）: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名1" "人物名2" "人物名3"
 *
 * 既存サイトのDB読み取り専用関数のみを再利用する（INSERT/UPDATE/DELETEは一切行わない）。
 * 出力先:
 *   人物1人: tools/canva-instagram/output/{人物名}_{YYYYMMDD_HHmm}.csv
 *   複数人物: tools/canva-instagram/output/canva_batch_{YYYYMMDD_HHmm}.csv（入力順の行、ヘッダー1行）
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { getPublishedWorks } from '@/lib/work-store';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { filterPublicVodProviders, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getDisplayWorkTypeTrace } from '@/lib/work-display-type';
import { VOD_TYPE_ORDER } from '@/lib/vod-cta';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';

// 「今見たい作品3選」の対象ジャンル。既存サイトの構造化分類（getDisplayWorkType）を
// タイトル文字列判定より優先して使う。ライブ・音楽番組・バラエティ・配信番組(Web)・
// アイドル番組・舞台・ドキュメンタリー・アニメ声優等（グループ主体のコンテンツを含む）は
// 意図的に対象外とする。
const ELIGIBLE_DISPLAY_TYPES = new Set(['movie', 'drama']);

const MAX_WORKS = 3;
const MAX_VOD_SERVICES_PER_WORK = 2;
// タイトルをCanva上で2行に分けるかどうかの閾値（この文字数以下なら分割しない）。
// 実データ例に基づく判断: 「夜明けのすべて」(7文字)は分割なし、
// 「西園寺さんは家事をしない」(12文字)は分割、という既存の例から決定。
const TITLE_SPLIT_THRESHOLD = 8;
// 自然な区切り文字で分割した際、左右の長さが極端に偏る場合は文字数分割にフォールバックする閾値
const MAX_IMBALANCE_RATIO = 0.8;

// ─── タイトル分割（Canva上で最大2行に表示するため） ────────────────────────────
// 優先順位: 1) 中央付近にある自然な区切り文字（スペース・中黒・コロン等）で分割
//           2) 区切り文字がない、または偏りすぎる場合は文字数の中央付近で分割
//           3) 閾値以下の短いタイトルは分割しない（title2は空文字）
const NATURAL_DELIMITERS = /[ 　・:：\-－~〜]/g;

export function splitTitleForCanva(title: string): [string, string] {
  const trimmed = title.trim();
  if (trimmed.length <= TITLE_SPLIT_THRESHOLD) return [trimmed, ''];

  const mid = trimmed.length / 2;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(NATURAL_DELIMITERS);
  while ((m = re.exec(trimmed)) !== null) positions.push(m.index);

  if (positions.length > 0) {
    let best = positions[0];
    let bestDist = Math.abs(best - mid);
    for (const p of positions) {
      const d = Math.abs(p - mid);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    const left = trimmed.slice(0, best).trim();
    const right = trimmed.slice(best + 1).trim();
    if (
      left.length > 0 && right.length > 0 &&
      Math.max(left.length, right.length) / trimmed.length <= MAX_IMBALANCE_RATIO
    ) {
      return [left, right];
    }
  }

  const splitAt = Math.round(trimmed.length / 2);
  return [trimmed.slice(0, splitAt), trimmed.slice(splitAt)];
}

// ─── VOD表示文字列（サービス名のみ、最大2件を " / " で連結） ─────────────────────
function buildVodDisplayString(providers: VodProvider[]): string {
  const sorted = [...providers].sort(
    (a, b) => (VOD_TYPE_ORDER[a.type] ?? 9) - (VOD_TYPE_ORDER[b.type] ?? 9),
  );
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of sorted) {
    const displayName = getVodProviderDisplayInfo(p.providerName).displayName;
    if (seen.has(displayName)) continue;
    seen.add(displayName);
    names.push(displayName);
    if (names.length >= MAX_VOD_SERVICES_PER_WORK) break;
  }
  return names.join(' / ');
}

// ─── Canva用画像URLの利用可否チェック ────────────────────────────────────────────
// 作品のランキング・選定順位（movie/drama判定・VOD優先・新しい順）には一切影響しない、
// 「選ばれた候補の画像が実際にCanvaで使えるか」だけを見る独立したチェック。
// ここで不適合と判定された作品は selected に入れず、次点の候補へ繰り上げる。

// 既知の「作品固有ではない汎用OGP画像」の完全一致デノリスト。
// 「監察医 朝顔2025新春スペシャル」調査で判明: FODサイト共通のロゴ画像で、
// 作品ごとに変わらず内容と無関係なため常に不採用とする。
const GENERIC_OGP_URL_DENYLIST = new Set<string>([
  'https://i.fod.fujitv.co.jp/img/ogp_img/ogp.jpg',
]);

function isUsableCanvaImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  let hostname = '';
  try {
    hostname = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return false; // URLとして解釈できない値は不採用
  }

  // Google画像検索のサムネイルプロキシ（例: encrypted-tbn0.gstatic.com）
  if (hostname === 'gstatic.com' || hostname.endsWith('.gstatic.com')) return false;

  // ホストに関わらず、Google画像検索サムネイル特有のURLパターン（tbn:/tbm=等）を含むものは不採用
  if (/[?&](q=tbn:|tbm=)/i.test(trimmed)) return false;

  // 既知の「作品固有ではない汎用OGP画像」を除外
  if (GENERIC_OGP_URL_DENYLIST.has(trimmed)) return false;

  return true;
}

// ─── 3作品の選定 ────────────────────────────────────────────────────────────────
// 優先順位: 0) 映画・ドラマ（配信ドラマ含む）のみを対象とし、それ以外
//              （ライブ・音楽番組・バラエティ・配信番組/Web・アイドル番組・舞台・
//              ドキュメンタリー・アニメ声優等）は除外する
//              （既存の getDisplayWorkType/getDisplayWorkTypeTrace による構造化分類を
//              タイトル文字列の独自判定より優先して利用する）
//           1) 現在有効なVOD配信先が確認できる作品を優先
//           2) releaseYearが新しい順
//           3) 同一タイトル（トリム後の完全一致）は重複除外し、先に選ばれた方を残す
interface SelectedWork {
  work: WorkRecord;
  confirmedProviders: VodProvider[];
  displayType: string;
  displayTypeRule: string;
}

interface SelectionResult {
  selected: SelectedWork[];
  /** 除外された作品のうち、releaseYearが新しい上位N件（レポート・デバッグ用） */
  excludedTop: SelectedWork[];
  /** movie/drama候補ではあったが、画像がCanvaで使えないため飛ばされた作品（ログ表示用） */
  imageRejected: SelectedWork[];
}

async function selectTopWorks(personName: string): Promise<SelectionResult> {
  const [works, terminatedSlugs] = await Promise.all([
    getPublishedWorks(personName),
    getInactiveProviderSlugs(),
  ]);

  const withVodInfo = works.map((work) => {
    const trace = getDisplayWorkTypeTrace(work);
    return {
      work,
      confirmedProviders: filterPublicVodProviders(work.vodProviders ?? [], terminatedSlugs),
      displayType: trace.result,
      displayTypeRule: trace.rule,
    };
  });

  const eligible = withVodInfo.filter((item) => ELIGIBLE_DISPLAY_TYPES.has(item.displayType));
  const excluded = withVodInfo.filter((item) => !ELIGIBLE_DISPLAY_TYPES.has(item.displayType));

  const sortByVodThenYear = (a: SelectedWork, b: SelectedWork) => {
    const aHasVod = a.confirmedProviders.length > 0;
    const bHasVod = b.confirmedProviders.length > 0;
    if (aHasVod !== bHasVod) return aHasVod ? -1 : 1;
    const aYear = a.work.releaseYear ?? -1;
    const bYear = b.work.releaseYear ?? -1;
    return bYear - aYear;
  };

  eligible.sort(sortByVodThenYear);
  excluded.sort(sortByVodThenYear);

  // 順位付け（movie/drama判定・VOD優先・新しい順）は eligible の並び順としてすでに
  // 確定済み。ここでは並び順を変えず、先頭から順に見ていき、画像が使えない候補だけ
  // 読み飛ばして次点を繰り上げる（重複タイトル除外は既存のまま維持）。
  const seenTitles = new Set<string>();
  const selected: SelectedWork[] = [];
  const imageRejected: SelectedWork[] = [];
  for (const item of eligible) {
    const key = item.work.title.trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    const imageUrl = getRenderableWorkImageUrl(getWorkDisplayImage(item.work));
    if (!isUsableCanvaImageUrl(imageUrl)) {
      imageRejected.push(item);
      continue;
    }

    selected.push(item);
    if (selected.length >= MAX_WORKS) break;
  }

  return { selected, excludedTop: excluded.slice(0, 5), imageRejected };
}

// ─── CSV組み立て ────────────────────────────────────────────────────────────────
function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

const CSV_HEADER = [
  'coverTitle',
  'work1Title1', 'work1Title2', 'work1Vod', 'work1Image',
  'work2Title1', 'work2Title2', 'work2Vod', 'work2Image',
  'work3Title1', 'work3Title2', 'work3Vod', 'work3Image',
  'coverImage',
];

function buildCsvRow(personName: string, selected: SelectedWork[]): string[] {
  const row: string[] = [`${personName}の出演作`];
  for (let i = 0; i < MAX_WORKS; i++) {
    const item = selected[i];
    if (!item) {
      row.push('', '', '', '');
      continue;
    }
    const [title1, title2] = splitTitleForCanva(item.work.title);
    const vod = buildVodDisplayString(item.confirmedProviders);
    const image = getRenderableWorkImageUrl(getWorkDisplayImage(item.work)) ?? '';
    row.push(title1, title2, vod, image);
  }
  row.push(''); // coverImage: 今回は空欄（人物画像の自動取得は別工程）
  return row;
}

// ─── ファイル名生成 ─────────────────────────────────────────────────────────────
// 人物1人: 人物名_YYYYMMDD_HHmm.csv（既存の命名規則、変更なし）
function buildOutputFileName(personName: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${personName}_${stamp}.csv`;
}

// 複数人物（一括生成）: canva_batch_YYYYMMDD_HHmm.csv
function buildBatchOutputFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `canva_batch_${stamp}.csv`;
}

function writeCsvFile(fileName: string, csvContent: string): string {
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  return outputPath;
}

function logSelectedWorks(selected: SelectedWork[], excludedTop: SelectedWork[], imageRejected: SelectedWork[] = []): void {
  console.log('=== 選択された作品 ===');
  selected.forEach((item, i) => {
    const vod = buildVodDisplayString(item.confirmedProviders);
    const image = getRenderableWorkImageUrl(getWorkDisplayImage(item.work)) ?? '(なし)';
    console.log(`[${i + 1}] ${item.work.title}（${item.work.releaseYear ?? '年不明'}）`);
    console.log(`    displayType: ${item.displayType} (rule=${item.displayTypeRule})`);
    console.log(`    VOD: ${vod || '(確認済み配信先なし)'}`);
    console.log(`    画像: ${image}`);
  });
  if (imageRejected.length > 0) {
    console.log('=== 画像不適合のため飛ばした候補（movie/drama候補ではあるが画像が不採用） ===');
    imageRejected.forEach((item, i) => {
      const image = getRenderableWorkImageUrl(getWorkDisplayImage(item.work)) ?? '(なし)';
      console.log(`[${i + 1}] ${item.work.title}（${item.work.releaseYear ?? '年不明'}） displayType=${item.displayType} (rule=${item.displayTypeRule})`);
      console.log(`    不採用画像: ${image}`);
    });
  }
  console.log('=== 除外された上位候補（参考、releaseYear新しい順の上位5件） ===');
  excludedTop.forEach((item, i) => {
    console.log(`[${i + 1}] ${item.work.title}（${item.work.releaseYear ?? '年不明'}） displayType=${item.displayType} (rule=${item.displayTypeRule})`);
  });
}

// ─── 人物1人モード（既存の挙動を完全に維持） ────────────────────────────────────
async function runSinglePerson(personName: string): Promise<void> {
  const { selected, excludedTop, imageRejected } = await selectTopWorks(personName);
  if (selected.length === 0) {
    console.error(`「${personName}」の映画・ドラマ（配信ドラマ含む）に該当する公開作品が見つかりませんでした（status=auto_published, deleted=falseかつdisplayType=movie/dramaの作品なし）。`);
    process.exit(1);
  }

  const row = buildCsvRow(personName, selected);
  const csvContent = [CSV_HEADER, row].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

  const fileName = buildOutputFileName(personName);
  const outputPath = writeCsvFile(fileName, csvContent);

  console.log(`CSV生成完了: ${outputPath}\n`);
  logSelectedWorks(selected, excludedTop, imageRejected);
  console.log('\n=== CSVの中身 ===');
  console.log(csvContent);
}

// ─── 複数人物モード（一括生成） ──────────────────────────────────────────────────
// 人物ごとの選定ロジック（selectTopWorks/buildCsvRow）は一切変更せず、入力順に
// ループしてCSV行を積み上げるだけ。作品0本の人物も1行出力し、作品列は空欄にする
// （buildCsvRowが既にこの挙動を持つため追加対応は不要）。
// 存在しない人物名・重複人物名はどちらも「1件でもあればCSVを一切書き出さずエラー
// 終了する」という全件検証を先に行ってから作品選定に進む（部分的な書き出しを防ぐ）。
async function runBatch(personNames: string[]): Promise<void> {
  // ── 重複チェック ──
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of personNames) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    console.error(`人物名が重複して指定されています: ${[...duplicates].join(', ')}`);
    console.error('CSVは生成していません。重複を解消して再実行してください。');
    process.exit(1);
  }

  // ── 存在確認（DB未登録の人物が1人でもいればCSVを書き出さない） ──
  const notFound: string[] = [];
  for (const name of personNames) {
    const person = await getPersonWithConfigMerged(name);
    if (!person) notFound.push(name);
  }
  if (notFound.length > 0) {
    console.error(`登録されていない人物名が含まれています: ${notFound.join(', ')}`);
    console.error('CSVは生成していません。人物名を確認して再実行してください。');
    process.exit(1);
  }

  // ── 人物ごとに既存ロジックで作品選定 → 行を積み上げ ──
  const rows: string[][] = [];
  for (const name of personNames) {
    const { selected, excludedTop, imageRejected } = await selectTopWorks(name);
    rows.push(buildCsvRow(name, selected));

    console.log(`\n--- ${name} ---`);
    if (selected.length === 0) {
      console.log('該当する映画・ドラマ作品が見つからなかったため、作品欄は空欄で出力します。');
    }
    logSelectedWorks(selected, excludedTop, imageRejected);
  }

  const csvContent = [CSV_HEADER, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  const fileName = buildBatchOutputFileName();
  const outputPath = writeCsvFile(fileName, csvContent);

  console.log(`\nCSV生成完了（${personNames.length}人分）: ${outputPath}\n`);
  console.log('=== CSVの中身 ===');
  console.log(csvContent);
}

async function main() {
  const personNames = process.argv.slice(2)
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  if (personNames.length === 0) {
    console.error('使い方:');
    console.error('  人物1人: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名"');
    console.error('  複数人物: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名1" "人物名2" ...');
    process.exit(1);
  }

  if (personNames.length === 1) {
    await runSinglePerson(personNames[0]);
  } else {
    await runBatch(personNames);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('CSV生成に失敗しました:', err);
  process.exit(1);
});
