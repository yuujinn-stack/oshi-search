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
