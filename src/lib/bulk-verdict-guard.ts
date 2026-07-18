// PersonWorks.tsx の handleBulkWorkVerdict から抽出した純粋関数
// window.confirm の結果を受け取り、「処理を続行するか・CSV を含めるか」を判定する

export interface BulkVerdictCsvDecision {
  /** 処理を続行するか */
  proceed:          boolean;
  /** CSV 作品を含めるか */
  includeManualCsv: boolean;
}

/**
 * 一括 verdict 適用時の CSV 作品取り扱いを判定する。
 *
 * 判定ルール:
 *   - status が 'hidden' かつ csvCount > 0 の場合のみ確認が必要
 *   - confirmed=true  → proceed=true,  includeManualCsv=true
 *   - confirmed=false → 非CSV 件数 > 0 なら proceed=true (CSV除外で続行)
 *                       非CSV 件数 = 0 なら proceed=false (全件 CSV のため中止)
 *
 * @param status         適用する verdict ステータス
 * @param selectedCount  選択された作品の総数
 * @param csvCount       選択中の manual_csv 作品数
 * @param confirmed      window.confirm の戻り値（true=OK / false=キャンセル）
 */
export function decideBulkVerdictCsvHandling(
  status:         string,
  selectedCount:  number,
  csvCount:       number,
  confirmed:      boolean,
): BulkVerdictCsvDecision {
  // hidden 以外、または CSV がなければ確認不要
  if (status !== 'hidden' || csvCount === 0) {
    return { proceed: true, includeManualCsv: false };
  }

  const nonCsvCount = selectedCount - csvCount;

  if (!confirmed) {
    if (nonCsvCount > 0) {
      // CSV 以外の作品があれば CSV 除外で続行
      return { proceed: true, includeManualCsv: false };
    } else {
      // 全件 CSV → キャンセルで中止
      return { proceed: false, includeManualCsv: false };
    }
  }

  return { proceed: true, includeManualCsv: true };
}
