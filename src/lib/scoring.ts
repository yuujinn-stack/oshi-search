// ルールベーススコアリング
// OpenAI APIを呼ばずに商品と人物の関連度を数値化する

export interface ScoreInput {
  title: string;        // 商品名（Books: title, Ichiba: itemName, DVD: title）
  author?: string;      // 著者（BooksBook API）
  artistName?: string;  // アーティスト名（BooksDVD API）
}

export interface ScoreContext {
  name: string;           // 人物名
  group: string;          // グループ名
  excludeKeywords: string[]; // 除外キーワード
}

// 日本語名のスペースを除去して正規化（遠藤 さくら → 遠藤さくら）
function normalize(s: string): string {
  return s.replace(/[\s　]+/g, '');
}

export function calcScore(input: ScoreInput, ctx: ScoreContext): number {
  let score = 0;
  const { name, group, excludeKeywords } = ctx;
  const nameNorm = normalize(name);
  const title = input.title;

  // 商品名（最重要）
  if (title.includes(name) || (nameNorm !== name && title.includes(nameNorm))) score += 50;
  if (group && title.includes(group)) score += 30;

  // 著者フィールド（Books API）—スペース正規化で「遠藤 さくら」も一致
  if (input.author) {
    const aNorm = normalize(input.author);
    if (aNorm.includes(nameNorm)) score += 40;
    if (group && input.author.includes(group)) score += 20;
  }

  // アーティストフィールド（DVD API）
  if (input.artistName) {
    const arNorm = normalize(input.artistName);
    if (arNorm.includes(nameNorm)) score += 40;
    if (group && input.artistName.includes(group)) score += 20;
  }

  // 除外キーワードが商品名にある場合はスコアを大幅減点
  for (const kw of excludeKeywords) {
    if (title.includes(kw)) {
      score -= 100;
      break;
    }
  }

  return score;
}

// 表示するかどうかを判定
// 通常: 20点以上、strictMode（短い名前等）: 50点以上
export function isDisplayable(score: number, strictMode: boolean): boolean {
  return strictMode ? score >= 50 : score >= 20;
}

// AIで判定すべき曖昧な商品かどうか（ルールで確実に判定できない範囲）
export function isBorderline(score: number, strictMode: boolean): boolean {
  const threshold = strictMode ? 50 : 20;
  return score >= 0 && score < threshold;
}
