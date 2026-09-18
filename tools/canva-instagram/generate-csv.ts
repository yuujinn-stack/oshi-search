/**
 * Canva一括作成用CSV/XLSX生成ツール
 *
 * 使い方:
 *   人物1人: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名"
 *   複数人物（一括）: npx dotenv -e .env.local -- npx tsx tools/canva-instagram/generate-csv.ts "人物名1" "人物名2" "人物名3"
 *
 * 既存サイトのDB読み取り専用関数のみを再利用する（INSERT/UPDATE/DELETEは一切行わない）。
 * 出力先:
 *   人物1人: tools/canva-instagram/output/{人物名}_{YYYYMMDD_HHmm}.csv / .xlsx
 *   複数人物: tools/canva-instagram/output/canva_batch_{YYYYMMDD_HHmm}.csv / .xlsx（入力順の行、ヘッダー1行）
 * CSVとXLSXは同じ選定結果・同じ内容から生成される（作品選定・並び順・画像利用可否
 * チェックはCSV/XLSXで完全に共通）。XLSXはCanva Bulk Createの「画像フィールド」に
 * work1Image/work2Image/work3Imageを画像として認識させるため、Canva Bulk Createの
 * URLをそのまま貼っても画像として認識されない仕様（URLは単なるテキストとして扱われる）
 * への対応として、画像バイナリをセル内に直接埋め込んだ形で出力する。
 * XLSXは生成後、自動的に ~/Downloads/ にもコピーされる。
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
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

// ─── XLSX組み立て（Canva Bulk Create用: 画像をセル内に直接埋め込む） ───────────────
// CanvaのBulk Createは画像URLをそのまま貼ってもテキストとして扱われるため、
// CSVとは別にXLSXを生成し、work1Image/work2Image/work3Image列だけ画像バイナリを
// 取得してセル内に埋め込む。行・列・作品内容（テキスト）はCSVの行データ（string[][]）
// をそのまま再利用するため、作品選定ロジック・画像利用可否チェックには一切影響しない。
const IMAGE_COLUMN_LABELS = new Set(['work1Image', 'work2Image', 'work3Image']);
const XLSX_IMAGE_COLUMN_WIDTH = 20;
const XLSX_IMAGE_ROW_HEIGHT = 100;

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function inferImageExtension(url: string): 'jpeg' | 'png' | 'gif' {
  const lower = url.toLowerCase();
  if (lower.includes('.png')) return 'png';
  if (lower.includes('.gif')) return 'gif';
  return 'jpeg';
}

// XLSXだけに追加する列（CSVの列構成・出力内容は一切変更しない）
const TITLE_FULL_COLUMNS = ['work1TitleFull', 'work2TitleFull', 'work3TitleFull'];
const XLSX_EXTRA_COLUMNS = ['personPageImage', ...TITLE_FULL_COLUMNS];
const XLSX_HEADER = [...CSV_HEADER, ...XLSX_EXTRA_COLUMNS];
const COVER_IMAGE_COL_INDEX = CSV_HEADER.indexOf('coverImage'); // 既存列を人物写真用に正式採用
const PERSON_PAGE_IMAGE_COL_INDEX = XLSX_HEADER.indexOf('personPageImage');
const TITLE_FULL_COL_INDEXES = TITLE_FULL_COLUMNS.map((label) => XLSX_HEADER.indexOf(label));

// ─── XLSX表示専用: 長いタイトルの改行調整 ──────────────────────────────────────────
// CSVの列内容・splitTitleForCanva（title1/title2への分割）は一切変更しない。
// ここではXLSXのセルに書き込む「表示用の値」だけを対象に、既に分割済みの
// title1/title2それぞれについて、1セグメントが長すぎる場合はセル内改行（\n）を
// 追加して複数行に折り返す。文字情報の省略・削除は行わない（文字は1つも減らさない）。
const TITLE_COLUMN_LABELS = new Set([
  'work1Title1', 'work1Title2', 'work2Title1', 'work2Title2', 'work3Title1', 'work3Title2',
]);
const XLSX_LINE_WRAP_THRESHOLD = 10; // 1行あたりの目安文字数
const XLSX_LINE_DELIMITERS = /[ 　・:：\-－~〜／\/]/g;
// この記号「だけ」で構成される行は作らない（区切り記号は前の行の末尾へ結合する）
const PUNCTUATION_ONLY_LINE = /^[ 　・:：\-－~〜／\/]+$/;

function insertLineBreaksForXlsx(text: string): string {
  if (!text || text.length <= XLSX_LINE_WRAP_THRESHOLD) return text;

  const rawLines: string[] = [];
  let remaining = text;
  while (remaining.length > XLSX_LINE_WRAP_THRESHOLD) {
    const window = remaining.slice(0, XLSX_LINE_WRAP_THRESHOLD + 4);
    const delimPositions = [...window.matchAll(new RegExp(XLSX_LINE_DELIMITERS))].map((m) => m.index!);
    let breakAt: number;
    if (delimPositions.length > 0) {
      // 目安文字数に一番近い区切り文字の直後で折り返す（自然な位置を優先）
      breakAt = delimPositions.reduce((best, p) =>
        Math.abs(p - XLSX_LINE_WRAP_THRESHOLD) < Math.abs(best - XLSX_LINE_WRAP_THRESHOLD) ? p : best,
      ) + 1;
    } else {
      breakAt = XLSX_LINE_WRAP_THRESHOLD; // 区切り文字がなければ文字数で機械的に折り返す
    }
    const segment = remaining.slice(0, breakAt).trim();
    if (segment.length === 0) break; // 無限ループ防止
    rawLines.push(segment);
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) rawLines.push(remaining);

  // 区切り記号だけの行を作らない: 記号のみの行は「前の行の末尾」に結合する
  // （行頭に記号だけが浮くより、直前の単語の末尾に付く方が自然に見えるため）。
  // 先頭行が記号だけになった場合のみ、直後の行の先頭に結合する。
  const lines: string[] = [];
  for (const line of rawLines) {
    if (PUNCTUATION_ONLY_LINE.test(line) && lines.length > 0) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`;
    } else {
      lines.push(line);
    }
  }
  if (lines.length > 1 && PUNCTUATION_ONLY_LINE.test(lines[0])) {
    lines[1] = `${lines[0]} ${lines[1]}`;
    lines.shift();
  }

  return lines.join('\n'); // 文字は1文字も削除・省略しない。改行を挿入するのみ
}

// ─── XLSX表示専用: 個別タイトルの短縮表示（ユーザー指定の例外のみ） ────────────────
// CSVの内容・作品選定ロジック・splitTitleForCanvaには一切影響しない。
// ここに登録されたTitle1の値だけをXLSX表示用に短縮し、対応するTitle2は空欄にする。
// 注: Title1/Title2の2ボックス方式は、Canva Bulk Createが空欄セルをテンプレートの
// 初期文字列で埋めてしまう問題があり、ノーブレークスペース(U+00A0)・ゼロ幅スペース
// (U+200B)のどちらでも回避できなかった。そのため下記のwork*TitleFull列（1セルに
// タイトル全体をまとめる方式）を正式な表示手段とし、Title1/Title2列は互換性維持の
// ためだけに残す（Canvaは今後この2列を参照しない想定）。
const XLSX_TITLE_DISPLAY_OVERRIDES: Record<string, string> = {
  '旅するSnow Man - Traveling': '旅するSnow Man',
};
const TITLE1_COL_INDEXES = CSV_HEADER
  .map((label, i) => (label.endsWith('Title1') ? i : -1))
  .filter((i) => i >= 0);

function applyXlsxTitleOverrides(row: string[]): { row: string[]; overriddenIndexes: Set<number> } {
  const result = [...row];
  const overriddenIndexes = new Set<number>();
  for (const idx of TITLE1_COL_INDEXES) {
    const override = XLSX_TITLE_DISPLAY_OVERRIDES[result[idx]];
    if (override !== undefined) {
      result[idx] = override;
      result[idx + 1] = ''; // 対応するTitle2は空欄（この列はCanvaから参照されなくなる想定）
      overriddenIndexes.add(idx);
      overriddenIndexes.add(idx + 1);
    }
  }
  return { row: result, overriddenIndexes };
}

// ─── XLSX専用: work*TitleFull列（1セルにタイトル全体をまとめる方式） ───────────────
// Title1/Title2の2ボックス方式をやめ、1つのテキストボックスに常に実データを
// 入れることで「空欄セルにテンプレートの初期文字列が残る」問題を構造的に回避する。
// 既存のTitle1/Title2列・CSV・splitTitleForCanvaには一切影響しない。
function buildTitleFullValue(title1: string, title2: string): string {
  const override = XLSX_TITLE_DISPLAY_OVERRIDES[title1];
  if (override !== undefined) return override; // 短縮表示ケースは追加の改行をしない
  const combined = title2 ? `${title1} ${title2}` : title1;
  return insertLineBreaksForXlsx(combined);
}

function anchorImageToCell(sheet: ExcelJS.Worksheet, imageId: number, colIdx: number, rowNum: number): void {
  // Canva Bulk Createの要件「単一セルの中に収まっていること」を満たすため、
  // twoCellAnchor + editAs:'oneCell' でセル範囲ぴったりにアンカーする（検証済みの方式）。
  sheet.addImage(imageId, {
    tl: { col: colIdx, row: rowNum - 1 } as ExcelJS.Anchor,
    br: { col: colIdx + 1, row: rowNum } as ExcelJS.Anchor,
    editAs: 'oneCell',
  });
}

// rows: CSV_HEADERに対応する行データ（buildCsvRowの戻り値をそのまま渡す。内容は不変）
// personNames: rowsと同じ順番の人物名配列（coverImage/personPageImageの取得に使う）
async function buildXlsxWorkbook(rows: string[][], personNames: string[]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  const personImageMap = loadPersonImageMap();

  XLSX_HEADER.forEach((label, i) => {
    sheet.getRow(1).getCell(i + 1).value = label;
  });

  const workImageColIndexes = CSV_HEADER
    .map((label, i) => (IMAGE_COLUMN_LABELS.has(label) ? i : -1))
    .filter((i) => i >= 0);
  const titleColIndexes = CSV_HEADER
    .map((label, i) => (TITLE_COLUMN_LABELS.has(label) ? i : -1))
    .filter((i) => i >= 0);
  for (const idx of [...workImageColIndexes, COVER_IMAGE_COL_INDEX, PERSON_PAGE_IMAGE_COL_INDEX]) {
    sheet.getColumn(idx + 1).width = XLSX_IMAGE_COLUMN_WIDTH;
  }

  for (let r = 0; r < rows.length; r++) {
    const rowNum = r + 2; // ヘッダーが1行目のため
    const row = rows[r];
    const personName = personNames[r];
    const excelRow = sheet.getRow(rowNum);
    excelRow.height = XLSX_IMAGE_ROW_HEIGHT;

    // 既存14列（CSVと完全に同じ内容）。work1Image等の画像列はセル値を空にする。
    // タイトル列（work*Title1/2）だけは、CSVの値はそのまま保ちつつXLSX表示用に
    // 改行・個別短縮表示（例外指定分のみ）を適用する（CSV自体・文字の省略はしない）。
    // 短縮表示に置き換えた列は、既に短くなっているため追加の改行は行わない。
    const { row: displayRow, overriddenIndexes } = applyXlsxTitleOverrides(row);
    for (let c = 0; c < row.length; c++) {
      if (workImageColIndexes.includes(c)) {
        excelRow.getCell(c + 1).value = '';
      } else if (titleColIndexes.includes(c)) {
        const cell = excelRow.getCell(c + 1);
        cell.value = overriddenIndexes.has(c) ? displayRow[c] : insertLineBreaksForXlsx(displayRow[c]);
        cell.alignment = { wrapText: true, vertical: 'top' };
      } else {
        excelRow.getCell(c + 1).value = row[c];
      }
    }
    // personPageImage列（XLSXのみの追加列）。値は常に空にしておき、画像は別途埋め込む。
    excelRow.getCell(PERSON_PAGE_IMAGE_COL_INDEX + 1).value = '';

    // work*TitleFull列（XLSXのみの追加列）。Title1/Title2の元の値（row、上書き前）から
    // タイトル全体を1セルにまとめて書き込む。作品が存在しない枠は空文字になる。
    TITLE1_COL_INDEXES.forEach((title1Idx, i) => {
      const fullColIdx = TITLE_FULL_COL_INDEXES[i];
      const fullValue = buildTitleFullValue(row[title1Idx], row[title1Idx + 1]);
      const cell = excelRow.getCell(fullColIdx + 1);
      cell.value = fullValue;
      cell.alignment = { wrapText: true, vertical: 'top' };
    });

    // work1Image / work2Image / work3Image の埋め込み（既存処理、変更なし）
    for (const colIdx of workImageColIndexes) {
      const url = row[colIdx];
      if (!url) continue;
      const buffer = await fetchImageBuffer(url);
      if (!buffer) {
        console.log(`  [警告] 画像取得に失敗したためXLSXへの埋め込みをスキップしました: ${url}`);
        continue;
      }
      const imageId = workbook.addImage({ buffer: buffer as unknown as ExcelJS.Buffer, extension: inferImageExtension(url) });
      anchorImageToCell(sheet, imageId, colIdx, rowNum);
    }

    // coverImage（人物写真）: person-images.jsonに登録があれば埋め込み、なければ空欄のまま
    const coverImageEntry = personImageMap[personName];
    const coverImageBuffer = await resolvePersonImageBuffer(coverImageEntry);
    if (coverImageBuffer) {
      const ext = /^https?:\/\//i.test(coverImageEntry ?? '') ? inferImageExtension(coverImageEntry!) : 'jpeg';
      const imageId = workbook.addImage({ buffer: coverImageBuffer as unknown as ExcelJS.Buffer, extension: ext });
      anchorImageToCell(sheet, imageId, COVER_IMAGE_COL_INDEX, rowNum);
    }

    // personPageImage（人物ページのスクリーンショット）: 毎回Playwrightで撮影
    console.log(`  ${personName}の人物ページをスクリーンショット中...`);
    const screenshotBuffer = await capturePersonPageScreenshot(personName);
    if (screenshotBuffer) {
      const imageId = workbook.addImage({ buffer: screenshotBuffer as unknown as ExcelJS.Buffer, extension: 'png' });
      anchorImageToCell(sheet, imageId, PERSON_PAGE_IMAGE_COL_INDEX, rowNum);
    }
  }

  return workbook;
}

// ─── coverImage（人物写真）: person-images.json による手動管理 ────────────────────
// 既存DB・公開サイトには人物写真データが一切存在しないため、Canva専用の対応表
// ファイルで管理する。ここに未登録の人物は必ず空欄にする（別画像の代用はしない）。
const PERSON_IMAGES_FILE = path.join(__dirname, 'person-images.json');

function loadPersonImageMap(): Record<string, string> {
  try {
    const raw = fs.readFileSync(PERSON_IMAGES_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function resolvePersonImageBuffer(entry: string | undefined): Promise<Buffer | null> {
  if (!entry || entry.trim().length === 0) return null;
  const value = entry.trim();
  if (/^https?:\/\//i.test(value)) {
    return fetchImageBuffer(value);
  }
  // ローカルパス（tools/canva-instagram/ からの相対パスまたは絶対パス）
  const resolvedPath = path.isAbsolute(value) ? value : path.join(__dirname, value);
  try {
    return fs.readFileSync(resolvedPath);
  } catch {
    console.log(`  [警告] person-images.jsonのパスが読み込めませんでした: ${value}`);
    return null;
  }
}

// ─── personPageImage（人物ページのスクリーンショット） ────────────────────────────
// 本番サイトの実際の人物ページをPlaywrightで開き、ビューポート内（スクロールなし
// で見える範囲）だけを撮影する。DB・公開サイト側のコードには一切触れない。
const PERSON_PAGE_ORIGIN = 'https://oshi-search.jp';
const SCREENSHOT_VIEWPORT = { width: 1200, height: 1600 };

async function capturePersonPageScreenshot(personName: string): Promise<Buffer | null> {
  const url = `${PERSON_PAGE_ORIGIN}/person/${encodeURIComponent(personName)}`;
  const tmpPath = path.join(os.tmpdir(), `canva-person-screenshot-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: SCREENSHOT_VIEWPORT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(500); // フォント・画像の描画安定待ち
    await page.screenshot({ path: tmpPath }); // fullPage指定なし = ビューポート内のみ
    return fs.readFileSync(tmpPath);
  } catch (err) {
    console.log(`  [警告] ${personName}の人物ページスクリーンショットに失敗しました: ${String(err)}`);
    return null;
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); // 一時ファイルは必ず削除
  }
}

function copyToDownloads(sourcePath: string): string {
  const downloadsDir = path.join(os.homedir(), 'Downloads');
  const destPath = path.join(downloadsDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destPath);
  return destPath;
}

// ─── ファイル名生成 ─────────────────────────────────────────────────────────────
// CSV/XLSXで同じタイムスタンプを使い、ファイル名がペアで対応するようにする。
function buildTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// 人物1人: 人物名_YYYYMMDD_HHmm.csv / .xlsx（既存の命名規則、変更なし）
function buildOutputFileName(personName: string, stamp: string, ext: 'csv' | 'xlsx'): string {
  return `${personName}_${stamp}.${ext}`;
}

// 複数人物（一括生成）: canva_batch_YYYYMMDD_HHmm.csv / .xlsx
function buildBatchOutputFileName(stamp: string, ext: 'csv' | 'xlsx'): string {
  return `canva_batch_${stamp}.${ext}`;
}

function writeCsvFile(fileName: string, csvContent: string): string {
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  return outputPath;
}

async function writeXlsxFile(fileName: string, workbook: ExcelJS.Workbook): Promise<string> {
  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, fileName);
  await workbook.xlsx.writeFile(outputPath);
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

  const stamp = buildTimestamp();
  const csvFileName = buildOutputFileName(personName, stamp, 'csv');
  const csvOutputPath = writeCsvFile(csvFileName, csvContent);

  console.log(`CSV生成完了: ${csvOutputPath}\n`);
  logSelectedWorks(selected, excludedTop, imageRejected);
  console.log('\n=== CSVの中身 ===');
  console.log(csvContent);

  console.log('\nXLSX生成中（画像埋め込み・人物ページ撮影のため時間がかかる場合があります）...');
  const workbook = await buildXlsxWorkbook([row], [personName]);
  const xlsxFileName = buildOutputFileName(personName, stamp, 'xlsx');
  const xlsxOutputPath = await writeXlsxFile(xlsxFileName, workbook);
  const downloadsPath = copyToDownloads(xlsxOutputPath);
  console.log(`XLSX生成完了: ${xlsxOutputPath}`);
  console.log(`Downloadsへコピー完了: ${downloadsPath}`);
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
  const stamp = buildTimestamp();
  const csvFileName = buildBatchOutputFileName(stamp, 'csv');
  const csvOutputPath = writeCsvFile(csvFileName, csvContent);

  console.log(`\nCSV生成完了（${personNames.length}人分）: ${csvOutputPath}\n`);
  console.log('=== CSVの中身 ===');
  console.log(csvContent);

  // Canva Bulk Createが複数行XLSXの画像を行ごとに正しく読み分けられない制約が
  // 判明したため、複数人物モードのXLSXだけは「人物ごとに1行だけのXLSX」を
  // 1ファイルずつ生成する（CSVは従来通り1ファイルにまとめたまま、内容も不変）。
  console.log('\nXLSX生成中（人物ごとに1ファイル・画像埋め込み・人物ページ撮影のため時間がかかる場合があります）...');
  for (let i = 0; i < personNames.length; i++) {
    const name = personNames[i];
    const workbook = await buildXlsxWorkbook([rows[i]], [name]);
    const xlsxFileName = buildOutputFileName(name, stamp, 'xlsx');
    const xlsxOutputPath = await writeXlsxFile(xlsxFileName, workbook);
    const downloadsPath = copyToDownloads(xlsxOutputPath);
    console.log(`XLSX生成完了（${name}）: ${xlsxOutputPath}`);
    console.log(`Downloadsへコピー完了: ${downloadsPath}`);
  }
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
