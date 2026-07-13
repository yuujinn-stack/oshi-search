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
