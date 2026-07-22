/**
 * 作品重複統合支援スキーマ案（設計のみ・未適用）
 *
 * ⚠ このファイルは設計ドラフトです。
 *   - DB マイグレーションは適用していません。
 *   - `drizzle-kit push` / `migrate` での適用を禁止します。
 *   - 適用する場合は別途 dry-run → レビュー → 承認のフローを経てください。
 *
 * 目的:
 *   1. work_aliases  — 廃止 workId から canonical workId へのリダイレクト
 *   2. work_dedup_reviews — 管理者による統合確認状態の永続化
 */

// ── 将来的なインポート（現時点では未接続）──────────────────────────────────────
// import { pgTable, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';

// ─── work_aliases ─────────────────────────────────────────────────────────────
//
// 廃止された workId（alias）から現行 canonical workId へのリダイレクト先を管理する。
//
// 用途:
//   - 統合後、旧 workId で保存されたブックマーク・外部リンクを canonical へ転送
//   - /work/[workId]/page.tsx で lookup → permanentRedirect
//
// バリデーション（validateAlias で事前検証済みであること）:
//   - aliasWorkId ≠ canonicalWorkId（自己参照禁止）
//   - 循環参照禁止（A→B, B→A）
//   - canonicalWorkId は works テーブルに存在すること
//
// 例:
// export const workAliases = pgTable('work_aliases', {
//   aliasWorkId:     text('alias_work_id').primaryKey(),
//   canonicalWorkId: text('canonical_work_id').notNull(),
//   createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   createdBy:       text('created_by'),                 // 管理者ユーザー名
//   mergeGroupId:    text('merge_group_id'),              // どのグループの統合結果か
// });

// ─── work_dedup_reviews ───────────────────────────────────────────────────────
//
// 管理者が重複グループを確認した結果を永続化する。
//
// 状態:
//   pending  — 未確認
//   approved — 統合実施を承認（現時点では apply 不可、記録のみ）
//   rejected — 同一作品ではないと判断
//   deferred — 後で判断（情報不足等）
//
// 例:
// export const workDedupReviews = pgTable('work_dedup_reviews', {
//   groupId:          text('group_id').primaryKey(),     // makeGroupId の結果
//   status:           text('status').notNull().default('pending'),
//   canonicalWorkId:  text('canonical_work_id'),         // 承認時に確定した canonical
//   duplicateWorkIds: text('duplicate_work_ids').notNull().default('[]'), // JSON 配列
//   reviewedBy:       text('reviewed_by'),
//   reviewedAt:       timestamp('reviewed_at', { withTimezone: true }),
//   note:             text('note'),
//   createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
//   updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
// }, (t) => [
//   index('wdr_status_idx').on(t.status),
// ]);

// ─── 情報保持ルール ───────────────────────────────────────────────────────────
//
// 統合時（将来的な apply 実装の際）に必ず守るルール:
//
//   1. 人物リンク
//      - duplicate の全 (personName, workId) レコードを canonical workId に移動
//      - 同一 personName が canonical にも存在する場合は重複除去（劣後レコードを削除）
//      - roleName は canonical 側に既存のデータがあれば保持、なければ duplicate から補完
//
//   2. VOD プロバイダー
//      - normalizeProviderName で正規化したサービス名が重複する場合は canonical 側を優先
//      - Prime Video 本体 と Prime Videoチャンネル は別サービスとして扱う（統合禁止）
//
//   3. 商品・ランキング
//      - 商品は (personName, category) で管理されるため workId 変更は不要
//      - Redis ランキングキーが workId を含む場合は canonical に書き直す
//
//   4. 削除禁止
//      - DELETE / TRUNCATE / DROP は禁止
//      - 廃止 workId は works テーブルに残し、deleted=true を立てる（論理削除）
//      - work_aliases に alias レコードを作成してリダイレクト
//
//   5. 可逆性
//      - work_dedup_reviews に審査記録を残す
//      - alias レコードを削除すれば元の状態に戻せる設計とする

export {};
