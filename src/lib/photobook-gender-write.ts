// 写真集機能: 人物・グループのgender一括保存（DB書き込み・サーバー専用）。
//
// 重要: このファイルはAPI Route（サーバー側）からのみimportすること。
// クライアントコンポーネントから直接importしない（DB依存がクライアントバンドルに
// 混入するのを防ぐため。絞り込み等の純粋関数は photobook-gender.ts に分離してある）。
//
// - OpenAI API・その他外部AIは一切呼び出さない。
// - gender推測は一切行わない。呼び出し側（管理画面）が明示的に指定した値をそのまま保存する。
//
// 原子性について:
// 従来案（各人物ごとに SELECT→spread→upsert のループ）は、途中で1件失敗すると
// 一部だけ更新済み・残りは未更新という中途半端な状態になり得た。加えて、他の管理者が
// 同時に memo/priority 等の別フィールドを編集していた場合、読み取った古い値を丸ごと
// 書き戻してしまい上書き競合が起きる余地があった。
// これを避けるため、gender/updated_at 列だけを対象にした単一のSQL文（INSERT..ON
// CONFLICT / UPDATE）で全件を一括処理する。1つのSQL文は Postgres 側で不可分に
// 実行されるため、複数クエリを neonSql.transaction() で束ねる必要がない
// （db/client.ts の既存コメント通り、drizzle-orm/neon-http は db.transaction() 非対応）。
// 途中で失敗すればその1文自体が丸ごとロールバックされ、部分反映は発生しない。

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import type { PhotobookGender } from './photobook';

// neon-httpドライバは `= ANY($1)` にJS配列をそのまま渡すとPostgres配列リテラルとして
// 解釈できないため、photobook-store.ts と同じ ARRAY[$1,$2,...]::text[] 形式で組み立てる。
function textArraySql(values: readonly string[]) {
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export async function bulkSetPersonGender(
  personNames: readonly string[],
  gender: PhotobookGender | null,
): Promise<{ updated: number }> {
  if (personNames.length === 0) return { updated: 0 };
  // person_meta.gender / updated_at 以外の列には一切触れない
  // （新規行が作られる場合も他列はデフォルトのNULLのまま。既存行の他フィールドは対象外）。
  const result = await db.execute(sql`
    INSERT INTO person_meta (person_name, gender, updated_at)
    SELECT x, ${gender}, NOW() FROM unnest(${textArraySql(personNames)}) AS x
    ON CONFLICT (person_name) DO UPDATE SET
      gender = EXCLUDED.gender,
      updated_at = EXCLUDED.updated_at
    RETURNING person_name
  `);
  return { updated: result.rows.length };
}

export async function bulkSetGroupGender(
  groupNames: readonly string[],
  gender: PhotobookGender | null,
): Promise<{ updated: number }> {
  if (groupNames.length === 0) return { updated: 0 };
  // group_meta.gender / updated_at 以外の列には一切触れない。
  // WHERE句で既存行のみを対象にするため、group_metaに存在しないグループ名は
  // 自動的にスキップされる（捏造しない。UPDATEなのでINSERTは発生しない）。
  const result = await db.execute(sql`
    UPDATE group_meta
    SET gender = ${gender}, updated_at = NOW()
    WHERE group_name = ANY(${textArraySql(groupNames)})
    RETURNING group_name
  `);
  return { updated: result.rows.length };
}
