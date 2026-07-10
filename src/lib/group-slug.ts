import type { GroupMeta } from '@/types/group';

// ── 固定マッピング ──────────────────────────────────────────────────────────────
// GroupMeta.slug が未設定または URL エンコード済み日本語の場合でも、
// 英数字 slug → 正式グループ名 を解決するためのフォールバック。
// 管理画面で slug を正しく設定すれば DB/Redis の値が優先される。
export const SLUG_TO_GROUP_NAME: Record<string, string> = {
  'nogizaka46':              '乃木坂46',
  'hinatazaka46':            '日向坂46',
  'sakurazaka46':            '櫻坂46',
  'keyakizaka46':            '欅坂46',
  'equal-love':              '＝LOVE',
  'not-equal-me':            '≠ME',
  'nearly-equal-joy':        '≒JOY',
  'audrey':                  'オードリー',
  'bananaman':               'バナナマン',
  'bokuga-mitakatta-aozora': '僕が見たかった青空',
  'fruits-zipper':           'FRUITS ZIPPER',
  'cho-tokimeki-sendenbu':   '超ときめき♡宣伝部',
};

// 正式グループ名 → slug の逆引き（複数バリアントを含む）
// 管理画面での slug 候補表示・URL 生成のフォールバックに使用
export const GROUP_NAME_TO_SLUG: Record<string, string> = {
  '乃木坂46':              'nogizaka46',
  '日向坂46':              'hinatazaka46',
  '櫻坂46':                'sakurazaka46',
  '欅坂46':                'keyakizaka46',
  '＝LOVE':                'equal-love',
  '=LOVE':                 'equal-love',  // 半角等号バリアント
  '≠ME':                   'not-equal-me',
  '≒JOY':                  'nearly-equal-joy',
  'オードリー':             'audrey',
  'バナナマン':             'bananaman',
  '僕が見たかった青空':     'bokuga-mitakatta-aozora',
  'FRUITS ZIPPER':         'fruits-zipper',
  '超ときめき♡宣伝部':     'cho-tokimeki-sendenbu',
};

// ── ユーティリティ ──────────────────────────────────────────────────────────────

// ASCII スラッグ判定: 英小文字・数字・ハイフンのみ、先頭が英数字
export function isAsciiSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

// GroupMeta の canonical スラッグを返す
// 優先: 1. GroupMeta.slug が ASCII slug → そのまま
//       2. 固定マッピング (GROUP_NAME_TO_SLUG) にグループ名が存在する → そちらを使用
//       3. encodeURIComponent(groupName) にフォールバック
export function canonicalGroupSlug(meta: GroupMeta): string {
  if (isAsciiSlug(meta.slug)) return meta.slug;
  const mapped = GROUP_NAME_TO_SLUG[meta.groupName];
  if (mapped) return mapped;
  return encodeURIComponent(meta.groupName);
}

// GroupMeta から /groups/{slug} URL を生成
export function groupHref(meta: GroupMeta): string {
  return `/groups/${canonicalGroupSlug(meta)}`;
}

// グループ名から /groups/{slug} URL を生成
// GroupMeta が見つかれば canonicalGroupSlug を使用
// なければ固定マッピング → encodeURIComponent フォールバック
export function groupHrefByName(groupName: string, metas: GroupMeta[]): string {
  const meta = metas.find((m) => m.groupName === groupName);
  if (meta) return groupHref(meta);
  const slug = GROUP_NAME_TO_SLUG[groupName];
  if (slug) return `/groups/${slug}`;
  return `/groups/${encodeURIComponent(groupName)}`;
}

// URL スラッグから GroupMeta を解決
// 優先順:
//   1. GroupMeta.slug と完全一致 (管理画面で slug 設定済みの場合)
//   2. デコードしたスラッグがグループ名と一致 (%E4%...  → 乃木坂46)
//   3. DB に保存された URL エンコード済みスラッグをデコードして一致
//   4. 固定マッピング経由 (nogizaka46 → 乃木坂46 → GroupMeta を探す)
export function resolveGroupFromSlug(slug: string, metas: GroupMeta[]): GroupMeta | null {
  const decoded = tryDecode(slug);

  // 1. slug 完全一致
  const bySlug = metas.find((m) => m.slug === slug);
  if (bySlug) return bySlug;

  // 2. デコードしたスラッグがグループ名と一致
  const byName = metas.find((m) => m.groupName === decoded);
  if (byName) return byName;

  // 3. DB の slug をデコードしたものと一致
  const byDecodedSlug = metas.find((m) => {
    try { return decodeURIComponent(m.slug) === decoded; } catch { return false; }
  });
  if (byDecodedSlug) return byDecodedSlug;

  // 4. 固定マッピング: nogizaka46 → "乃木坂46" → GroupMeta を探す
  const mappedName = SLUG_TO_GROUP_NAME[slug];
  if (mappedName) {
    const byMapped = metas.find((m) => m.groupName === mappedName);
    if (byMapped) return byMapped;
  }

  return null;
}

// slug → groupName を解決
// GroupMeta が見つからなくても固定マッピングでフォールバック（GroupMeta 未登録グループにも対応）
export function resolveGroupName(slug: string, metas: GroupMeta[]): string | null {
  const meta = resolveGroupFromSlug(slug, metas);
  if (meta) return meta.groupName;
  return SLUG_TO_GROUP_NAME[slug] ?? null;
}

function tryDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// ── slug 自動生成 ──────────────────────────────────────────────────────────────
// 拗音（2文字）を先にルックアップ
const ROMAJI_2: Readonly<Record<string, string>> = {
  // ひらがな 拗音
  'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
  'しゃ':'sha','しゅ':'shu','しょ':'sho',
  'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
  'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
  'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
  'みゃ':'mya','みゅ':'myu','みょ':'myo',
  'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
  'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
  'じゃ':'ja', 'じゅ':'ju', 'じょ':'jo',
  'びゃ':'bya','びゅ':'byu','びょ':'byo',
  'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
  'でゅ':'dyu','てゅ':'tyu',
  // カタカナ 拗音
  'キャ':'kya','キュ':'kyu','キョ':'kyo',
  'シャ':'sha','シュ':'shu','ショ':'sho',
  'チャ':'cha','チュ':'chu','チョ':'cho',
  'ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
  'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo',
  'ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo',
  'ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
  'ジャ':'ja', 'ジュ':'ju', 'ジョ':'jo',
  'ビャ':'bya','ビュ':'byu','ビョ':'byo',
  'ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
  // 外来語表記
  'ファ':'fa', 'フィ':'fi', 'フェ':'fe', 'フォ':'fo',
  'ヴァ':'va', 'ヴィ':'vi', 'ヴェ':'ve', 'ヴォ':'vo',
  'ティ':'ti', 'ディ':'di', 'デュ':'dyu',
  'ウィ':'wi', 'ウェ':'we', 'ウォ':'wo',
  'ツァ':'tsa','ツィ':'tsi','ツェ':'tse','ツォ':'tso',
};

// 単文字ルックアップ
const ROMAJI_1: Readonly<Record<string, string>> = {
  // ア行
  'あ':'a', 'い':'i', 'う':'u', 'え':'e', 'お':'o',
  'ア':'a', 'イ':'i', 'ウ':'u', 'エ':'e', 'オ':'o',
  // カ行
  'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
  'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  // サ行
  'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
  // タ行
  'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
  'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  // ナ行
  'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
  // ハ行
  'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
  'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  // マ行
  'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
  // ヤ行
  'や':'ya','ゆ':'yu','よ':'yo',
  'ヤ':'ya','ユ':'yu','ヨ':'yo',
  // ラ行
  'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
  // ワ行
  'わ':'wa','を':'wo','ん':'n',
  'ワ':'wa','ヲ':'wo','ン':'n',
  // 濁音 カ行
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
  // 濁音 サ行
  'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
  'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  // 濁音 タ行
  'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
  // 濁音 ハ行
  'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
  'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  // 半濁音
  'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
  // ヴ
  'ヴ':'vu',
  // 小書き（単独出現時）
  'ぁ':'a', 'ぃ':'i', 'ぅ':'u', 'ぇ':'e', 'ぉ':'o',
  'ァ':'a', 'ィ':'i', 'ゥ':'u', 'ェ':'e', 'ォ':'o',
  'ゃ':'ya','ゅ':'yu','ょ':'yo',
  'ャ':'ya','ュ':'yu','ョ':'yo',
  // 長音符・区切り
  'ー':'-', '・':'-', '　':' ',
};

function kanaToRomaji(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    // 促音 (っ/ッ): 直後の子音を重ねる
    if (text[i] === 'っ' || text[i] === 'ッ') {
      const next = ROMAJI_2[text.slice(i + 1, i + 3)] ?? ROMAJI_1[text[i + 1]] ?? '';
      if (next) {
        // 'chi' → 'tchi' にするため先頭が 'c' なら 't' に置換
        out.push(next[0] === 'c' ? 't' : next[0]);
      }
      i++;
      continue;
    }
    // 2文字ルックアップ（拗音・外来語）
    const two = text.slice(i, i + 2);
    if (ROMAJI_2[two]) {
      out.push(ROMAJI_2[two]);
      i += 2;
      continue;
    }
    // 1文字ルックアップ
    const r = ROMAJI_1[text[i]];
    if (r !== undefined) {
      out.push(r);
      i++;
      continue;
    }
    // そのまま通す（ASCII・漢字等）
    out.push(text[i]);
    i++;
  }
  return out.join('');
}

// グループ名から slug 候補を自動生成する（管理画面ボタン用）
// 固定マッピング優先 → なければかな変換 + ASCII 正規化
// 生成できなかった場合は空文字を返す（呼び出し側で「候補なし」として扱う）
export function generateSlugCandidate(groupName: string): string {
  const name = groupName.trim();
  if (!name) return '';

  // 1. 固定マッピング優先
  const mapped = GROUP_NAME_TO_SLUG[name];
  if (mapped) return mapped;

  // 2. 自動生成
  let s = name;

  // 全角 ASCII → 半角
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  // 特殊記号を ASCII 表現に置換
  s = s
    .replace(/＝/g, 'equal-')
    .replace(/≠/g,  'not-equal-')
    .replace(/≒/g,  'nearly-equal-')
    .replace(/[♡♥★☆♪♫！？]/g, '');

  // かな → ローマ字
  s = kanaToRomaji(s);

  // 漢字・その他の非 ASCII を除去（カナ変換後に残った文字）
  s = s.replace(/[^\x00-\x7F]+/g, '-');

  // slug 形式に正規化（英小文字・数字・ハイフンのみ、先頭末尾ハイフン除去）
  s = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return isAsciiSlug(s) ? s : '';
}
