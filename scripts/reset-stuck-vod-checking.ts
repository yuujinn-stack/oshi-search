// vodCheckStatus='checking' のまま長時間（STUCK_CHECKING_MS＝2時間以上）放置されている
// 作品を 'needs_recheck'（既存の有効なステータス値。再試行可能な状態）へ安全に戻す
// メンテナンススクリプト。
//
// 背景: /api/cron/vod-recheck の runRecheck() は処理開始時に vodCheckStatus='checking'
// を設定し、完了/失敗時に最終ステータスへ更新するが、Vercel Function timeout等で
// 処理が完走しなかった場合、'checking' のまま永久に固まり、以後の選定条件
// （vodCheckStatus !== 'checking'）から永久に除外されてしまう不具合があった。
//
// このスクリプトは、既存の updateWorkVodCheckStatus() のみを使い、
// isStuckChecking() の条件（本当に処理中の可能性があるものは対象外）を満たす
// 作品だけを対象にする。生SQLでの一括UPDATEは行わない。
// 何度実行しても安全（対象が0件ならログを出すだけで何も更新しない）。
//
// 実行方法: npx dotenv -e .env.local -- npx tsx scripts/reset-stuck-vod-checking.ts
import { getAllPersonsMerged } from '../src/lib/persons';
import { getAllWorks, updateWorkVodCheckStatus } from '../src/lib/work-store';
import { isStuckChecking, STUCK_CHECKING_MS } from '../src/lib/vod-check-throttle';

async function main() {
  const now = Date.now();
  const persons = await getAllPersonsMerged();

  let totalChecking = 0;
  let fixed = 0;

  for (const person of persons) {
    const works = await getAllWorks(person.name);
    for (const work of works) {
      if (work.vodCheckStatus !== 'checking') continue;
      totalChecking++;

      if (!isStuckChecking(work, now)) continue;

      const hoursStuck = Math.floor((now - work.updatedAt) / (60 * 60 * 1000));
      console.log(
        `[reset-stuck-vod-checking] 復旧: personName="${person.name}" workId="${work.id}" title="${work.title}" 停止${hoursStuck}時間`,
      );
      await updateWorkVodCheckStatus(person.name, work.id, 'needs_recheck');
      fixed++;
    }
  }

  console.log(
    `[reset-stuck-vod-checking] 完了: checking状態の総数=${totalChecking} ` +
    `放置基準(${STUCK_CHECKING_MS / (60 * 60 * 1000)}時間)超過で復旧=${fixed} ` +
    `本当に処理中の可能性があり据え置き=${totalChecking - fixed}`,
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
