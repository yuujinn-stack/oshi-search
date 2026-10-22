// 商品データ（products の1行＝人物×カテゴリの items 配列）の同時更新で、他の更新を上書きしないための仕組み。
//
// 商品の書き込みはどれも「行を読む → items を作り直す → 行ごと書く」ため、読んでから書くまでの間に別の更新
// （新商品の発見・管理画面の編集・手動登録・復旧・価格更新・価格の承認）が入ると、古い items で上書きして消してしまう。
// そこで書き込みは「読んだ時点の items と完全に一致する場合だけ」行う（src/db/write.ts の guard。jsonb の比較）。
// 一致しなければ ProductWriteConflictError を投げ、呼び出し側は最新の行を読み直して同じ変更を作り直す（retryOnProductWriteConflict）。
// 何度やっても一致しなければ書き込まずにエラーにする（他の更新は残る）。
// scripts/manual-affiliate-url-fix/run.ts の楽観ロック（items = 読んだ items のときだけ UPDATE）と同じ考え方。

export class ProductWriteConflictError extends Error {
  constructor(personName: string, category: string) {
    super(`商品データが読み込み後に更新されたため保存しませんでした（${personName}/${category}）`);
    this.name = 'ProductWriteConflictError';
  }
}

export function isProductWriteConflict(e: unknown): boolean {
  return e instanceof ProductWriteConflictError || (e as { name?: string } | null)?.name === 'ProductWriteConflictError';
}

/** 読み直して作り直す回数の上限 */
export const PRODUCT_WRITE_MAX_ATTEMPTS = 4;

/**
 * fn（行を読む → items を作る → guard つきで書く）を、同時更新で書けなかったら読み直してやり直す。
 * fn は毎回 DB から読み直すこと（前回読んだ items を使い回さない）。
 */
export async function retryOnProductWriteConflict<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? PRODUCT_WRITE_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (!isProductWriteConflict(e) || attempt >= attempts) throw e;
      // 同時に動いている更新と重ならないよう、少し待ってから読み直す
      await sleep(40 * attempt + Math.floor(Math.random() * 60));
    }
  }
}
