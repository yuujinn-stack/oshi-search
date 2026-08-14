// ChatGPTへ配信状況調査を依頼するプロンプト（②配信再調査）の共通ロジック（純粋関数・DBアクセスなし）。
// src/app/admin/work-check/ChatGptPromptSection.tsx（人物単位の一括調査）と
// src/app/api/admin/vod-recheck/research-prompt/route.ts（/admin/vod-recheck の選択作品調査）の
// 両方がこのテンプレート・行フォーマットを共有する。同じ調査依頼文・調査条件・対象サービス一覧・
// availabilityType一覧・出力形式・「作品CSVここから/ここまで」区切りを二重実装しないため。
import { csvDownloadSection } from '@/lib/chatGptPromptUtil';

export function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const VOD_RESEARCH_CSV_HEADER = 'workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices';

export interface VodResearchCsvRow {
  workId: string;
  personName: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  roleName: string | null;
  currentVodServices: string;
}

export function buildVodResearchCsvRow(row: VodResearchCsvRow): string {
  return [
    csvEscape(row.workId),
    csvEscape(row.personName),
    csvEscape(row.title),
    csvEscape(row.workType),
    csvEscape(String(row.releaseYear ?? '')),
    csvEscape(row.roleName ?? ''),
    csvEscape(row.currentVodServices),
  ].join(',');
}

// worksCsv: ヘッダー行込みの完成済みCSV文字列（VOD_RESEARCH_CSV_HEADER + buildVodResearchCsvRowの行群）
// filenameLabel: csvDownloadSection が案内するダウンロードファイル名の接頭辞
export function buildBatchVodResearchPrompt(worksCsv: string, filenameLabel: string): string {
  return `以下のCSVに含まれる作品について、日本国内で現在視聴可能な配信サービスを調査してください。

条件

・推測禁止
・日本国内で現在視聴可能な情報のみ
・過去配信のみは除外
・公式サイト、配信サービス公式、番組公式を優先
・workId は必ず保持
・確認できない場合は vodService=unknown を出力
・1作品1サービスで1行（複数サービスは複数行）

調査対象サービス

Hulu / U-NEXT / Lemino / Netflix / Prime Video / DMM TV / TELASA / FOD / ABEMA / TVer / Disney+ / YouTube / NHKオンデマンド

availabilityType は以下を使用

flatrate（見放題）/ rent（レンタル）/ buy（購入）/ free（無料）/ unknown（不明）

出力形式

workId,vodService,availabilityType,confidence,sourceUrl,note

---作品CSVここから---
${worksCsv}
---作品CSVここまで---
${csvDownloadSection(`${filenameLabel}_VOD配信情報.csv`)}`;
}

// ── ChatGPT完全調査（/admin/vod-recheck「ChatGPT完全同期」モード）専用プロンプト ──────
// buildBatchVodResearchPrompt（既存・work-check等と共有）とは別関数として新規追加する。
// 既存の呼び出し元（ChatGptPromptSection.tsx等）の挙動には一切影響しない。
//
// 通常の追加調査プロンプトとの違い:
//  - 対象14サービスは「これが確認できる全て」という完全同期の前提を明記する
//    （CSVに含まれないサービスは、次の完全同期でDBから削除されることを調査者に伝える）
//  - 同名別作品で対象作品を確実に特定できない場合の出力方法を明記する
//  - のぎ動画を含む14サービス全てを対象とする（既存プロンプトは13サービスのみだった）
export const CHATGPT_FULL_SYNC_TARGET_SERVICES =
  'Hulu / U-NEXT / Lemino / Netflix / Prime Video / DMM TV / TELASA / FOD / ABEMA / TVer / Disney+ / YouTube / NHKオンデマンド / のぎ動画';

// ChatGPT完全同期プロンプトの作品リストCSV専用の列（既存のVOD_RESEARCH_CSV_HEADER/
// buildVodResearchCsvRowはwork-check等と共有のため変更しない。groupNameは同名作品の
// 判別を助ける補助的な識別情報としてのみChatGPTへ渡す＝グループ一致で作品を確定させる
// ものではない）。
export const CHATGPT_FULL_SYNC_CSV_HEADER = 'workId,personName,groupName,workTitle,workType,releaseYear,roleName,currentVodServices';

export interface ChatgptFullSyncCsvRow extends VodResearchCsvRow {
  groupName: string;
}

export function buildChatgptFullSyncCsvRow(row: ChatgptFullSyncCsvRow): string {
  return [
    csvEscape(row.workId),
    csvEscape(row.personName),
    csvEscape(row.groupName),
    csvEscape(row.title),
    csvEscape(row.workType),
    csvEscape(String(row.releaseYear ?? '')),
    csvEscape(row.roleName ?? ''),
    csvEscape(row.currentVodServices),
  ].join(',');
}

export function buildChatgptFullSyncPrompt(worksCsv: string, filenameLabel: string): string {
  return `以下のCSVに含まれる各作品について、日本国内で現在視聴可能な配信サービスを、対象14サービスすべて確認したうえで調査してください。

重要：この調査結果は「対象14サービスに関する完全な最新状態」として、これまでの登録内容を置き換えます。
今回のCSVに含まれないサービスは「現在配信されていない」として扱われます。

条件

・推測禁止
・日本国内で現在視聴可能な情報のみ
・過去配信のみは除外
・公式サイト、配信サービス公式、番組公式を優先
・workId は必ず保持（タイトルではなくworkIdを唯一の基準として扱う）
・1作品につき、対象14サービスを必ず全て確認すること
・確認した結果、視聴可能なサービスが1つもない場合でも、その作品の行を省略しないこと
  → vodService=unknown, availabilityType=unknown, confidence=high の1行を出力し、
    noteに「14サービスを確認したが現在配信を確認できず」等、確認済みであることを明記する
・タイトルが同じ別作品が存在する等の理由で、提示された人物・所属グループ・公開年・種別を
  用いても対象作品を確実に特定できない場合は、絶対に別の作品を推測して調査しないこと
  → vodService=unknown, availabilityType=unknown, confidence=low の1行を出力し、
    noteに「同名作品があり対象作品を確実に特定できず」と明記する
・CSVのpersonName・groupName・releaseYear・workTypeは、同姓同名の人物や同名タイトルの
  別作品を区別するための補助情報です。特にgroupNameは対象人物の絞り込みにのみ使用し、
  「同じグループの作品だから配信されているはず」という推測には使わないこと

対象14サービス（完全同期の対象範囲）

${CHATGPT_FULL_SYNC_TARGET_SERVICES}

availabilityType は以下を使用

flatrate（見放題）/ rent（レンタル）/ buy（購入）/ free（無料）/ unknown（不明・未確認ではなく確認済みだが対象なし）

出力形式（1作品1サービスで1行、複数サービスは複数行）

workId,vodService,availabilityType,confidence,sourceUrl,note

---作品CSVここから---
${worksCsv}
---作品CSVここまで---
${csvDownloadSection(`${filenameLabel}_ChatGPT完全調査結果.csv`)}`;
}
