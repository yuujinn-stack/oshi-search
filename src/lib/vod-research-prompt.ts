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
