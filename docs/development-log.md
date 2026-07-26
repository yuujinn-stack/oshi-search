# oshi-search 開発ログ

このドキュメントはClaude Codeとの会話で実装した機能の記録です。

---

## Task 1 — 作品ソフトデリート（/admin/work-check）

**目的：** 管理画面から作品を「削除済み」としてマークし、公開ページから非表示にする。完全削除ではなくソフトデリートで復元可能にする。

**変更ファイル：**
- `src/types/work.ts` — `WorkRecord` に `deleted?`, `deletedAt?`, `deletedBy?` フィールド追加
- `src/lib/work-store.ts` — `getPublishedWorks()` に `!w.deleted` フィルタ追加、`softDeleteWork()` / `softDeleteWorks()` 追加
- `src/app/api/admin/work-delete/route.ts` （新規）— `POST { personName, workIds[] }` → ソフトデリート実行
- `src/app/api/admin/works/route.ts` — `?includeDeleted=true` パラメータ対応
- `src/app/admin/work-check/WorkStatusButtons.tsx` — 削除ボタン追加（confirm付き）
- `src/app/admin/work-check/PersonWorks.tsx` — `handleDelete` / `handleBulkDelete` / `liveCounts` 追加

**仕様：**
- ソフトデリート：`deleted: true / deletedAt: timestamp / deletedBy: 'manual'`
- 公開ページ・管理通常リストから除外
- 将来的に「削除済みタブ」から復元可能

---

## Task 2 — VOD配信情報ソフトデリート

**目的：** 作品カードの配信情報（VODプロバイダ）を1件単位で手動削除。ソース（TMDb/CSV/AI）を問わず削除可能。

**変更ファイル：**
- `src/types/vod.ts` — `VodProvider` に `hidden?: boolean` 追加
- `src/lib/work-store.ts` — `hideVodProvider(personName, workId, {providerName, source, type})` 追加
- `src/app/api/admin/vod-provider-delete/route.ts` （新規）— `POST { personName, workId, providerName, source, type }`
- `src/app/admin/work-check/WorkVodActions.tsx` — 全プロバイダに × 削除ボタン追加、`onVodProviderDelete` prop
- `src/app/admin/work-check/WorkCard.tsx` — `onVodProviderDelete` prop のパス
- `src/app/admin/work-check/PersonWorks.tsx` — `handleVodProviderDelete` 追加
- 公開ページ5ファイル — `!p.hidden` フィルタ追加

**識別方法：** `providerName + source + type` の組み合わせで1件を特定（同一サービスが複数ソースに存在するケースに対応）

---

## Task 3 — テーマ全面リデザイン（Trust / Oshi / Dark）

**目的：** 旧3テーマ（Standard / Oshi Pop / Premium）を全面刷新。色違いから個性あるデザインシステムへ。

**新テーマ：**

| テーマ | ベース | アクセント | コンセプト |
|---|---|---|---|
| Trust | `#F8FAFC` (白) | `#2563EB` (青) | 情報サイト・信頼感 |
| Oshi | `#FFFFFF` (白) | `#DB2777` (ピンク) | CTAのみピンク、Hero のみグラデ |
| Dark | `#0A1628` (濃紺) | `#F59E0B` (ゴールド) | プレミアム・夜間 |

**変更ファイル：**
- `src/lib/designTheme.ts` — テーマ名・ラベル・アクセントカラー定義を全書き換え
- `src/app/globals.css` — CSS変数を3テーマ分定義（`--ds-bg`, `--ds-surface`, `--ds-primary`, `--ds-cta`, `--ds-radius` 等）

---

## Task 4 — 本番環境でテーマ切り替えボタンを非表示

**目的：** 一般ユーザーには不要な 🎨 ボタンを本番では非表示にする。`?design=xxx` URLパラメータは引き続き動作。

**変更ファイル：**
- `src/components/site/DesignPreviewToggle.tsx`

**ロジック：**
```ts
const IS_PROD =
  process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ||
  (!process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NODE_ENV === 'production');
const DISABLED =
  process.env.NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW !== 'true' && IS_PROD;
```
- `localhost` / dev / preview → 表示
- Vercel production → 非表示
- `NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW=true` で本番でも強制表示可

---

## Task 5 — グループ別 Hero グラデーション

**目的：** 人物ページ・グループページの Hero 背景をグループのブランドカラーに変更。

**新規ファイル：**
- `src/lib/groupHeroGradient.ts` — `getGroupHeroGradient(groupName?, genre?)` を export

**グループ別カラー：**

| グループ | From | To |
|---|---|---|
| 乃木坂46 | `#7C3AED` | `#A855F7` |
| 櫻坂46 | `#F472B6` | `#FB7185` |
| 日向坂46 | `#38BDF8` | `#60A5FA` |

ジャンル別フォールバック（坂道/芸人/テレビ/アーティスト/俳優）あり。

**変更ファイル：**
- `src/app/person/[slug]/page.tsx`
- `src/app/group/[groupSlug]/page.tsx`

---

## Task 6 — 管理画面共通 PersonCombobox

**目的：** 管理画面全体の「対象人物」セレクトを高機能コンボボックスに置き換え。

**新規ファイル：**
- `src/components/admin/PersonCombobox.tsx`

**機能：**
- テキスト入力でリアルタイム絞り込み
- 検索フィールド：名前・グループ名・ひらがな・カタカナ・期別・formerGroupNames・membershipNote
- スコアベース優先度（完全一致→前方一致→部分一致→グループ→期別→旧グループ→備考）
- 検索なし時：グループ別セクションヘッダー付きで一覧表示（sticky）
- 最近使用した人物（localStorage、最大8件、先頭表示）
- キーボード操作：ArrowUp/Down, Enter, Escape, Tab
- `allowEmpty` / `emptyLabel` props（「全人物」「CSVのpersonId列を使用」等）
- 候補リスト幅：`min-width: max(100%, 360px)` / `max-height: 420px`
- z-index: 9999（重なり防止）

**置き換えた `<select>` ：**

| ファイル | 用途 |
|---|---|
| `AiSupplementSection.tsx` | AI補完対象人物 |
| `WorksImportSection.tsx` | 作品CSVインポート対象人物 |
| `VodImportSection.tsx` | VOD CSVインポート対象人物 |
| `ToolsSection.tsx` | VOD重複整理対象人物 |

---

## Task 7 — ChatGPT プロンプトへのダウンロードCSV指示追加

**目的：** ChatGPTへのCSV調査依頼で「ダウンロード可能なCSVも生成して」を毎回手動追加しなくて済むようにする。

**新規ファイル：**
- `src/lib/chatGptPromptUtil.ts` — `csvDownloadSection(filename: string)` を共通export

**適用した5つのプロンプト生成関数：**

| ファイル | 関数 | CSVファイル名 |
|---|---|---|
| `ChatGptPromptSection.tsx` | `buildWorkSearchPrompt` | `{人物名}_出演作品.csv` |
| `ChatGptPromptSection.tsx` | `buildBatchVodPrompt` | `{人物名}_VOD配信情報.csv` |
| `ToolsSection.tsx` | `buildChatGptPrompt` | `{人物名or全人物}_出演作品調査.csv` |
| `VodResearchModal.tsx` | `buildPrompt` | `{人物名}_VOD配信情報.csv` |
| `MembershipImportClient.tsx` | `buildChatGptPrompt` | `{グループ名}_所属情報.csv` |

**追加された指示文（全プロンプト共通）：**
```
━━━━━━━━━━━━━━━━━━
重要
━━━━━━━━━━━━━━━━━━

回答は必ず以下の順番で出力してください。

① ダウンロード可能なCSVファイルを生成してください。
② 同じ内容をCSVコードブロックでも表示してください。

CSVファイルは必須です。
コードブロックだけで終了しないでください。
CSVファイル名：{filename}

CSVコードブロックとダウンロードCSVの内容を完全に一致させてください。
```

---

## Task 9 — 公開ページ商品カテゴリ分離（写真集・書籍 vs グッズ）

**目的：** `/person/[slug]` で書籍系とグッズ系が同一タブに混在していた問題を解消。管理画面カテゴリに依存せず商品タイトルから最終判定する方式に変更。

**変更ファイル：**
- `src/app/person/[slug]/page.tsx` のみ（取得ロジック・管理画面・カードデザインは無変更）

**仕組み（タイトルファースト振り分け）：**
1. 全管理カテゴリ（写真集・本・雑誌・グッズ・CD・Blu-ray・DVD）の関連商品をグローバルプールに収集
2. CD・Blu-ray・DVD → 管理カテゴリが権威的、タイトル判定なし
3. その他 → `classifyProduct(title, adminCat)` で判定:
   - `BOOK_TITLE_KEYWORDS` に一致 → `写真集・書籍`
   - `GOODS_TITLE_KEYWORDS` に一致 → `グッズ`
   - 未一致 & グッズ管理カテゴリ → `グッズ`
   - 未一致 & 写真集/本・雑誌管理カテゴリ → `写真集・書籍`（デフォルト）
4. 結果を `sectionProductMap` に格納し、各セクションで参照

**BOOK_TITLE_KEYWORDS（主要）：**
写真集, フォトブック, Photobook, PHOTOBOOK, BOOK, BOOKS, 書籍, 単行本, 雑誌, ムック, 乃木撮, 日向撮, 櫻撮, B.L.T., BRODY, EX大衆, anan, UTB, BUBKA, TRIANGLE 他

**GOODS_TITLE_KEYWORDS（主要）：**
アクリルスタンド, アクスタ, 缶バッジ, 生写真, キーホルダー, タオル, Tシャツ, ペンライト, クリアファイル, ステッカー, ぬいぐるみ 他

**絶対に変更しなかったもの：** 楽天API取得・AI判定・管理画面・商品追加/編集/削除・カードデザイン・並び替え・中古判定

---

## Task 8 — 商品並び替え機能（/admin/product-check）

**目的：** 管理画面で商品の表示順を変更し、公開ページに反映する。D&Dで直感的に並び替え。

**新規ファイル：**
- `src/lib/product-order-store.ts` — Redis読み書き（`product-display-order:{personName}:{category}` キー）
- `src/app/api/admin/product-order/route.ts` — GET（全カテゴリ一括取得）/ POST（1カテゴリ保存）

**変更ファイル：**
- `src/app/admin/product-check/PersonProducts.tsx` — 並び替えモードUI追加
- `src/app/person/[slug]/page.tsx` — 表示時に保存済み並び順を適用

**使用ライブラリ：** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**仕様：**
- 管理画面に「☰ 並び替え」ボタン → 並び替えモードに切り替え
- 並び替えモードでは採用済み（related）商品をカテゴリ別に表示
- ☰ ハンドルをドラッグ → カテゴリ内で並び替え（スマホ含む）
- カード本体のクリック・選択は並び替えモードOFF時のみ動作
- ドラッグ終了後に自動保存（`/api/admin/product-order` へ POST）
- 「並び順をリセット」ボタンで各カテゴリを初期化
- 公開ページは `getAllDisplayOrders()` で全カテゴリの順序を取得し `applyDisplayOrder()` で適用
- 保存順に含まれない新商品はデフォルトの `sortProducts()` で末尾に追加

**変更禁止事項（維持確認済み）：**
- 楽天API取得・AI判定・商品追加・編集・削除・中古判定 — 一切変更なし
- 公開ページの商品カードデザイン — 変更なし
- 一括選択（useBulkSelection）— 並び替えモードOFF時は従来通り動作

---

## アーキテクチャメモ

- **フレームワーク：** Next.js App Router（Server / Client Components）
- **DB：** Upstash Redis — `works:{personName}` ハッシュキー → field: `workId` → JSON
- **テーマ：** `data-design="trust|oshi|dark"` を `<html>` に付与、CSS変数で制御
- **デプロイ：** Vercel（`NEXT_PUBLIC_VERCEL_ENV` で環境判定）
- **型チェック：** `npx tsc --noEmit` でエラーなし確認済み

---

## Task: OpenAI利用状況管理画面 (`/admin/openai-usage`)

**目的：** OpenAI APIの利用状況（コスト・トークン数・機能別集計）を可視化する管理画面

### 新規作成ファイル

- `src/lib/openai-pricing.ts` — モデル別料金テーブル（USD/1Mトークン）、`calcCostUsd()` 関数、`USD_TO_JPY=150` 定数、`FEATURE_LABELS` マップ
- `src/lib/openai-usage.ts` — `logOpenAIUsage()` 関数（Redis `openai:usage:YYYY-MM-DD` リストにLPUSH、TTL90日）、`getUsageLogs(from, to)` 関数
- `src/app/api/admin/openai-usage/route.ts` — GET API（期間/機能/モデル/人物フィルター、日別/機能別/モデル別集計、CSV download対応）
- `src/app/admin/openai-usage/page.tsx` — サーバーコンポーネント
- `src/app/admin/openai-usage/OpenAIUsageClient.tsx` — ダッシュボード（サマリーカード6枚、日別棒グラフ、機能別・モデル別テーブル、ログテーブル+ページネーション、CSV DL）

### 変更ファイル

- `src/lib/ai-judge.ts` — `judgeProduct()` に `logOpenAIUsage()` 追加（feature: `product_ai`、成功・失敗とも）
- `src/lib/work-processor.ts` — `judgeWork()` と `supplementWithOpenAI()` それぞれに追加（feature: `work_ai`, `work_supplement`）
- `src/lib/vod-supplement.ts` — `supplementVodWithAI()` に追加（feature: `vod_research`、Responses APIのusage取得）
- `src/app/admin/layout.tsx` — NAV_ITEMSに `OpenAI利用状況` 追加

### 設計上の判断

- ストレージはRedisの日次リスト（`openai:usage:YYYY-MM-DD`）。90日TTL。機能追加時はfeature名を追加するだけで自動集計
- コストはトークン数から推定。`openai-pricing.ts` の `MODEL_PRICING` テーブルを更新するだけで新モデル対応
- 表示はJPY換算（`USD_TO_JPY=150`）。実際の請求はOpenAIダッシュボードで確認を促すフッター表示あり
- `logOpenAIUsage()` は失敗しても握りつぶす設計（メインのAPI呼出に影響させない）
- VOD Responses APIは `usage.input_tokens`/`output_tokens` で取得（chat.completions と異なるフィールド名）

---

## Task 10 — OG画像独立管理・一括取得対象0件バグ修正

**目的：** 「OG画像一括取得」が対象0件になる問題を修正。TMDb画像（posterUrl）とOG画像を独立したフィールドで管理する。

**原因：** `PersonWorks.tsx:handleBulkOgFetch()` が `if (w.posterUrl)` で除外していた。`posterUrl` には TMDb 画像が入っているため、TMDb 画像を持つ全作品が OG 取得対象から外れていた。API 側も `if (work.posterUrl && !force)` で同様に誤判定していた。

**変更ファイル：**

- `src/db/schema.ts` — `works` テーブルに `ogImageUrl`, `ogSourceUrl`, `ogImageFetchedAt`, `ogImageStatus`, `ogImageError` 列を追加
- `drizzle/0001_add_og_image_fields.sql` — マイグレーション SQL（直接実行済み）
- `drizzle/meta/_journal.json` — マイグレーションエントリ追加
- `src/types/work.ts` — `WorkRecord` に OG 画像フィールド 5 件追加
- `src/lib/work-store.ts` — `dbRowToWorkRecord()` で OG フィールドをマッピング
- `src/db/write.ts` — `buildWorkRow()` / `upsertWork()` に OG フィールド追加
- `src/app/api/admin/og-image-fetch/route.ts` — `posterUrl` ではなく `ogImageUrl` に保存するよう全面書き直し。`force` 判定も `ogImageUrl` ベースに変更。取得ステータス（success/failed/skipped）を DB に保存
- `src/app/admin/work-check/PersonWorks.tsx` — `handleBulkOgFetch()` の除外条件を `w.ogImageUrl` に修正。対象0件時の理由メッセージ追加。`filteredWorks`（現在のフィルター条件）を対象に
- `src/app/admin/work-check/WorkCard.tsx` — 表示画像を `ogImageUrl ?? posterUrl` に変更。OG ステータスバッジ追加（OG済/OG失敗/OGスキップ/OG未取得）。OG取得ボタンを `ogImageUrl` 未設定時のみ表示
- `src/components/WorkCard.tsx` — 公開ページの画像表示を `ogImageUrl ?? posterUrl` に変更

**設計上の判断：**

- `posterUrl` は既存の TMDb 画像データを保持。新規 OG 取得は一切 `posterUrl` を変更しない
- 公開ページの画像優先順位: OG画像（ogImageUrl）> TMDb画像（posterUrl）> プレースホルダー
- OG 取得状態は `ogImageStatus`（success/failed/skipped）で独立管理
- `force=false`（通常一括）: `ogImageUrl` 未設定作品のみ対象
- `force=true`（再取得ボタン）: `ogImageUrl` 既存でも上書き
- マイグレーションは `neon` クライアント直接実行（drizzle-kit migrate は WebSocket 接続のためローカル環境でタイムアウト）

---

## Task 11 — VOD CSV 同期モード「通信エラーが発生しました」修正

**目的：** 配信CSV同期モードで保存実行すると "通信エラーが発生しました" になる不具合を修正。

**根本原因：**
- `drizzle-orm/neon-http` は `db.transaction()` を未サポート（呼び出すとランタイム例外）
- 同期モード（`syncMode=true`）時のみ `db.transaction()` が呼ばれていた
- 例外 → Next.js が 500 HTML を返す → クライアントの `res.json()` がパース失敗 → catch ブロックで "通信エラー"

**変更ファイル：**
- `src/db/client.ts` — `neonSql` を named export に追加
- `src/db/write.ts` — `batchUpdateVodData()` を全面書き直し（`db.transaction()` → `neonSql.transaction(chunks[])` Neon HTTP バッチ API）
- `src/app/api/admin/csv-import/route.ts` — `maxDuration = 60` 追加、`batchUpdateVodData()` を try/catch で囲みJSON エラーを返すよう修正

**設計上の判断：**
- `drizzle-orm/neon-http` の `db.transaction()` は呼び出し禁止。トランザクションが必要な場合は常に `neonSql.transaction()` を使う

---

## Task 12 — システム使用量管理画面 `/admin/system-usage`

**目的：** 配信CSV同期モードで保存実行すると "通信エラーが発生しました" になる不具合を修正。

**根本原因：**
- `drizzle-orm/neon-http` は `db.transaction()` を未サポート（呼び出すとランタイム例外）
- 同期モード（`syncMode=true`）時のみ `db.transaction()` が呼ばれていた
- 例外 → Next.js が 500 HTML を返す → クライアントの `res.json()` がパース失敗 → catch ブロックで "通信エラー"

**変更ファイル：**
- `src/db/client.ts` — `neonSql` を named export に追加（`neon()` インスタンスを外部から利用可能にする）
- `src/db/write.ts` — `batchUpdateVodData()` を全面書き直し
  - `db.transaction()` → `neonSql.transaction(chunks[])` に変更（Neon HTTP バッチ API）
  - 500件チャンク単位の CTE UPDATE を `neonSql` タグドテンプレートで構築
  - `wrapInTransaction=true` 時: 全チャンクを `neonSql.transaction()` でアトミック実行
  - `wrapInTransaction=false` 時: チャンクを逐次 await
- `src/app/api/admin/csv-import/route.ts`
  - `export const maxDuration = 60` 追加（Vercel タイムアウト対策）
  - `batchUpdateVodData()` 呼び出しを try/catch で囲み、DB エラー時に JSON `{ error: ... }` を返すよう修正

**設計上の判断：**
- `neon()` の HTTP バッチ API（`neonSql.transaction(queries[])`）は複数クエリをアトミックに実行できる
- `drizzle-orm/neon-http` の `db.transaction()` は呼び出し禁止。トランザクションが必要な場合は常に `neonSql.transaction()` を使う
- クライアントへのエラー通知: 500 HTML ではなく `{ error: string }` JSON を返すことで "通信エラー" を排除

**目的：** インフラ・DB・外部APIの容量・使用量・料金を一元確認できる管理画面を追加。

**新規ファイル：**
- `src/lib/system-usage/types.ts` — 共通型定義（ServiceUsage, ServiceMetric, SnapshotTrend, SystemUsageReport）
- `src/lib/system-usage/neon.ts` — Neon内部SQL統計 + 管理API（NEON_API_KEY任意）
- `src/lib/system-usage/redis-stats.ts` — Redis DBSIZE + INFO + SCAN prefix分析 + Upstash API（任意）
- `src/lib/system-usage/openai.ts` — 既存 openai_usage_logs 集計（getUsageLogs 再利用）
- `src/lib/system-usage/vercel.ts` — Vercel API（VERCEL_ACCESS_TOKEN任意）
- `src/lib/system-usage/external-apis.ts` — TMDb・楽天 静的情報・ライセンス状態
- `src/lib/system-usage/snapshot.ts` — スナップショット保存・読取・トレンド計算・古データ削除
- `src/lib/system-usage/aggregator.ts` — Promise.allSettled 統合 + Redis 30分キャッシュ + レート制限
- `src/app/api/admin/system-usage/route.ts` — GET（キャッシュ）/ POST（強制更新 60秒制限）
- `src/app/admin/system-usage/page.tsx` — サーバーコンポーネント
- `src/app/admin/system-usage/SystemUsageClient.tsx` — タブUI・カード・プログレスバー

**変更ファイル：**
- `src/db/schema.ts` — `systemUsageSnapshots` テーブル追加
- `drizzle/0002_system_usage_snapshots.sql` — マイグレーション SQL（直接実行済み）
- `drizzle/meta/_journal.json` — エントリ追加
- `src/app/admin/layout.tsx` — ナビに「🖥️ システム使用量」追加

**設計上の判断：**
- Redis cache key: `cache:system-usage:v1`（TTL 1800秒）。Redis未設定でも動作
- レート制限: Redis key `cache:system-usage:last-refresh`（TTL 60秒）
- スナップショットの時間帯重複防止: `sus_hourly_dedup_idx` UNIQUE インデックス（date_trunc('hour', ...)）
- 1サービスの取得失敗が全体を止めない: `Promise.allSettled` で個別エラーをハンドル
- TMDb・楽天はコール計測未実装（既存 tmdb.ts / rakuten.ts を変更せず静的情報のみ表示）
- 秘密情報（APIキー等）は一切クライアントへ送出しない

**任意追加環境変数（追加でより詳細な情報を取得）：**
- `NEON_API_KEY` / `NEON_PROJECT_ID` — Neonストレージ上限・コンピュート時間取得
- `UPSTASH_API_KEY` / `UPSTASH_EMAIL` / `UPSTASH_DATABASE_ID` — Upstash帯域・データサイズ取得
- `OPENAI_MONTHLY_BUDGET_JPY` / `USD_JPY_MANUAL_RATE` — OpenAI予算対比表示
- `VERCEL_ACCESS_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — Vercelプロジェクト情報
- `TMDB_LICENSE_TYPE` / `TMDB_CONTRACT_RENEWAL_DATE` — TMDbライセンス状態管理

---

## Task 13 — グループページ（/groups/[groupSlug]）速度調査・改善

**目的：** データ量の多いグループページ（乃木坂46等）の初回表示が遅い問題を調査し、実測で確認できたボトルネックのみ改善する。ブランチ: `perf/group-page-speed`。

**計測方法：** 一時スクリプト（`scripts/tmp-measure-*.ts`、計測後削除）で本番Neon DBに対し実クエリを計測。メンバー数: 乃木坂46=97人、櫻坂46=44人、日向坂46=46人（persons_master.json + published persons のマージ後）。

**確認できた問題と対応：**

1. **「年代別作品」セクションが件数上限なしで全件レンダリング**（`src/app/groups/[groupSlug]/page.tsx`）
   - 乃木坂46の2020年代バケットで1,500件超のCompactWorkLinkを初期HTMLに埋め込んでいた（同ファイル内の他セクション＝配信中作品/映画・ドラマ別/配信サービス別/関連商品は全て件数上限＋「他N件」表示を実装済みだったが、このセクションだけ上限がなかった）
   - `MAX_WORKS_PER_DECADE = 12` を追加し、他セクションと同じ「上限12件 + 他N件」パターンに統一。表示件数バッジ（decade.works.length）は変更なし、全件カウントは維持
   - 対応: HTML生成量の削減（要件6）

2. **`getPublishedWorks()`（`src/lib/work-store.ts`）が全ステータス・全カラムを取得してからJSでフィルタしていた**
   - `status = 'auto_published' AND deleted = false` をSQL側のWHEREに追加（`getPublishedWorksOrThrow` と同じ条件）。出力結果は完全に同一、転送量のみ削減
   - 実測: 乃木坂46で 3.7s→2.9s、櫻坂46で 1.3s→1.1s、日向坂46で 2.1s→1.7s（per-member並列フェッチ全体、DBレイテンシのばらつきあり）
   - search / work / ranking など他の呼び出し元にも同じ恩恵（挙動変更なし）
   - 対応: 必要以上のデータ取得の削減（要件2・3）

3. **`group_meta` テーブルが1リクエスト内で2回フェッチされていた**（`generateMetadata` が `getAllGroupMetas()`、page本体が `getAllGroupMetasOrThrow()` を別々に呼んでいた）
   - `src/lib/group-meta.ts`: 生クエリを `react` の `cache()` でラップした `getAllGroupMetasRaw()` に集約し、`getAllGroupMetas` / `getAllGroupMetasOrThrow` の両方がこれを呼ぶように変更（`published-persons.ts` の既存パターンと同じ設計）
   - cross-requestキャッシュではないため管理画面での更新は次リクエストから即反映（既存の force-dynamic 方針を維持）
   - 対応: 同一データの重複取得の解消（要件1）

4. **`getAllGroupMetasOrThrow()` と `getAllPersonsMerged()` が直列に await されていた**（互いにデータ依存なし）
   - `Promise.all` で並列化。エラーハンドリング（`groupMetaRedisError` フラグ・503バナー表示）は完全に維持
   - 対応: DBアクセスの直列化解消（要件4）

**測定した上で「対応しなかった」項目（意図的）：**
- **per-member の works/products/verdicts フェッチを `inArray` で1クエリにバッチ化する案** — 実測すると productsテーブル（personあたりのJSONB items配列が大きい）で現行の並列per-memberクエリ（Promise.all）より **3〜4倍遅くなった**（乃木坂46: 現行5.2s vs バッチ化19.1s）。Neonのneon-http（HTTPベース）ドライバでは大きい単一レスポンスの転送コストの方が支配的で、リクエスト数削減のメリットを上回ると判断し、既存の並列per-memberパターンを維持
- **`getAllPersonMetas()` の全件スキャン** — 他グループから移籍した「元メンバー」を検出する仕様（`formerGroupNames` による逆引き）が全人物のメタデータを必要とするため、対象メンバーのみへの絞り込みは機能を壊さずには不可能と判断し変更せず
- **ページレベルのキャッシュ（unstable_cache / ISR）の追加** — `src/app/api/admin/people/publish/route.ts` に既存コメント「`/search /group /person` は force-dynamic なので revalidatePath 不要」があり、意図的に即時反映を優先した設計。ページキャッシュを追加すると、works/products/verdicts に触れる9個以上の管理画面API（work-manual, verdict, product-manual, product-delete, ai-judge, batch, verdict-bulk 等）すべてに revalidatePath/revalidateTag の追加が必要になり、抜け漏れがあれば「管理画面での更新が反映されない」という禁止事項に抵触するリスクが高いため見送り

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 650テスト全通過
- `next dev` で `/groups/nogizaka46` `/groups/sakurazaka46` `/groups/hinatazaka46` を実際にリクエストし、RSCペイロードで年代別作品の上限適用（12件+他N件が正しい残数）とタイトル・グループ名の表示を確認。エラーログなし

**インデックス調査：** works/products/verdicts の各テーブルは `personName` が複合主キーの先頭列（または個別インデックス）になっており、`personName` 単体条件のクエリは既にインデックスが効いている。EXPLAINで明確な不足が確認できたインデックスはなし（追加提案なし）

---

## Task 14 — VOD再確認対象を優先順位付きで管理する機能（/admin/vod-recheck）

**目的：** 180日以上未確認・unknownのみ・有効VODなし・アクセス上位などの理由でVOD再確認が必要な作品を、優先度付きの一覧・CSV連携・監査ログ付きで管理できる画面を新設する。ブランチ: `feat/vod-recheck-priority`。

**既存実装の調査結果（重複を避けるため必読）：**
- `/api/admin/vod-recheck`（GET/POST/PATCH）が既に存在し、`src/app/admin/work-check/VodRecheckSection.tsx` と `PersonWorks.tsx` から呼ばれている。GETは全人物をfor-of + await（直列N+1）でループしてから全件返す設計で、ページングなし。**この既存ルートは今回一切変更していない**（後方互換のため）。新機能は別経路（`/api/admin/vod-recheck/candidates` 等）として実装。
- `/api/cron/vod-recheck` が既に180日ルール・`priorityRecheck`フラグ・重点確認人物（`vod_intensive_persons`）による自動AI再確認を実行中。今回の管理画面はこの自動再確認を代替するものではなく、人間が優先順位を見て手動でトリアージ・CSV調査・状態管理するための補完ツールという設計。
- `src/lib/vod-dedup.ts`（Prime Video正規化・追加チャンネル判定・isConfirmedVodAvailability）、`src/lib/provider-store.ts`（`getInactiveProviderSlugs`／dTV・GYAO!・Paravi）は変更せずそのまま再利用。

**新規実装：**
1. `src/lib/vod-recheck.ts` — 理由コード10種の判定（`detectRecheckReasons`）・優先度4段階（critical/high/medium/low）判定（`computeRecheckPriority`）・action/priorityバリデーション。純粋関数のみ・DBアクセスなし。
2. `src/lib/vod-recheck-store.ts` — Neon Postgresへの集約クエリ（`getRecheckCandidates`）。`works`は`(person_name, id)`複合主キーのため`DISTINCT ON (id)`で作品ごとに代表1行を採用し、出演者数は`COUNT(DISTINCT person_name)`で別途集計。WHERE/ORDER BY/LIMIT/OFFSETは全てSQL側（`neonSql`タグ付きテンプレート）で組み立て、全件取得してからのJS絞り込みはしていない。Redis（`work:click:*`）から「アクセス上位」集合を計算する関数も含む（Redis未設定時は空集合で継続）。
3. `src/lib/vod-recheck-list.ts` — store + 理由判定 + 表示ラベル付与を1箇所に集約（APIルートとサーバーページの両方から共用）。
4. `src/app/admin/vod-recheck/page.tsx` + `VodRecheckClient.tsx` — 一覧・フィルタ・ページング・一括操作・CSV連携UI。`AdminLayoutClient.tsx`にナビリンク追加。
5. API routes（新設、既存ルートとは別経路）:
   - `GET /api/admin/vod-recheck/candidates` — ページング一覧
   - `POST /api/admin/vod-recheck/action` — 処理開始/再確認完了/要確認/スキップ/メモ保存（最大50件/リクエスト）
   - `POST /api/admin/vod-recheck/csv-export` — 選択作品をCSV出力（1行1人物、既存csv-export運用と同じ形式）
   - `POST /api/admin/vod-recheck/csv-import` — workId,vodService必須列のCSVを取り込み、`upsertManualCsvVodProviders`で保存（既存VOD CSV仕様どおりmanual_csv保存・commit=false でプレビュー）

**DBマイグレーション（新規テーブル・未適用）：**
- `vod_recheck_logs`（監査ログ、`work_status_history`と同じ追記専用ログパターン）を`src/db/schema.ts`・`drizzle/0006_vod_recheck_logs.sql`・`src/app/api/admin/db-init/route.ts`のCREATE_STATEMENTSに追加。**本番・Previewいずれにも未適用**。反映するには管理者が`/admin/db-init`から実行する必要がある（既存の`work_status_history`追加時と同じ運用）。
- 適用前は監査ログのINSERTのみ失敗し（fire-and-forget、catchでwarnログのみ）、一覧表示・ステータス更新・CSV連携などの主機能はテーブルなしでも動作することをdevサーバーで実際に確認済み。

**優先度スコアリングの設計方針：** 「アクセス上位」の絶対的なクリック数しきい値は推測で決めず、`work:click:*`の実際の分布から相対順位（クリック数>0の作品のうち上位20%、最低20件・最大500件に丸め）で判定。既存コード（ranking.ts）が一貫して絶対閾値ではなく「TOP N」方式を採用していることに合わせた。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 703テスト全通過（既存650 + 新規53）
- `next build` 成功。新規ルート（`/admin/vod-recheck`, `/api/admin/vod-recheck/{candidates,action,csv-export,csv-import}`）が正しく出力に含まれることを確認
- `next dev` + 実ログインで一覧表示・フィルタ（reason/priority/検索/workId検索）・不正な action/priority の400拒否・一括操作の50件上限・CSV出力・CSVインポートのプレビューを実リクエストで確認。既存の `/api/admin/vod-recheck`（旧ルート）・`/admin/work-check`・`/admin/work-dedup`・`/admin/work-import`・トップページ・人物ページ・作品ページ・グループページも200で応答することを確認

---

## Task 14 追記 — Preview確認での指摘修正（作品種別・処理状態フィルタ、CSV出力ボタン、アクセス数の誤認防止）

**背景：** Task 14実装後、Previewでの実機確認で4件の問題が判明。優先度計算・unknown除外・dTV除外・Prime Video正規化（`src/lib/vod-recheck.ts`）は今回一切変更していない（`git diff --stat`で無変更を確認済み）。

1. **「作品種別」「処理状態」フィルタが画面に存在しなかった**
   - `src/lib/vod-recheck-store.ts`: `RecheckListParams`に`workType`・`processStatus`を追加し、SQL側WHERE句（`w.type = ...`／`COALESCE(vod_data->>'vodCheckStatus','not_started') = ...`）で絞り込み（全件取得後のJS絞り込みはしていない）
   - `src/app/api/admin/vod-recheck/candidates/route.ts`: query paramの受け取り・バリデーション（`WORK_TYPE_LABEL`・`RECHECK_STATUS_LABEL`のキー一覧に対する厳格チェック、不正値は400）を追加
   - `VodRecheckClient.tsx`: 作品種別（映画/ドラマ/バラエティ/アニメ）・処理状態（未処理/処理中/要確認/完了/失敗/スキップ）のセレクトを追加

2. **選択0件でもCSV出力ボタンが有効に見えた**
   - 実際には`disabled={selected.size === 0}`で機能的には無効化されていたが、視覚的に判別しにくかった（emerald背景+opacity-40のみ）。選択0件時は`bg-gray-200 text-gray-400 cursor-not-allowed`に切り替え、ボタン名を「選択した作品をCSV出力（N件）」に変更して仕様（選択作品のみ出力）を明示

3. **アクセス数が全件0表示だった件の調査**
   - Redisキー形式（`work:click:{workId}`）は`src/app/api/track/route.ts`の実際の書き込み形式と一致しており、キー不一致のバグではなかった
   - 根本原因：`getClickCountsForWorkIds()`が「Redis未設定・取得失敗」と「本当にクリック0件」を区別せず、どちらも一律`0`として返していた（呼び出し側で判別不能）
   - 修正：`getClickCountsForWorkIds()`の戻り値を`Map<string,number>`から`{ counts: Map, available: boolean }`に変更。`available=false`時はUI側で`clickCount`を`null`にし、「不明」表示＋バナー（「Redisからアクセス数を取得できませんでした」）を表示。`available=true`かつ未登録のworkIdは正真正銘の「0件」として区別して表示
   - ローカル環境（Redis未設定）で実際に`clickCountsAvailable: false`・`clickCount: null`が返り、UIに「不明」とバナーが表示されることを確認済み

4. **サーバー側ページングの前へ/次へ/現在ページ/総ページ数** — 実装済みであることを確認（修正不要）

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 711テスト全通過（既存705 + 新規6: workType/processStatusフィルタ4件、Redis available/失敗時の区別2件）
- `next build` 成功
- `next dev` + 実ログインで新フィルタ・CSV出力ボタンの見た目切り替え・アクセス数「不明」表示とバナーを実リクエストで確認
