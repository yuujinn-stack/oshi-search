/**
 * Instagram予約投稿の日時をAsia/Tokyo（JST, UTC+9固定・夏時間なし）基準で
 * 一貫して扱うためのヘルパー。サーバーの実行環境のタイムゾーン設定に依存しない。
 */

const JST_OFFSET = '+09:00';

/**
 * "YYYY-MM-DD" と "HH:mm" を、JSTの壁時計時刻として解釈しUTCのDateへ変換する。
 * 例: date="2026-09-22", time="09:00" → 2026-09-22T00:00:00.000Z
 *
 * 明示的にオフセットを付与してDateコンストラクタへ渡すため、
 * サーバー・ブラウザ側のシステムタイムゾーンに関係なく常に同じ結果になる。
 */
export function jstWallClockToUtcDate(date: string, time: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`日付の形式が不正です: ${date}`);
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`時刻の形式が不正です: ${time}`);
  }
  const d = new Date(`${date}T${time}:00${JST_OFFSET}`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`日時に変換できませんでした: ${date} ${time}`);
  }
  return d;
}

/** 現在時刻をJSTの "YYYY-MM-DD" / "HH:mm" として取得する（UIの初期値・バリデーション用） */
export function nowJstParts(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Date（またはISO文字列）をJSTの表示用文字列に整形する（例: 2026/09/22 09:00） */
export function formatJst(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** 一括予約のデフォルト1日3枠（JST）。将来「1日1枠/2枠」等に変える場合はここか呼び出し側で差し替える */
export const DEFAULT_DAILY_SLOTS = ['09:00', '15:00', '20:00'] as const;

/** JSTの"YYYY-MM-DD"文字列に日数を加算する（月またぎ・年またぎも正しく処理する） */
export function addDaysJst(dateJst: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateJst)) {
    throw new Error(`日付の形式が不正です: ${dateJst}`);
  }
  const [y, m, d] = dateJst.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface BulkSlotAssignment {
  /** 割り当て順（＝渡した人物リストの並び順に対応するインデックス） */
  index: number;
  dateJst: string;
  timeJst: string;
  scheduledAtIso: string;
}

/**
 * 開始日から1日3枠（デフォルト09:00/15:00/20:00 JST）を古い順に走査し、
 * occupiedIsoSet に含まれる（＝既に予約済みの）枠は飛ばして、
 * count 件ぶんの空き枠を順番に割り当てる。
 *
 * 人物側の並び順（呼び出し側で決めた配列の順）と、この関数が返す配列のindex（0始まり）が
 * そのまま対応する＝「1番目の人物→最初の空き枠」という単純な写像になる。
 *
 * 純粋関数（DBアクセスなし）。occupiedIsoSetは呼び出し側が
 * listOccupiedSlotIsos()等で事前に取得したものを渡す。クライアント側のライブプレビューと
 * サーバー側の最終検証の両方から同じロジックを使うために共有している。
 */
export function allocateBulkSlots(
  startDateJst: string,
  count: number,
  occupiedIsoSet: ReadonlySet<string>,
  dailySlots: readonly string[] = DEFAULT_DAILY_SLOTS,
): BulkSlotAssignment[] {
  const assignments: BulkSlotAssignment[] = [];
  let dateCursor = startDateJst;
  let daysScanned = 0;
  const MAX_DAYS_TO_SCAN = 3650; // 約10年分。無限ループ防止のガード

  while (assignments.length < count) {
    if (daysScanned > MAX_DAYS_TO_SCAN) {
      throw new Error('空き枠が見つからないまま探索上限（約10年分）に達しました');
    }
    for (const timeJst of dailySlots) {
      if (assignments.length >= count) break;
      const scheduledAtIso = jstWallClockToUtcDate(dateCursor, timeJst).toISOString();
      if (occupiedIsoSet.has(scheduledAtIso)) continue;
      assignments.push({ index: assignments.length, dateJst: dateCursor, timeJst, scheduledAtIso });
    }
    dateCursor = addDaysJst(dateCursor, 1);
    daysScanned++;
  }
  return assignments;
}
