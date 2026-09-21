/**
 * 人物名を指定すると、Instagram自動投稿ツール（tools/instagram-post-generator/）が
 * 必要とする形式（{ personName, works: [{title, vod, image}, ...] }）のJSONを
 * 標準出力へ書き出す、読み取り専用のエクスポートスクリプト。
 *
 * 作品選定・VOD判定・画像URL解決は、Canva一括作成ツール（generate-csv.ts）の
 * selectTopWorks()・buildVodDisplayString() をそのまま再利用する
 * （新しい選定ロジックを重複して作らない。並び順・除外条件も完全に同一）。
 *
 * 使い方（本体のsrc/libを読むため、必ずこのリポジトリのルートから実行する）:
 *   npx dotenv -e .env.local -- npx tsx tools/canva-instagram/export-person-for-ig.ts "人物名"
 *
 * DB（Neon Postgres, DATABASE_URL）への読み取り専用アクセスのみ。
 * INSERT/UPDATE/DELETEは一切行わない。既存サイトの動作には影響しない。
 */
import 'dotenv/config';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { selectTopWorks, buildVodDisplayString } from './work-selection';

// このスクリプトの標準出力は「JSON1件のみ」を呼び出し側（instagram-post-generator）が
// そのままJSON.parseする契約のため、既存のsrc/lib内部の診断ログ（console.log呼び出し、
// 例: persons.tsのgetPublishedExtra）が標準出力に混ざらないよう、console.logをstderrへ
// リダイレクトする（src/lib側のファイルは変更しない）。このファイル自身は
// console.error / process.stdout.write のみを使う。
console.log = console.error;

async function main() {
  const personName = process.argv[2]?.trim();
  if (!personName) {
    console.error('使い方: npx tsx tools/canva-instagram/export-person-for-ig.ts "人物名"');
    process.exit(1);
  }

  const person = await getPersonWithConfigMerged(personName);
  if (!person) {
    console.error(`人物が見つかりません: ${personName}`);
    process.exit(1);
  }

  const { selected } = await selectTopWorks(person.name);

  const works = selected.map(({ work, confirmedProviders }) => ({
    title: work.title,
    vod: buildVodDisplayString(confirmedProviders),
    image: getRenderableWorkImageUrl(getWorkDisplayImage(work)) ?? null,
  }));

  // 診断メッセージはstderrへ（stdoutはJSON専用。呼び出し側がJSON.parseする前提のため）
  console.error(`${person.name}: 配信中の作品候補 ${works.length}件`);

  process.stdout.write(JSON.stringify({ personName: person.name, works }, null, 2) + '\n');
}

main().catch((err) => {
  console.error('エクスポート処理でエラーが発生しました:', err instanceof Error ? err.message : err);
  process.exit(1);
});
