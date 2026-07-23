import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  primaryKey,
  index,
  serial,
} from 'drizzle-orm/pg-core';

// ── 人物 ──────────────────────────────────────────────────────────────────────
// imported:persons + persons:published + data/persons_master.json を統合
export const persons = pgTable('persons', {
  name:               text('name').primaryKey(),
  groupName:          text('group_name').notNull().default(''),
  genre:              text('genre').notNull().default('坂道'),
  aliases:            jsonb('aliases').$type<string[]>().notNull().default([]),
  tmdbPersonId:       integer('tmdb_person_id'),
  description:        text('description'),
  source:             text('source').notNull().default('static'), // 'static' | 'imported'
  dataFetchStatus:    text('data_fetch_status').notNull().default('not_started'),
  lastDataFetchedAt:  timestamp('last_data_fetched_at', { withTimezone: true }),
  dataFetchError:     text('data_fetch_error'),
  importedAt:         timestamp('imported_at', { withTimezone: true }),
  publishedAt:        timestamp('published_at', { withTimezone: true }), // NULL = 未公開
  config:             jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 人物メタ（admin:person-meta）────────────────────────────────────────────
export const personMeta = pgTable('person_meta', {
  personName:       text('person_name').primaryKey(),
  activityStatus:   text('activity_status'),
  generation:       text('generation'),
  titles:           jsonb('titles').$type<string[]>(),
  currentGroupName: text('current_group_name'),
  joinedAt:         text('joined_at'),
  leftAt:           text('left_at'),
  formerGroupNames: jsonb('former_group_names').$type<string[]>(),
  membershipNote:   text('membership_note'),
  primaryGenre:     text('primary_genre'),
  genres:           jsonb('genres').$type<string[]>(),
  publicRoles:      jsonb('public_roles').$type<string[]>(),
  awards:           jsonb('awards').$type<string[]>(),
  careerStatus:     text('career_status'),
  roleNote:         text('role_note'),
  memo:             text('memo'),
  priority:         text('priority'),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── グループメタ（admin:groups）──────────────────────────────────────────────
export const groupMeta = pgTable('group_meta', {
  groupName:      text('group_name').primaryKey(),
  slug:           text('slug').notNull().default(''),
  activityStatus: text('activity_status').notNull().default('unknown'),
  formedAt:       text('formed_at'),
  endedAt:        text('ended_at'),
  renamedFrom:    text('renamed_from'),
  renamedTo:      text('renamed_to'),
  formerNames:    jsonb('former_names').$type<string[]>().notNull().default([]),
  officialSite:   text('official_site'),
  note:           text('note'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── VOD配信サービス（vod:providers）─────────────────────────────────────────
export const vodProviders = pgTable('vod_providers', {
  slug:      text('slug').primaryKey(),
  name:      text('name').notNull(),
  logoUrl:   text('logo_url').notNull().default(''),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 出演作品（works:{personName}）────────────────────────────────────────────
// AIフィールドは ai_data JSONB、VODフィールドは vod_data JSONB にまとめる
// id は TMDb ベース（tmdb-movie-xxxxx）のため複数人が同一 id を持つ → PK は (person_name, id)
export const works = pgTable('works', {
  id:              text('id').notNull(),
  personName:      text('person_name').notNull(),
  title:           text('title').notNull(),
  originalTitle:   text('original_title'),
  normalizedTitle: text('normalized_title').notNull().default(''),
  type:            text('type').notNull(),
  tmdbId:          integer('tmdb_id'),
  source:          text('source').notNull(),
  releaseYear:     integer('release_year'),
  roleName:        text('role_name'),
  overview:        text('overview'),
  posterUrl:       text('poster_url'),
  ogImageUrl:      text('og_image_url'),
  ogSourceUrl:     text('og_source_url'),
  ogImageFetchedAt: timestamp('og_image_fetched_at', { withTimezone: true }),
  ogImageStatus:   text('og_image_status'),
  ogImageError:    text('og_image_error'),
  confidenceScore: numeric('confidence_score').notNull().default('0'),
  status:          text('status').notNull().default('needs_review'),
  deleted:         boolean('deleted').notNull().default(false),
  deletedAt:       timestamp('deleted_at', { withTimezone: true }),
  deletedBy:       text('deleted_by'),
  checkedAt:       timestamp('checked_at', { withTimezone: true }),
  // aiDecision / aiSamePerson / aiReason / aiRelation 等
  aiData:          jsonb('ai_data').$type<Record<string, unknown>>().notNull().default({}),
  // vodProviders[] / vodStatus / vodUpdatedAt 等
  vodData:         jsonb('vod_data').$type<Record<string, unknown>>().notNull().default({}),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.personName, t.id] }),
  index('works_status_idx').on(t.status),
]);

// ── 商品データ（products:{personName}）──────────────────────────────────────
// カテゴリ単位でバッチ取得。items = RakutenItem[]
export const products = pgTable('products', {
  personName: text('person_name').notNull(),
  category:   text('category').notNull(),
  fetchedAt:  timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  items:      jsonb('items').$type<unknown[]>().notNull().default([]),
}, (t) => [
  primaryKey({ columns: [t.personName, t.category] }),
  index('products_person_name_idx').on(t.personName),
]);

// ── バッチ実行メタ（batch:meta）─────────────────────────────────────────────
// シングルトン行 (id=1) として保存
export const batchMeta = pgTable('batch_meta', {
  id:          integer('id').primaryKey().default(1),
  lastRunAt:   timestamp('last_run_at',  { withTimezone: true }).notNull(),
  personCount: integer('person_count').notNull().default(0),
  aiJudged:    integer('ai_judged').notNull().default(0),
  updatedAt:   timestamp('updated_at',   { withTimezone: true }).notNull().defaultNow(),
});

// ── インポート履歴（import:history）──────────────────────────────────────────
export const importHistory = pgTable('import_history', {
  historyId:    text('history_id').primaryKey(),
  importType:   text('import_type').notNull(),
  executedAt:   timestamp('executed_at',  { withTimezone: true }).notNull(),
  fileName:     text('file_name'),
  totalRows:    integer('total_rows').notNull().default(0),
  successCount: integer('success_count').notNull().default(0),
  skipCount:    integer('skip_count').notNull().default(0),
  errorCount:   integer('error_count').notNull().default(0),
  durationMs:   integer('duration_ms').notNull().default(0),
  status:       text('status').notNull(),
  rows:         jsonb('rows').$type<unknown[]>().notNull().default([]),
  csvContent:   text('csv_content'),
  createdAt:    timestamp('created_at',   { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('import_history_executed_at_idx').on(t.executedAt),
]);

// ── OpenAI使用ログ（openai:usage:YYYY-MM-DD）────────────────────────────────
export const openaiUsageLogs = pgTable('openai_usage_logs', {
  id:               serial('id').primaryKey(),
  loggedAt:         timestamp('logged_at',         { withTimezone: true }).notNull(),
  feature:          text('feature').notNull(),
  model:            text('model').notNull(),
  inputTokens:      integer('input_tokens').notNull().default(0),
  outputTokens:     integer('output_tokens').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  durationMs:       integer('duration_ms'),
  personName:       text('person_name'),
  success:          boolean('success').notNull().default(true),
  errorMessage:     text('error_message'),
}, (t) => [
  index('openai_usage_logs_logged_at_idx').on(t.loggedAt),
  index('openai_usage_logs_feature_idx').on(t.feature),
]);

// ── 商品表示順序（product-display-order:{personName}:{category}）──────────
export const productDisplayOrder = pgTable('product_display_order', {
  personName: text('person_name').notNull(),
  category:   text('category').notNull(),
  orderIds:   jsonb('order_ids').$type<string[]>().notNull().default([]),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.personName, t.category] }),
]);

// ── 重点配信確認フラグ（vod:intensive:persons）──────────────────────────────
export const vodIntensivePersons = pgTable('vod_intensive_persons', {
  personName: text('person_name').primaryKey(),
  enabledAt:  timestamp('enabled_at',  { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at',  { withTimezone: true }).notNull().defaultNow(),
});

// ── システム使用量スナップショット ─────────────────────────────────────────────
export const systemUsageSnapshots = pgTable('system_usage_snapshots', {
  id:          serial('id').primaryKey(),
  service:     text('service').notNull(),
  metric:      text('metric').notNull(),
  value:       numeric('value').notNull(),
  unit:        text('unit').notNull(),
  source:      text('source').notNull(),
  isEstimated: boolean('is_estimated').notNull().default(false),
  metadata:    jsonb('metadata').$type<Record<string, unknown>>(),
  recordedAt:  timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sus_service_metric_recorded_idx').on(t.service, t.metric, t.recordedAt),
  index('sus_recorded_at_idx').on(t.recordedAt),
]);

// ── 一括実行ロック（batch_lock）─────────────────────────────────────────────
// product-check-bulk の同時実行を1セッションに制限するための lease テーブル
// expires_at < NOW() または status IN ('completed','failed') なら再取得可能
export const batchLock = pgTable('batch_lock', {
  lockKey:     text('lock_key').primaryKey(),
  ownerId:     text('owner_id').notNull(),
  status:      text('status').notNull().default('running'), // 'running' | 'completed' | 'failed'
  acquiredAt:  timestamp('acquired_at',  { withTimezone: true }).notNull(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
  expiresAt:   timestamp('expires_at',   { withTimezone: true }).notNull(),
});

// ── ステータス変更履歴（work_status_history）──────────────────────────────────
export const workStatusHistory = pgTable('work_status_history', {
  id:             serial('id').primaryKey(),
  personName:     text('person_name').notNull(),
  workId:         text('work_id').notNull(),
  title:          text('title').notNull(),
  workSource:     text('work_source').notNull(),
  previousStatus: text('previous_status').notNull(),
  newStatus:      text('new_status').notNull(),
  changedBy:      text('changed_by').notNull(),
  reason:         text('reason'),
  idempotencyKey: text('idempotency_key'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wsh_person_work_idx').on(t.personName, t.workId),
  index('wsh_idempotency_idx').on(t.idempotencyKey),
  index('wsh_created_at_idx').on(t.createdAt),
]);

// ── 作品重複候補レビュー（work_dedup_reviews）────────────────────────────────
// 管理者が各重複候補グループに対して行った判定結果を永続化する。
// 作品統合・workId 変更・Redis 更新は行わない（レビュー結果の記録のみ）。
export const workDedupReviews = pgTable('work_dedup_reviews', {
  id:                      serial('id').primaryKey(),
  candidateGroupKey:       text('candidate_group_key').notNull().unique(),
  algorithmVersion:        text('algorithm_version').notNull(),
  candidateWorkIds:        jsonb('candidate_work_ids').$type<string[]>().notNull(),
  normalizedTitle:         text('normalized_title').notNull().default(''),
  detectedConfidence:      text('detected_confidence').notNull(),
  reviewStatus:            text('review_status').notNull().default('pending'),
  selectedCanonicalWorkId: text('selected_canonical_work_id'),
  reviewerNote:            text('reviewer_note'),
  reviewedBy:              text('reviewed_by'),
  reviewedAt:              timestamp('reviewed_at', { withTimezone: true }),
  appliedAt:               timestamp('applied_at',                { withTimezone: true }),
  appliedBy:               text('applied_by'),
  appliedCanonicalWorkId:  text('applied_canonical_work_id'),
  applyResult:             jsonb('apply_result').$type<Record<string, unknown>>(),
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wdr_review_status_idx').on(t.reviewStatus),
  index('wdr_algorithm_version_idx').on(t.algorithmVersion),
  index('wdr_updated_at_idx').on(t.updatedAt),
  index('wdr_applied_at_idx').on(t.appliedAt),
]);

// ── AI/手動判定結果（verdicts:{personName}）──────────────────────────────────
export const verdicts = pgTable('verdicts', {
  personName:    text('person_name').notNull(),
  productId:     text('product_id').notNull(),
  verdict:       text('verdict').notNull(),
  score:         numeric('score').notNull().default('0'),
  source:        text('source').notNull(),
  reason:        text('reason'),
  promptVersion: text('prompt_version'),
  judgedAt:      timestamp('judged_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.personName, t.productId] }),
  index('verdicts_person_name_idx').on(t.personName),
]);

// ── 統合済みworkIdエイリアス（work_aliases）───────────────────────────────────
export const workAliases = pgTable('work_aliases', {
  aliasWorkId:     text('alias_work_id').primaryKey(),
  canonicalWorkId: text('canonical_work_id').notNull(),
  mergeGroupKey:   text('merge_group_key'),
  createdBy:       text('created_by'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wa_canonical_work_id_idx').on(t.canonicalWorkId),
]);

// ── 統合実行ログ（work_merge_logs）──────────────────────────────────────────────
export const workMergeLogs = pgTable('work_merge_logs', {
  id:                   serial('id').primaryKey(),
  candidateGroupKey:    text('candidate_group_key').notNull(),
  canonicalWorkId:      text('canonical_work_id').notNull(),
  duplicateWorkIds:     jsonb('duplicate_work_ids').$type<string[]>().notNull(),
  personLinksMoved:     integer('person_links_moved').notNull().default(0),
  personLinksRemoved:   integer('person_links_removed').notNull().default(0),
  vodProvidersMerged:   integer('vod_providers_merged').notNull().default(0),
  aliasesCreated:       integer('aliases_created').notNull().default(0),
  redisClickMoved:      integer('redis_click_moved').notNull().default(0),
  redisKeysDeleted:     integer('redis_keys_deleted').notNull().default(0),
  redisError:           text('redis_error'),
  success:              boolean('success').notNull(),
  errorMessage:         text('error_message'),
  executedBy:           text('executed_by'),
  executedAt:           timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('wml_candidate_group_key_idx').on(t.candidateGroupKey),
  index('wml_executed_at_idx').on(t.executedAt),
]);
