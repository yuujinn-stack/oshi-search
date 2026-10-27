// 楽天イベントの「開催候補」（登録フォームの事前入力）と重複登録の判定。純粋関数。
//
// 楽天ウェブサービスの API（27種・2026-10 確認）にキャンペーン・イベント日程を返すものは無い。楽天のイベントページを
// 自動で読み取る（スクレイピング）こともしない。そのため：
// - 5と0のつく日：毎月 5・10・15・20・25・30 日（2月は30日なし）の候補をカレンダーから作る。時間は公式ページの記載
//   （00:00〜23:59）を初期値にするが、開催・条件は毎回公式ページで確認してから「公式確認済み」にする。
// - お買い物マラソン・スーパーSALE・ブラックフライデー・その他の期間限定イベント：日程が不定期のため、名前と公式ページの
//   URL（確認できたものだけ）を事前入力し、日時・条件は管理者が公式ページを開いて入力する（半自動）。
// 候補から作ったイベントは、最終確認日時が空＝「未確認（開催候補）」として登録される（core.ts isOfficiallyConfirmed）。
import { parseJstDateTimeLocal, type RakutenEvent, type RakutenEventType } from './core';

/** 公式ページ（2026-10 に表示を確認したもの。ブラックフライデー・キャンペーン一覧は該当ページが無かったため URL なし） */
export const OFFICIAL_URLS: Partial<Record<RakutenEventType, string>> = {
  five_zero: 'https://event.rakuten.co.jp/campaign/card/pointday/',
  marathon: 'https://event.rakuten.co.jp/campaign/point-up/marathon/',
  super_sale: 'https://event.rakuten.co.jp/campaign/supersale/',
};

export interface EventCandidate {
  key: string;
  eventType: RakutenEventType;
  name: string;
  /** フォームの値（"YYYY-MM-DDTHH:mm"・日本時間）。不定期のイベントは空 */
  startsAt: string;
  endsAt: string;
  officialUrl: string;
  /** 候補の説明（画面に出す。公式確認前であることを明記） */
  hint: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 5と0のつく日の候補（その月の 5・10・15・20・25・30 日。存在しない日は作らない＝2月の30日など） */
export function fiveZeroCandidates(year: number, month: number): EventCandidate[] {
  const last = daysInMonth(year, month);
  return [5, 10, 15, 20, 25, 30].filter((d) => d <= last && !(month === 2 && d === 30)).map((d) => {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    return {
      key: `five_zero:${date}`,
      eventType: 'five_zero',
      name: `5と0のつく日（${month}月${d}日）`,
      startsAt: `${date}T00:00`,
      endsAt: `${date}T23:59`,
      officialUrl: OFFICIAL_URLS.five_zero!,
      hint: 'カレンダーから作った開催候補です。開催の有無・エントリー・条件（楽天カード利用など）は公式ページで確認してください',
    };
  });
}

/** 不定期のイベント（日時は公式ページを見て入力する） */
export function irregularCandidates(year: number, month: number): EventCandidate[] {
  const base = (eventType: RakutenEventType, name: string): EventCandidate => ({
    key: `${eventType}:${year}-${pad(month)}`,
    eventType,
    name,
    startsAt: '',
    endsAt: '',
    officialUrl: OFFICIAL_URLS[eventType] ?? '',
    hint: OFFICIAL_URLS[eventType]
      ? '開催日は不定期です。公式ページを開き、開催期間・エントリー・条件を確認して入力してください'
      : '公式ページのURLを確認できていません。楽天の公式ページを開いてURL・期間・条件を入力してください',
  });
  return [
    base('marathon', `楽天お買い物マラソン（${month}月）`),
    base('super_sale', `楽天スーパーSALE（${month}月）`),
    base('black_friday', `楽天ブラックフライデー（${year}年）`),
    base('other', `楽天の期間限定イベント（${month}月）`),
  ];
}

// ── 重複登録の防止 ──────────────────────────────────────────────────────────────

/** 同じ種類で期間が重なるイベントは同じイベントとみなす種類（クーポン・その他は同時に複数あり得るため名前と開始日時で判定） */
const SINGLE_AT_A_TIME: RakutenEventType[] = ['five_zero', 'marathon', 'super_sale', 'black_friday'];

/** 登録・更新しようとしているイベントと重複する既存のイベント（無ければ null） */
export function findDuplicateEvent(
  existing: Pick<RakutenEvent, 'id' | 'name' | 'eventType' | 'startsAt' | 'endsAt'>[],
  v: { name: string; eventType: RakutenEventType; startsAt: number; endsAt: number },
  excludeId?: number,
): Pick<RakutenEvent, 'id' | 'name' | 'eventType' | 'startsAt' | 'endsAt'> | null {
  for (const e of existing) {
    if (e.id === excludeId) continue;
    if (SINGLE_AT_A_TIME.includes(v.eventType)) {
      if (e.eventType === v.eventType && e.startsAt < v.endsAt && v.startsAt < e.endsAt) return e;
    } else if (e.eventType === v.eventType && e.name.trim() === v.name.trim() && e.startsAt === v.startsAt) {
      return e;
    }
  }
  return null;
}

/** 候補が登録済みか（同じ判定。不定期の候補は日時が無いため判定しない） */
export function candidateRegistered(existing: Pick<RakutenEvent, 'id' | 'name' | 'eventType' | 'startsAt' | 'endsAt'>[], c: EventCandidate) {
  const s = parseJstDateTimeLocal(c.startsAt), en = parseJstDateTimeLocal(c.endsAt);
  if (s == null || en == null) return null;
  return findDuplicateEvent(existing, { name: c.name, eventType: c.eventType, startsAt: s, endsAt: en });
}
