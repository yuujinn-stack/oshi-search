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

---

## Task 14 追記2 — CSV取り込みでcanonical workId未解決になる不整合を修正

**背景：** 候補一覧・CSV出力に表示されるworkIdをそのままCSV取り込みへ渡すと「未解決のworkId」エラーになる不整合が発生。

**原因調査：**
- 候補一覧（`getRecheckCandidates`）・CSV出力は `status='auto_published' AND deleted=false` の作品のみを直接クエリしており、この条件下では`work_aliases`（作品重複統合済みの旧workId→canonical workIdマッピング）を参照する必要が本来ない（旧workIdの行は`deleted=true`になるため候補にもCSV出力にも現れない）
- 一方、CSV取り込み（`csv-import/route.ts`）は人間が手入力・コピペするため、統合済みの旧workIdが渡される可能性があるにもかかわらず、`work_aliases`を一切参照せず`status='auto_published' AND deleted=false`の直接一致のみでworkIdを解決していた。これが原因で、旧workId（work_aliases登録済み）を指定すると「未解決」エラーになっていた
- 実データで確認: `work_aliases`に実在する組（`csv-tv-離婚しようよ` → `tmdb-tv-216223`）を使い、修正前は取り込み不可、修正後はcanonical workIdへ正しく解決されることを確認済み
- なお、報告された具体的なworkId文字列（`ai-movie-映画『僕たちの嘘と真実』`）自体はwork_aliasesに登録されておらず、DBの実データと1文字（コーナーブラケット「」/『』の種類）が異なる場合は当然「未解決」になる（これはCSVへの入力誤りであり不具合ではない）。ただし、この報告をきっかけに「候補一覧・CSV出力で見えるworkIdはCSV取り込みでも同じ判定基準で受理されるべき」というアーキテクチャ上のギャップ（旧workId解決の欠落）が判明したため、そちらを修正した

**統一した対象判定ロジック：**
- `src/lib/vod-recheck-store.ts` に2つの関数を新設し、候補一覧・CSV出力・CSVインポートの4箇所すべてがこれらを使うよう統一：
  1. `activeWorkFragment()` — 「有効な公開作品」の唯一の定義（`status='auto_published' AND deleted=false`）。`getRecheckCandidates`の3クエリ・CSV出力・`resolveActiveWorkTargets`のすべてがこの1関数を参照
  2. `resolveActiveWorkTargets(inputWorkIds)` — workId解決の唯一のロジック。①直接一致（既にcanonical）→②直接一致しなければ`work_aliases`でcanonical workIdへ解決を試みる→③canonical側も非活性化されていれば未解決、の3段階。CSV出力・CSVインポート（プレビュー・反映）の両方がこれを呼ぶ
- `src/app/api/admin/vod-recheck/csv-export/route.ts`: 独自クエリを`resolveActiveWorkTargets()`呼び出しに置き換え
- `src/app/api/admin/vod-recheck/csv-import/route.ts`: 独自クエリを`resolveActiveWorkTargets()`呼び出しに置き換え。旧workIdが解決された場合はcanonical workId側に対して`upsertManualCsvVodProviders`を適用し、プレビューに`resolvedFrom`（どの旧workIdから解決されたか）を追加表示

**維持した既存仕様（無変更を確認済み）：**
- unknown除外・dTV除外・Prime Video正規化・優先度計算（`src/lib/vod-recheck.ts`・`src/lib/vod-dedup.ts`・`src/lib/provider-store.ts`）は`git diff --stat`で無変更を確認
- CSVプレビュー（commit=false）はDBを一切変更しない（読み取りのみ）
- CSV反映（commit=true）も`upsertManualCsvVodProviders`のみを呼び出し、公開状態（status/deleted）は変更しない

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 718テスト全通過（既存711 + 新規7: 直接一致・alias解決・非活性化拒否・存在しないworkId拒否・重複ID・空配列の各ケース）
- `next build` 成功
- `next dev` + 実ログインで実際のwork_aliasesエントリ（`csv-tv-離婚しようよ`→`tmdb-tv-216223`）を使ったCSV取り込みプレビューが正しくcanonical workIdへ解決されることを確認。存在しないworkIdは引き続き「未解決」になることも確認。候補一覧・CSV出力（export→import round-trip）も正常動作を確認

---

## Task 14 追記3 — CSV取り込みにファイル選択・ドラッグ＆ドロップを追加

**目的：** 「調査結果CSVの取り込み」欄をテキスト貼り付け専用から、CSVファイル選択・ドラッグ＆ドロップにも対応させ、コピー範囲間違い・文字化け・区切り文字混同等の事故を減らす。

**読み込み方式：** ファイルはサーバーへアップロード保存しない。ブラウザの`FileReader.readAsText(file, 'utf-8')`で内容を読み取り、既存の貼り付け経路と同じ`csvText`状態へ格納したうえで、既存のCSVプレビューAPI（`/api/admin/vod-recheck/csv-import`）へ文字列として送信する。ファイル選択・ドラッグ＆ドロップ・貼り付けのいずれも同一の状態・同一のAPI呼び出しに合流するため、検証結果が経路によって食い違うことはない。

**新規実装：**
1. `src/lib/csv-parse.ts` — `parseCSV()`（RFC4180準拠パーサー）をこの機能専用に独立モジュール化（フレームワーク非依存・クライアント/サーバー両対応）。`MAX_CSV_ROWS=200`・`MAX_CSV_FILE_BYTES=2MB`の共通定数もここに集約
2. `src/lib/csv-file-validation.ts` — ファイル選択の事前チェック（拡張子.csv・空ファイル・サイズ上限）。DOM非依存の純粋関数（`{name, size}`のみを受け取る）でテスト可能にした
3. `src/lib/vod-recheck-csv.ts` — CSV行の解析・検証（必須列・availabilityType検証・**同一workId×vodServiceの重複行検出**を新規追加）を`parseAndValidateImportCsv()`として抽出。ファイル選択・貼り付けの両方がこの1関数を通る
4. `src/lib/work-store.ts` — `upsertManualCsvVodProviders()`の合成ロジックを`mergeManualCsvVodProviders()`として抽出（純粋関数）。実際の保存とプレビューの反映後件数シミュレーションの両方が同じ関数を使うため、プレビューと実際の反映結果がずれない
5. `src/app/api/admin/vod-recheck/csv-import/route.ts` — プレビュー応答を拡張:
   - 作品ごとに入力workId・canonical workId・作品タイトル・追加/更新予定サービス・現在のVOD件数・反映後のVOD件数（`mergeManualCsvVodProviders`でシミュレーション）・警告・エラーを返す
   - `hasFatalErrors`（未解決workId等が1件でもあれば`true`）をトップレベルに追加。UIはこれを見て「反映する」を無効化する
   - ファイルサイズ相当のチェック（`Buffer.byteLength`によるUTF-8バイト数）を追加
6. `src/app/admin/vod-recheck/VodRecheckClient.tsx` — 「CSVファイルを選択」ボタン・ドラッグ＆ドロップ領域・選択ファイル名/サイズ/行数表示・解除ボタンを追加。「反映する」は`hasFatalErrors`時に無効化。二重送信防止のため同期的な`useRef`ロックを追加。反映成功後はファイル・テキスト・プレビューを全てリセット（同じCSVの誤再反映を防止）

**維持した既存仕様（無変更を確認済み）：**
- unknown除外・dTV除外・dTVのLemino自動変換なし・Prime Video正規化・Amazon追加チャンネル区別・優先度計算（`src/lib/vod-recheck.ts`・`src/lib/vod-dedup.ts`・`src/lib/provider-store.ts`）は`git diff --stat`で無変更を確認
- 1作品1サービス1行・manual_csv保存・監査ログ保存・状態変更・管理者認証（`proxy.ts`は無変更）・貼り付け方式・サーバー側ページング・一括操作50件上限・旧workId→canonical解決（`resolveActiveWorkTargets`は無変更）
- プレビュー（commit=false）はDBへの書き込みを一切行わない。同一プレビューを2回実行し`currentVodCount`/`afterVodCount`が変化しないことを実DBで確認済み

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 750テスト全通過（既存718 + 新規32: CSVパーサー6件・ファイル検証7件・行検証14件・マージ関数4件・その他）
- `next build` 成功
- `next dev` + 実ログインで、実際のwork_aliasesエントリを使ったプレビュー（title・currentVodCount・afterVodCount・resolvedFromを含む拡張レスポンス）・重複行の400拒否・未解決workIdでの`hasFatalErrors:true`・同一プレビューの再実行結果が変化しないこと（DB非変更の確認）・ファイル選択UIの表示を確認

---

## Task 14 追記4 — CSV出力に取り込み用5列を最初から追加

**背景：** 調査対象CSVの出力列を変更せず、利用者が手動でvodService等の列を追加する仕様になっていた（要件未完了の指摘）ため修正。

**変更内容：** `POST /api/admin/vod-recheck/csv-export` が出力するCSVの末尾に、取り込み用の5列（`vodService`, `availabilityType`, `confidence`, `sourceUrl`, `note`）を**空欄**で最初から追加。出力ヘッダーは指定どおりの順序：

```
workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices,lastCheckedAt,recheckReason,priority,vodService,availabilityType,confidence,sourceUrl,note
```

利用者はダウンロードしたCSVをNumbers/Excelで開き、空欄の5列に調査結果を記入（同じ作品に複数サービスがあれば行を複製）し、そのCSVファイルをそのまま管理画面の「CSVファイルを選択」から取り込める。

**実装：**
- `src/lib/vod-recheck-csv-export.ts`（新規）— CSVヘッダー・行組み立てを純粋関数として抽出（`VOD_RECHECK_EXPORT_HEADERS`, `buildVodRecheckExportRow`, `buildVodRecheckExportCsv`）。csv-export/route.tsが持っていたインラインのヘッダー配列・csvEscape・行組み立てをこの1モジュールに集約
- `src/app/api/admin/vod-recheck/csv-export/route.ts` — 上記関数を呼ぶだけに簡素化。補助列（workTitle等）は取り込み側（`parseAndValidateImportCsv`）が列名ベースで無視するため、取り込みロジックには変更なし

**維持した既存仕様（無変更を確認済み）：**
- `src/lib/vod-recheck.ts`・`vod-dedup.ts`・`provider-store.ts`・`vod-recheck-store.ts`・`vod-recheck-csv.ts`（取り込み側の検証ロジック）・`work-store.ts`は`git diff --stat`で無変更を確認。workId/vodService必須・availabilityType/confidence/sourceUrl/noteが任意列という取り込み仕様、CSV貼り付け方式、1作品1サービス1行、日本語workIdの不変性は影響を受けない

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 757テスト全通過（既存750 + 新規7: ヘッダー構成・空欄出力・日本語/カンマを含むタイトルでの列崩れなし・出力→記入→取り込みプレビューの往復・行複製による複数サービス取り込み）
- `next build` 成功
- `next dev` + 実ログインで実際の候補（`ai-movie-映画『僕たちの嘘と真実』`）をCSV出力し、5列が空欄で追加されていることを確認。そのCSVへNetflix/flatrate等を記入したものをそのまま取り込みプレビューへ送信し、`afterVodCount`が1→2に増える（新しい有効サービスとして正しく認識される）ことを実DBで確認

---

## Task 14 追記5 — 調査対象CSVアップロードによる配信情報調査候補の自動生成機能

**目的：** これまで「調査対象CSVをダウンロード → Numbers/Excelで開く → vodService等5列を手入力 → 保存 → 再アップロード」という手作業が必須だった。これを廃止し、調査対象CSV（vodService列が空または列自体が無い）をそのままアップロードするだけでAIが各作品の現在の配信状況を自動調査し、反映候補を作成する機能を追加した。調査結果はいかなる場合もDBへ自動保存されず、必ず管理者の明示的な承認・反映操作を経由する。

**既存処理の調査結果（実装前に確認した事項）：**
- AI調査そのものは新規実装ではなく、既存の `supplementVodWithAI`（`src/lib/vod-supplement.ts`、OpenAI Responses API + `web_search_preview`ツール、モデル`gpt-4o`）を再利用。ただしこの関数は内部でエラーを握りつぶし`[]`を返すため、「AIが何も見つけられなかった」と「API呼び出し自体が失敗した」を呼び出し側が区別できない問題があった。既存の全呼び出し元（cron・他の管理画面）の挙動を変えずにジョブ処理側だけリトライ判定できるよう、内部ロジックを`supplementVodWithAIOrThrow`として抽出し、`supplementVodWithAI`は薄いtry/catchラッパーへ変更（既存呼び出し元の戻り値・挙動は完全に不変）
- ジョブ・キュー基盤は既存に無し（`batch_lock`という簡易リースのみ）。サーバーレス実行時間制限を踏まえ、DB永続化されたジョブ/アイテムモデルを管理画面からのポーリングで小バッチ処理する方式を採用（新規ワーカー基盤は導入しない）
- CSV反映ロジック（canonical workId解決・非活性化作品拒否・manual_csv保存・VOD重複排除・unknown除外・Prime Video正規化・監査ログ・状態変更）は完全に既存のものを再利用。これを実現するため`src/app/api/admin/vod-recheck/csv-import/route.ts`の中身を`src/lib/vod-recheck-csv-import.ts`の`runVodRecheckCsvImport(csv, commit, {mergeStrategy})`へ抽出し、既存ルートと自動調査反映ルートの両方がこの同一関数を呼ぶ

**新規DBテーブル（`db-init`へ追加のみ・本番へは未適用）：**
- `vod_investigation_jobs`（id, status, created_by, created_at, updated_at）— ジョブ本体。status: pending/running/paused/completed/applied
- `vod_investigation_job_items`（id, job_id, work_id, person_name, title, work_type, release_year, status, decision, retry_count, candidate_providers(jsonb), current_providers_snapshot(jsonb), manual_providers(jsonb), error_message, investigated_at, decided_at, decided_by, created_at, updated_at）— 作品単位の調査状態・候補・管理者の判断
- 個人情報は保存しない（person_nameは既存の公開用ステージネームのみ）。保持期間はジョブ単位（反映完了後も監査用に残す想定、削除は将来の管理画面操作または既存の一般的なデータ保持ポリシーに委ねる）
- マイグレーションSQL: `drizzle/0007_vod_investigation_jobs.sql`。**本番DBへは未適用**（`/api/admin/db-init`への手動POSTが必要）

**新規実装：**
1. `src/lib/vod-investigation.ts`（純粋関数）— `MAX_INVESTIGATION_ITEMS=50`（既存の一括操作上限と統一）、`INVESTIGATION_BATCH_SIZE=3`、`INVESTIGATION_CONCURRENCY=2`（外部API同時実行数の上限）、`MAX_AUTO_RETRY_COUNT=2`（無限リトライ防止）、`buildInvestigationCandidates()`（終了済みサービス除外・有効サービス0件の時のみunknown候補を1件生成）、`canApproveCandidates()`（sourceUrl/officialUrlの無い実在サービス主張候補は自動承認不可。unknownのみは承認可）、`estimateInvestigationCost()`、`canBulkApply()`（1件でも未確認があれば一括反映不可）、`buildImportCsvFromApprovedItems()`（承認済み候補→既存CSV取り込み形式への橋渡し）
2. `src/lib/vod-investigation-store.ts` — ジョブ/アイテムのDB操作。`prepareInvestigationTargets()`は候補一覧・CSV出力・CSV取り込みと共通の`resolveActiveWorkTargets()`を再利用（旧workId解決・非活性化作品拒否も共通）。`markItemFailed()`はリトライ回数が上限を超えたら`failed`で確定、それ以外は`pending`へ戻し次バッチで再試行。`setItemDecision()`の`needs_review`（要再調査）は単なる表示状態ではなく、statusを`pending`へ戻し・リトライ回数をリセットして次バッチで再調査対象に含める設計
3. `src/lib/vod-investigation-runner.ts` — `processInvestigationBatch(jobId)`。1回の呼び出しでpending中の最大3件をclaimし、同時実行数2で`supplementVodWithAIOrThrow`を呼ぶ。失敗（例外）した項目のみ`markItemFailed`でリトライ制御
4. `src/lib/openai-usage.ts` に `getVodResearchStats()` を追加 — `openai_usage_logs`の`feature='vod_research'`実績（平均費用・成功率・サンプル数）を集計し、費用概算の根拠にする。実績が無い場合は保守的な既定値にフォールバック
5. `src/lib/vod-recheck-csv.ts` — `detectVodRecheckCsvType()`（workId列の有無・vodService列の有無/空欄で「調査対象CSV」「調査結果CSV」「判定不能」を自動判定）、`parseInvestigationTargetCsv()`（調査対象CSVからworkId列のみを抽出）
6. `src/lib/vod-recheck-csv-import.ts`（新規）— 上述の共有反映関数。`mergeStrategy: 'additive'`（既定・既存の手動CSV貼り付け経路と完全に同じ、`mergeManualCsvVodProviders`/`upsertManualCsvVodProviders`）と`'sync'`（自動調査ジョブの反映専用、`syncManualCsvVodProvidersPure`/`syncManualCsvVodProviders`で既存manual_csvエントリを完全置換）の2方式を切り替え可能に
7. `src/lib/work-store.ts` に `syncManualCsvVodProvidersPure()` を追加（既存の未使用コード`syncManualCsvVodProviders`が使っていた完全置換ロジックを純粋関数として抽出。プレビューと実反映で同じロジックを共有するため）
8. APIルート新規追加（すべて`/api/admin/vod-recheck/investigation-jobs`配下）:
   - `POST .../estimate` — 対象件数・推定OpenAI呼び出し回数・推定費用（実績データベース）を返す。**DB書き込みなし**（ジョブは作成しない）
   - `GET/POST .../` — 直近ジョブ一覧の取得／ジョブ作成（50件上限を再検証。作成時点ではAI調査を一切実行しない）
   - `GET/PATCH .../[jobId]` — ジョブ詳細・進行状況取得／`stop`・`resume`・`retry_failed`操作
   - `POST .../[jobId]/process` — バッチ処理（1回で最大3件）。`paused`中・`applied`済みは拒否。pending/investigatingが無くなったら`completed`へ自動遷移
   - `POST .../[jobId]/items/[itemId]/decision` — 承認/却下/要再調査/手動編集。承認は公式URLが無い候補には拒否
   - `POST .../[jobId]/apply-preview`・`POST .../[jobId]/apply` — `canBulkApply()`で全件確定済みを検証後、承認済み候補から合成CSVを組み立て`runVodRecheckCsvImport(csv, commit, {mergeStrategy:'sync'})`を呼ぶ。成功後ジョブを`applied`にして二重反映を防止
9. `src/app/admin/vod-recheck/InvestigationJobPanel.tsx`（新規クライアントコンポーネント）— 見積もり確認画面→自動調査実行（進行状況バー・停止/再開・失敗のみ再試行）→作品ごとの調査結果確認・承認UI（現在のVOD情報・候補・sourceUrlリンク・confidence・note・確認日時を並記、手動編集フォーム）→反映前プレビュー→反映、の一連の画面
10. `src/app/admin/vod-recheck/VodRecheckClient.tsx` — CSVテキスト変更時に`detectVodRecheckCsvType()`で種別を自動判定し、種別に応じた案内文を表示。「調査対象CSV」と判定された場合は既存のプレビュー/反映ボタンの代わりに`InvestigationJobPanel`を表示。「調査結果CSV」の場合は既存のプレビュー/反映フローを完全に維持

**Redisの扱い：** 本機能はRedisを一切使用しない（進行状況・調査結果はすべてNeon Postgresへ永続化）。「Redis障害時にNeonを正としてデータを失わない」という要件は、そもそもRedis依存を作らないことで満たしている。

**維持した既存仕様（無変更を確認済み）：**
- dTV除外・Prime Video正規化・Amazon追加チャンネル区別・unknown除外という公開ページの表示仕様（`vod-dedup.ts`）は無変更。既存のCSV結果取り込み（`mergeStrategy: 'additive'`が既定）は挙動が一切変わらないことをテストで確認
- 管理者の明示的な「承認済みの結果を反映」操作を経ない限りDBは一切変更されない

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 835テスト全通過（既存787 + 新規48: 自動調査候補生成・費用概算・決定値検証・進行状況集計・一括反映ゲート・CSVブリッジ7項目、ジョブ/アイテムDB操作14項目、バッチ処理・同時実行数制限・リトライ制御6項目、mergeStrategy切り替え7項目、ルートレベルの上限拒否・二重反映防止・承認ゲート21項目）
- `next build` 成功（新規APIルートすべて含む）
- 本番DBへのマイグレーション適用は行っていない（`vod_investigation_jobs`・`vod_investigation_job_items`は`db-init`のCREATE_STATEMENTSに追加済みだが、管理者による`/admin/db-init`への手動POSTが必要）
- ブラウザでの実機能確認（実際のCSVアップロード→自動調査→承認→反映の一連の操作）は未実施。次回セッションで`next dev`起動の上、実データでの確認を推奨

**未実装・既知の制約：**
- 手動編集（manual）は1サービスのみの入力フォーム（複数サービスの手動編集はUIから直接は不可。CSV貼り付け経路を使えば複数サービス指定は可能）
- ジョブ一覧からの「途中再開」UIは未接続（バックエンドの`listRecentInvestigationJobs`・`GET /investigation-jobs`は実装済みだが、`VodRecheckClient`側に一覧表示・再開ボタンは未追加）
- ブラウザでの実際の自動調査実行（OpenAI実呼び出し）は未確認

---

## Task 14 追記6 — ChatGPT調査用プロンプト生成を /admin/vod-recheck の選択操作欄へ配置修正

**背景：** 直前の追記でChatGPT調査プロンプトの「全文コピー・すべて選択・テキストファイルで保存」機能を`/admin/work-check`の`ChatGptPromptSection.tsx`に実装したが、実際の運用場所は`/admin/vod-recheck`（選択した作品からの配信再調査プロンプト生成）であり、配置場所を誤っていた。加えて、同じプロンプト生成ロジックを`/admin/vod-recheck`側へコピーして別実装にしないよう、共通関数・共通コンポーネントへ抽出したうえで両方から再利用する構成へ修正した。

**共通化のために新規抽出したモジュール：**
1. `src/lib/vod-research-prompt.ts`（新規・純粋関数）— `ChatGptPromptSection.tsx`にあった`buildBatchVodPrompt`（調査依頼文・条件・対象サービス一覧・availabilityType一覧・出力形式・「作品CSVここから/ここまで」区切り、日本語記号は無変更）を`buildBatchVodResearchPrompt(worksCsv, filenameLabel)`として抽出。CSV行フォーマット（`workId,personName,workTitle,workType,releaseYear,roleName,currentVodServices`の7列・エスケープ）を`VOD_RESEARCH_CSV_HEADER`・`buildVodResearchCsvRow()`・`csvEscape()`として共通化
2. `src/lib/clipboard-utils.ts`（新規）— 直前の追記で`ChatGptPromptSection.tsx`内に実装したクリップボードコピー（`navigator.clipboard.writeText` + 非表示textarea/`document.execCommand('copy')`フォールバック）と`downloadTextFile`（Blob+ダウンロードリンク）を共通関数として抽出
3. `src/components/admin/ChatGptPromptResultPanel.tsx`（新規・共通コンポーネント）— 「調査プロンプトをすべてコピー」「すべて選択」「テキストファイルで保存」ボタン＋成功/失敗メッセージ＋プレビュー用テキストエリア（編集・全選択可・内部スクロール）を1コンポーネントにまとめ、`prompt`/`workCount`/`filename`/`onChangePrompt`をpropsで受け取る。コピー・保存対象は常にprops経由の完成済み文字列（DOMから再構築しない）
4. `src/lib/vod-recheck-export-data.ts`（新規）— `csv-export/route.ts`が持っていた「選択対象からcanonical workId解決・非活性化作品除外・currentVodServices算出（`deduplicateProviders`+`isConfirmedVodAvailability`でunknown・終了済みサービス[dTV含む]を除外）」ロジックを`resolveVodRecheckExportData(items)`として抽出。既存のCSV出力（`csv-export/route.ts`）は挙動を変えずにこの関数を呼ぶだけに簡素化

**新規実装：**
- `src/app/api/admin/vod-recheck/research-prompt/route.ts`（新規）— `{items: [{personName, workId}]}`を受け取り、`resolveVodRecheckExportData()`（既存CSV出力と共通のデータ解決）→`buildVodResearchCsvRow`で行組み立て→`buildBatchVodResearchPrompt`でプロンプト全文を生成し、`{prompt, workCount, unresolvedWorkIds}`を返す。件数上限は既存の選択上限と同じ50件（超過は400）。`workCount`はdistinct workId数
- `src/app/admin/vod-recheck/VodRecheckClient.tsx` — 選択操作欄（処理開始・再確認完了・要確認・今回はスキップ・メモのみ保存・選択した作品をCSV出力の並び）に「ChatGPT調査用プロンプトを生成（N件）」ボタンを追加。選択0件で無効化、1〜50件（既存の`MAX_BULK_ITEMS`）で有効化。生成結果は`ChatGptPromptResultPanel`で表示
- `src/app/admin/work-check/ChatGptPromptSection.tsx` — 上記の共通モジュール・共通コンポーネントを使うようリファクタリング（ローカルにあった重複実装をすべて削除）。表示・挙動は前回追記時点から変更なし

**維持した仕様：**
- 日本語記号（『』・句読点・区切り線「---作品CSVここから/ここまで---」等）は無変更
- canonical workId解決・非活性化作品の除外・work_aliases経由のalias解決は既存の`resolveActiveWorkTargets()`をそのまま再利用（vod-recheckの候補一覧・CSV出力と共通の対象判定ロジック）
- unknown・終了済みサービス（dTV等）は`currentVodServices`から除外（`isConfirmedVodAvailability`+`getInactiveProviderSlugs()`、csv-exportと共通ロジック）
- 既存のCSV出力（`csv-export/route.ts`）の出力内容・ヘッダー・列構成は無変更（`vod-recheck-csv-export.test.ts`が引き続き全通過することを確認）

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 852テスト全通過（既存835 + 新規17: プロンプトテンプレート/行フォーマット9件・データ解決層4件・ルートレベルの上限拒否/作品数集計4件）
- `next build` 成功（新規`/api/admin/vod-recheck/research-prompt`ルートを含む）

---

## Task 14 追記7 — OpenAI API自動調査機能（vod_investigation_jobs）の削除、管理ナビへ「作品重複」追加

**背景：** Task 14 追記5で実装した「調査対象CSVアップロード→AI（OpenAI web_search_preview）による配信情報自動調査ジョブ」機能について、サイト内部でOpenAI APIを使ってVODを自動調査する方式は採用しない方針が確定したため、安全に削除した。ChatGPTへ調査プロンプトを生成して手動で調査を依頼する機能（追記5〜6）は自動調査ではないため維持する。

**削除したファイル：**
- `src/lib/vod-investigation.ts`・`vod-investigation-store.ts`・`vod-investigation-runner.ts`
- `src/app/admin/vod-recheck/InvestigationJobPanel.tsx`
- `src/app/api/admin/vod-recheck/investigation-jobs/` 配下の全ルート（ジョブ作成・費用見積もり・バッチ処理・承認・反映・stop/resume/retry）
- `drizzle/0007_vod_investigation_jobs.sql`（未適用のマイグレーションファイル。本番DBには一度も適用していないため削除のみで足りる。削除用マイグレーションは作成していない）
- 上記に対応するテスト4ファイル

**schema.ts / db-init から除去した未適用テーブル定義：**
- `vodInvestigationJobs`（`vod_investigation_jobs`）・`vodInvestigationJobItems`（`vod_investigation_job_items`）のpgTable定義
- `db-init/route.ts`のCREATE_STATEMENTS・TABLE_NAMESから該当エントリを除去
- **本番DBへは元々一度も適用していない**ため、削除用マイグレーション・DROP TABLE等は一切実行・作成していない

**自動調査専用に追加していた付随コードの整理：**
- `src/lib/vod-supplement.ts` — `supplementVodWithAIOrThrow`（自動調査ジョブのリトライ判定用に追加した、エラーを投げる変種）を削除し、`supplementVodWithAI`を元の単一関数（内部でエラーを握りつぶし`[]`を返す）へ復元。既存のcron・管理画面の呼び出し元の挙動は完全に元通り
- `src/lib/openai-usage.ts` — `getVodResearchStats`（自動調査の費用見積もり専用に追加した集計関数）を削除。`logOpenAIUsage`・`getUsageLogs`（既存の`/admin/openai-usage`が使用）は無変更
- `src/lib/vod-recheck-csv-import.ts` — `mergeStrategy`（'additive'|'sync'）オプションを削除し、自動調査ジョブの反映専用だった'sync'分岐を除去。既存の手動CSV貼り付け・ファイル選択の反映ロジック（'additive'相当）のみのシンプルな関数に戻した
- `src/lib/vod-recheck-csv.ts` — `detectVodRecheckCsvType`・`parseInvestigationTargetCsv`（調査対象CSV/調査結果CSVの自動判定）を削除。`parseAndValidateImportCsv`（既存の必須列検証）のみ残した
- `src/app/admin/vod-recheck/VodRecheckClient.tsx` — CSV種別自動判定・`InvestigationJobPanel`表示切り替えを削除し、CSVプレビュー・反映ボタンを常時表示する元の構成に戻した。ChatGPT調査用プロンプト生成ボタン・パネル（追記5〜6）はそのまま維持

**維持した機能（削除していないことを確認済み）：**
- `/admin/openai-usage`（既存のOpenAI利用状況管理画面）
- `vod_recheck_logs`・`work_status_history`テーブル・関連ロジック
- 既存の商品判定等、VOD自動調査以外のOpenAI機能
- ChatGPT調査用プロンプト生成（`/admin/vod-recheck`のボタン・全文コピー・すべて選択・テキストファイル保存）
- CSVファイル選択・ドラッグ＆ドロップ・貼り付け・プレビュー・反映、canonical workId解決・alias解決・非活性化作品拒否、unknown/dTV除外、Prime Video正規化、Amazon追加チャンネル区別
- 作品重複統合・旧workIdリダイレクト、グループページ速度改善（無関係な既存機能、触れていない）

**管理ナビゲーションへの「作品重複」追加：**
- `src/app/admin/AdminLayoutClient.tsx` — 既に末尾付近にあった`/admin/work-dedup`へのリンク（🔍 作品重複候補）を「作品管理」の直後へ移動・改名（「作品重複」）し、重複リンクを作らずに配置。`usePathname()`による現在位置判定を全ナビ項目へ追加し、`/admin/work-dedup`を含む各管理ページ表示時にアクティブ表示（既存のホバー配色と同じ`bg-slate-700`/`text-white`）されるようにした

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 780テスト全通過（自動調査関連72件を削除した分、852→780）
- `next build` 成功（`/api/admin/vod-recheck/investigation-jobs/*`ルートが出力から消えたことを確認）

---

## Task 15 — 手動設定した作品画像URLが画面に反映されない不具合の修正

**目的：** `/admin/work-check` で作品に画像URLを手動設定しても表示画像が変わらない（例:「古書堂ものがたり」でLeminoのロゴ画像が表示され続ける）不具合を修正する。

**根本原因（調査で判明した2つの独立したバグ）：**
1. **画像の優先順位がページごとにバラバラだった。** `WorkCard.tsx`（公開・管理両方）は`ogImageUrl ?? posterUrl`の順で表示していたが、実際の作品詳細ページ`/work/[workId]/page.tsx`は`posterUrl`しか見ておらず、`ogImageUrl`（OG自動取得画像）を一切参照していなかった。またそもそも「管理者が直接指定した画像URL」という概念自体が存在しなかった
2. **`/api/admin/og-image-fetch`のURL候補順序バグ。** 管理画面の「URL編集」で入力した`sourceUrl`より先に、AI補完由来の`officialUrl`（配信サービスの汎用トップページであることが多い）を試す実装になっており、Leminoの汎用ページのog:image（ロゴ）が管理者の入力より先にヒットして`ogImageUrl`を上書きしてしまっていた

**設計：** 画像優先順位を「1. 手動設定画像URL(manualImageUrl・新規) > 2. TMDb画像(posterUrl) > 3. 自動取得OG画像(ogImageUrl) > 4. プレースホルダー」に統一。VODプロバイダーのロゴ(`logoPath`)は元々メイン画像には使われておらず、配信バッジ専用のまま変更なし。

**新規実装：**
1. `src/lib/work-image.ts`（新規・純粋関数）— `getWorkDisplayImage()`（優先順位の一元計算）・`getWorkDisplayImageSource()`（バッジ表示用）・`isValidImageUrl()`（http/https絶対URLのみ許可）
2. `src/types/work.ts`・`src/db/schema.ts`（`manual_image_url TEXT`列・**未適用**）・`drizzle/0007_add_manual_image_url.sql`（**未適用**）・`db-init/route.ts`のALTER_STATEMENTSに追加（**未適用**）・`src/db/write.ts`・`src/lib/work-store.ts` — `manualImageUrl`フィールドの追加。既存の`posterUrl`同様にトップレベルカラムとして追加（既存カラムを再利用せず、独立カラムにしたのはTMDb画像・自動取得OG画像と明確に区別し優先順位判定を可能にするため）
3. `src/lib/work-store.ts` — `setManualImageUrl(personName, workId, url)`（既存の`withWorkFromDB`同様の「1件読み取り→対象フィールドのみ書き換え→保存」パターンで他フィールドを一切消さない。`url=null`で解除）
4. `src/app/api/admin/work-manual-image/route.ts`（新規）— `PATCH {personName, workId, imageUrl}`。不正なURL形式は400（保存前に弾く）、作品が存在しなければ404、保存失敗時は成功レスポンスを返さない。保存成功時に`revalidatePath('/work/[workId]')`・`revalidatePath('/person/[personName]')`を実行
5. `src/app/admin/work-check/WorkCard.tsx` — 「手動画像」トグル・URL入力・保存・解除ボタンを追加（既存の「URL編集」＝ページ再クロール機能とは別）。手動画像設定時は「手動画像」バッジを表示。保存後は`PersonWorks.tsx`の`loadWorks()`（サーバーへの再フェッチ）で即座に反映（フルページリロード不要）
6. `src/app/api/admin/og-image-fetch/route.ts` — URL候補の優先順位を`sourceUrl → officialUrl`へ変更（根本原因2の修正）

**画像優先順位を統一した箇所：**
- `src/components/WorkCard.tsx`（公開ページの作品カード）
- `src/app/admin/work-check/WorkCard.tsx`（管理画面の作品カード）
- `src/app/work/[workId]/page.tsx`（作品詳細ページ本体・JSON-LD・関連作品グリッド・`generateMetadata`のopenGraph/twitter images）— **従来posterUrlしか見ていなかった箇所を含めすべて`getWorkDisplayImage()`に統一**。`layout.tsx`の`metadataBase`により相対URLも自動的に絶対URLへ解決される

**DBマイグレーションについて：** `manual_image_url`カラムはコード上に定義したのみで、**本番DBへは適用していない**。管理者が`/admin/db-init`を実行するまでは`manualImageUrl`は常に`undefined`として扱われ、優先順位2位（TMDb画像）以下にフォールバックする（エラーにはならない）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 808テスト全通過（既存780 + 新規28: 画像優先順位/URL検証14件・DB保存層3件・APIルート6件・og-image-fetch候補順序1件、他既存回帰テストの通過を確認）
- `next build` 成功（新規`/api/admin/work-manual-image`ルートを含む）
- デバッグ用console.logは追加していない（原因はコード調査で特定できたため）

---

## Task 16 — 手動画像機能の回帰: 既存の外部画像URL（ogImageUrl）が一部表示されなくなる不具合の修正

**目的：** Task 15（手動画像URL機能）反映後、本番`/admin/work-check`で一部の既存作品画像が壊れたアイコンになる回帰が発生。以前は正常表示できていた外部画像（TMDb以外）を巻き込んで壊れないよう、原因を特定して修正する。

**調査結果（根本原因）：** `next/image`は本プロジェクトで一切使用されておらず、過去に画像プロキシ（`/api/image-proxy`等）が存在した形跡もgit全履歴になし（`-S`で該当関数名を検索し0件）。CSPやAPIレスポンスの欠落も無し。実際の原因は次の1点：

- 本番DBを直接調査し、`manual_image_url`が設定されている**全8件**を確認したところ、**全8件がGoogle画像検索の結果ページURL（`https://www.google.com/imgres?q=...`）**だった。これはブラウザで画像検索結果を右クリック→「画像アドレスをコピー」した際、直接の画像URLではなく検索結果ページ自体のURLが誤ってコピーされたもの（`/imgres`はHTMLページを返し、`<img>`には表示できない）
- `manualImageUrl`は表示優先順位1位のため、この不正なURLがあると、以前は正常に表示できていた`ogImageUrl`（TMDb以外の外部画像、tv-tokyo.co.jp・nogizaka46.com・hulu.jp・happyon.jp等はすべてHTTP 200・image/jpegで実在確認済み）を隠してしまっていた
- ユーザー指定の4作品すべて（東京パソコンクラブ／週刊乃木坂ニュース系／乃木坂スター誕生！SIX 6期生の挑戦／矢久保チャンネル ビヨンド 香川編）のうち、`森平麗心`名義の2件（SIX 6期生の挑戦・香川編）がこの`manual_image_url`不正データに該当することを実データで確認
- 副次的に、`poster_url`/`og_image_url`に**HTMLエンティティ`&amp;`が未デコードのまま1,470件**混入していることも発見（CSV取り込み時にHTML属性値をそのまま保存したことが原因と推測。今回検証した範囲では画像サーバー側が寛容で表示自体は失敗しなかったが、サーバーによっては失敗しうるため合わせて修正）

**方針：** 「行わないでください」指定（ogImageUrl一括削除・URL一括NULL化・manualImageUrlへの自動コピー・再取得での上書き・プレースホルダーで一括非表示）を厳守し、**DBへの書き込みは一切行わず**、表示選択ロジックのみで解決した。

**実装：**
- `src/lib/work-image.ts` — 候補選択とレンダリング用URL変換を分離：
  - `getWorkDisplayImage(work)`：優先順位（manualImageUrl > posterUrl > ogImageUrl）で候補を評価する際、`isPlausibleImageUrl()`で「形式は正しいが実際は画像でない」候補（Google `/imgres`・`/search`、Bing `/images/search`）をスキップし、次点へ自動フォールバックする。**DBの値は変更しない。表示時に選ばないだけ**
  - `getRenderableWorkImageUrl(url)`：選択された生URLをブラウザへ渡す直前に、HTMLエンティティ（`&amp;`等）を復元する。候補選択とは独立した関数のため、将来プロキシ等が必要になった場合もこの1関数の内部実装のみ変更すればよい
  - `isPlausibleImageUrl()`を公開し、`getWorkDisplayImageSource()`も同じ判定でバッジ表示（「手動画像」ラベル）が実際に使われているソースと食い違わないよう統一
- `src/app/api/admin/work-manual-image/route.ts` — 保存前のバリデーションに`isPlausibleImageUrl()`チェックを追加。今後同様の検索結果ページURLが誤って保存されることを防止し、保存に失敗した理由（「画像ページのURLで、画像そのものではありません」）を管理者に明示
- 呼び出し側4箇所（`src/components/WorkCard.tsx`・`src/app/admin/work-check/WorkCard.tsx`・`src/app/work/[workId]/page.tsx`のヒーロー画像/generateMetadata/関連作品グリッド）を`getRenderableWorkImageUrl(getWorkDisplayImage(work))`という2段階呼び出しへ統一

**実データでの検証：** 本番DBへ実際に接続し、`getWorkDisplayImage`/`getRenderableWorkImageUrl`をユーザー指定の4作品に対して直接実行し、修正後に選択されるURLがすべて実在の画像（HTTP 200・正しいContent-Type）であることを確認した（DBへの書き込みは一切行っていない・確認のみ）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 822テスト全通過（既存808 + 新規14）
- `next build` 成功
- 本番DBの`manual_image_url`不正データ8件は**削除・変更していない**（今回の修正は表示時のスキップのみで解決するため、対応不要と判断。今後同じURLを保存しようとした場合はAPI側で拒否される）

---

## Task 17 — 人物ページ「出演作品」セクションの検索・絞り込み・並べ替え・カード表示安定化

**目的：** 出演作品が100件以上ある人物でも、(1) 配信中の作品をすぐ見つけられる、(2) 作品名で検索できる、(3) 年代で絞り込める、(4) 配信サービスで絞り込める、(5) カード画像サイズの違いによる見た目のガタつきを減らす、状態にする。既存機能・既存データ・既存URLは変更しない。

**実装前調査：** 人物ページ本体（`src/app/person/[slug]/page.tsx`）・作品一覧コンポーネント（`src/components/WorksSection.tsx`）・作品カード（`src/components/WorkCard.tsx`）・VOD有無判定（`src/lib/vod-dedup.ts`の`isConfirmedVodAvailability`）・画像表示処理（`src/lib/work-image.ts`）を確認。「配信中」判定は`isConfirmedVodAvailability`が唯一の既存ロジックであることを確認し、これを再利用する方針とした（新規の独自判定は作らない）。既存のジャンル（表示カテゴリ）フィルタは`WorksSection.tsx`の`activeType`タブとして既に存在。

**追加：**
- `src/lib/work-filter.ts`（新規・純粋関数）
  - `hasConfirmedStreaming(work)` — `isConfirmedVodAvailability`を再利用し、`vodProviders`に1件でも確定済み配信情報があるか判定。`type==='unknown'`・`providerName`未特定・`hidden`・AI低確度・終了済みサービスはこの関数の内部で判定されるロジックにより「配信あり」に含まれない
  - `getWorkDecadeLabel` / `getAvailableDecades` — 年代ラベル算出・対象作品中に存在する年代のみ新しい順で列挙
  - `getAvailableProviders` — `deduplicateProviders`+`isConfirmedVodAvailability`+`normalizeProviderName`+`getVodProviderDisplayInfo`を再利用し、対象作品中の確定済み配信サービスのみを選択肢として列挙
  - `getWorkImageAspectGroup` — `WorkCard.tsx`の`getPosterLayout`と同一基準（TMDb画像=portrait、それ以外=landscape、画像なし=none）で画像アスペクト比を分類
  - `filterAndSortWorks(works, options)` — 検索・年代・配信サービスを同時にAND条件で絞り込んだ上で、並べ替えモードに応じて並べ替える。デフォルト（`streaming_first`）は「配信あり優先」を最優先条件とし、配信ありグループ・配信なしグループそれぞれの内部でのみ画像アスペクト比が近いカードをまとめる（配信ありの作品が画像を揃えるために配信なしより後ろへ落ちることはない）。「新しい順」「古い順」を選んだ場合は配信優先・画像グルーピングより年の並びを優先する（ユーザーが明示的に選んだ並べ替え意図を尊重するため）
  - `isDefaultWorkFilter` / `DEFAULT_WORK_FILTER` — 「条件をクリア」ボタンの表示判定・リセット先
  - テスト：`src/lib/__tests__/work-filter.test.ts`（23件、unknown/hidden/AI低確度の除外・複合絞り込み・並べ替えモードごとの挙動を検証）

**変更：**
- `src/components/WorksSection.tsx` — 検索入力・年代セレクト・配信サービスセレクト・並べ替えセレクト・「条件をクリア」ボタンを追加（作品数20件以上の人物のみ表示）。既存のジャンルタブ（`activeType`）は維持し、その絞り込み結果に対して新しい検索・年代・配信サービス・並べ替えを重ねて適用する設計とし、既存のカテゴリタブ機能を壊さないようにした。絞り込み結果が0件の場合の案内文を追加
- `src/components/WorkCard.tsx` — 画像コンテナの分岐を、URL文字列を直接見る独自判定（`getPosterLayout(url)`）から`work-filter.ts`の`getWorkImageAspectGroup(work)`（並べ替えで使っているものと同一の判定）に統一。portrait用（`aspect-[2/3]`）・landscape用（`aspect-video`）それぞれ専用のコンテナを固定し、画像は`object-contain`のまま維持（背景色でレターボックス表示）。同じタイプのカード同士は画像領域の高さ・タイトル開始位置が揃う一方、人物の顔・作品ロゴ・タイトル文字が`object-cover`で欠けることはない
  - ※初回実装では「カード高さの均一化」を優先し縦横比を`aspect-[2/3]`＋`object-cover`に統一していたが、横長キービジュアル（ライブ・テレビ番組等）で人物・ロゴが切れるとの指摘を受け、画像タイプごとに専用のアスペクト比を維持する現在の方式に修正した

**変更していないもの（確認済み）：** `workId`／人物データ／VODデータ／DBの`posterUrl`・`ogImageUrl`等の生データ／`getWorkPublicUrl`による作品詳細リンク／`isConfirmedVodAvailability`本体のロジック／「配信中」バッジの判定条件（`streamingProviders`＝flatrate/free/ads）は一切変更していない。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1000テスト全通過（既存977 + 新規23）
- `next build` 成功、ビルドエラー・警告なし

---

## Task 17 追記 — 実ブラウザ（Playwright）での動作確認・画像分類ロジックの追加修正

**背景：** Task 17実装後、コミット前に実際のブラウザ表示を確認したいとの依頼を受け、`npx playwright install chromium`でヘッドレスブラウザを用意し、`dev`サーバー起動状態で本番相当データ（212作品を持つ阿部寛のページ）に対して自動操作による実機確認を行った。

**確認方法：** DB（Neon Postgres）から出演作品数が最多の人物を抽出し、その人物ページを対象にPlaywrightで(1) カードのDOM構造から配信あり/なしの並び順を検証、(2) 画像の`naturalWidth`/`naturalHeight`を実際に読み取り、コンテナのアスペクト分類と実画像の形状が一致しているか検証、(3) 検索・年代・配信サービス・並べ替え・ジャンルタブとの併用・「条件をクリア」を実際にUI操作して結果件数・並び順を検証、(4) PC(1280px)・モバイル(390px)双方でスクリーンショットとレイアウト崩れ（横スクロール発生の有無）を確認した。

**発見した問題と修正：**
1. **画像アスペクト分類の誤判定（重大）** — `WorkCard.tsx`の画像コンテナ分類を`getWorkImageAspectGroup`（TMDb画像か否かのURLベース判定）だけに頼っていたところ、実際に読み込まれた画像の実寸を計測すると、TMDb以外のOG自動取得画像（公式サイト・ニュースサイト等のキービジュアル）のうち**約6割が実際には縦長画像だった**ことが判明（例: `shochiku.co.jp`のポスター画像 1051×1500px 等が横長用16:9枠に配置され、左右に大きな余白ができていた）。
   - 修正：`WorkCard.tsx`に画像読み込み後の実寸測定（`onLoad`）を追加し、実際の`naturalWidth`/`naturalHeight`から縦長/横長を判定し直して、URLベースの判定を上書きするようにした。あわせて、SSRされたHTMLをハイドレートする際に画像の`load`イベントがReactのイベント登録より先に発火し、`onLoad`を取りこぼすケースがあったため、`ref`コールバックでマウント時に`img.complete`を確認するフォールバックも追加した。
   - 検証：修正前は横長判定113件中41件が実際は縦長（誤判定約36%）。修正後、画像読み込みを十分待った状態では誤判定0件（209件中0件）を確認。
   - なお、並べ替え用の`work-filter.ts`の`getWorkImageAspectGroup`（サーバー側の純粋関数、画像を実際に読み込めない）は従来通りURLベースの近似判定のままとした。これは「配信あり優先」グループ内で似た画像タイプを大まかに近くに配置するための補助的な並び順にのみ使われ、実際の見た目（コンテナ形状・レターボックス）は`WorkCard.tsx`側の実測ロジックが最終的に決めるため、多少の近似で実害はないと判断した。
2. **モバイルでの横スクロール発生（対象外・既存問題と確認）** — モバイル表示（390px）でページ全体に横スクロールが発生する事象を検出したが、調査の結果`src/components/Header.tsx`（サイト共通ヘッダーの検索ボックス）が原因で、出演作品セクションを含まないトップページでも同じ横スクロールが再現することを確認した。今回のTask 17の変更（`WorksSection.tsx`・`WorkCard.tsx`・`work-filter.ts`）はこの横スクロールの原因ではなく、絞り込みUI自体（input/select/ボタン）が横スクロールに寄与していないことも要素単位で確認済み。既存の別問題のため、今回は修正せず現状のまま報告のみ行う。

**動作確認結果（実ブラウザ）：**
1. 配信あり作品が先頭（212件中69件の配信あり情報グループが冒頭に連続、配信なし作品が間に混入しないことをDOM順で確認）
2. 配信なし作品はその後に表示
3〜6. 横長画像は横長のまま、縦長画像は縦長のまま表示され、いずれも`object-contain`のため人物・ロゴ・タイトルの大きな欠けなし（実測209件中誤判定0件、レターボックス幅も最悪でも枠の75%は画像で埋まることを確認）
7. 画像タイプ別（portrait/landscape）で配信あり・配信なし各グループ内にまとまっていることを確認
8. カード高さの極端な不揃いは無し（同一行内カード高さの差は最大12px程度、テキスト行数差によるもの）
9. 作品名検索が実際に一致作品のみへ絞り込むことを確認（例:「VIVANT」→4件）
10. 年代フィルターが機能（「2020年代」選択で212件→22件）
11. 配信サービスフィルターが機能（「Apple TV Store」選択で1件）
12. 並べ替え「新しい順」が年で正しく降順になることを確認
13. ジャンルタブ（例:「ドラマ」）と検索を同時適用できることを確認
14. 「条件をクリア」ボタンが絞り込み変更時のみ表示され、押下で検索・年代・配信サービス・並べ替えが初期値に戻ることを確認
15. PC表示：フィルター行が1行に収まり崩れなし
16. モバイル表示：フィルター行が`flex-wrap`で自然に折り返され崩れなし（前述のヘッダー起因の横スクロールを除く）

**動作確認（再実行）：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1000テスト全通過
- `next build` 成功、ビルドエラー・警告なし

---

## Task 18 — モバイル幅(320〜430px)でのページ全体の横スクロールを修正

**目的：** Task 17の実機確認で発見した、モバイル幅でページ全体が横スクロールしてしまう問題を調査・修正する。出演作品の検索・年代・配信先・並べ替え機能（Task 17）は変更しない別コミットとして対応。

**調査：** Playwrightで`document.documentElement.scrollWidth`と`clientWidth`を比較し、DOMツリーを二分探索的に`display:none`で潰しながら原因要素を特定した。

**原因（2箇所、いずれも同じ根本原因）：**
1. `src/components/Header.tsx`の共通ヘッダー内、検索ボックスをラップする`<div className="flex-1 max-w-lg">`と、`SmartSearchInput`内の`<input>`（`flex-1`のみでmin-widthの明示指定なし）。
2. `src/components/site/HeroSearchForm.tsx`が使うトップページのHero検索フォーム（`.hero-search-input { flex: 1; }`、globals.css）。

いずれも、flexアイテムの`<input>`はブラウザのデフォルトで`min-width: auto`（`size`属性由来の内容依存の最小幅、目安20文字分）を持つため、`flex: 1`を指定しても画面幅が足りない場面でその最小幅より縮小できず、結果として親要素・ページ全体が横にはみ出していた（`overflow-x-hidden`で隠すのではなく、この`min-width: auto`が真因）。実際に320px幅のトップページで`scrollWidth`が335px（15px超過）となり、`window.scrollX`をwheelイベントで動かせる＝実際にページ全体が横スワイプできてしまうことも確認した。

**修正：**
- `src/components/Header.tsx` — 検索ボックスのラッパーに`min-w-0`を追加（`flex-1 max-w-lg` → `flex-1 min-w-0 max-w-lg`）
- `src/components/site/SmartSearchInput.tsx` — デフォルトinputクラス（compact/通常両方）に`min-w-0`を追加
- `src/app/globals.css` — `.hero-search-input`に`min-width: 0`を追加

**変更していないもの（確認済み）：** 出演作品の検索・年代フィルター・配信先フィルター・並べ替え（`WorksSection.tsx`・`work-filter.ts`・`WorkCard.tsx`）は一切触れていない。PCヘッダー・Heroフォームの見た目（1280px）はスクリーンショットで変化なしを確認。ロゴ・検索ボタンの固定幅・`whitespace-nowrap`はそのまま維持（アクセシビリティ上のタップ領域確保のため妥当と判断し変更せず）。`overflow-x-hidden`のような症状隠しは使用していない。

**動作確認（Playwright、320/375/390/430/1280pxの5幅×トップページ・検索ページ・人物ページで実施）：**
- 全幅・全ページで`document.documentElement.scrollWidth > clientWidth`が解消（修正前は320px幅のトップページのみ15px超過）
- ヘッダー・Hero検索フォームともに、入力欄・ボタンが画面内に収まることを座標ベースで確認
- スクリーンショットで320〜430px・1280pxいずれもロゴ・検索欄・検索ボタンが自然に折り返し/収まることを目視確認

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1000テスト全通過（Task 17から変更なし）
- `next build` 成功、ビルドエラー・警告なし

---

## Task 19 — VODアフィリエイト広告管理機能

**目的：** 「作品がどのVODで配信されているか」（既存の`works.vod_data`／配信リンク生成）とは完全に分離した「VODアフィリエイト提携」レイヤーを新設し、管理画面から広告素材を追加・変更・停止できるようにする。Hulu / Lemino を皮切りに、今後のVOD追加はコード変更なしで管理画面から行えるようにする。クリック数・表示回数・CTR等の計測機能は作らない（ASP側で確認する方針）。

**実装前調査：** `src/db/schema.ts`（命名規則・id戦略）、`src/app/api/admin/db-init/route.ts`（本番マイグレーション運用が「CREATE TABLE IF NOT EXISTS配列への追記＋手動POST」であること）、`src/lib/provider-store.ts`+`ProviderManager.tsx`+`/admin/providers`（管理CRUDの標準パターン：fetchベースAPI・素朴なバリデーション・2クリック削除確認）、`src/proxy.ts`（`/admin/*`・`/api/admin/*`は自動で認証必須になるため個別ページでの認証実装は不要）、`src/app/work/[workId]/page.tsx`（配信サービスカードの構造・`getVodLink()`フォールバック・`normalizeProviderName()`）、`src/app/vod/[provider]/page.tsx`（ISR revalidate=60・`VOD_PAGE_PROVIDERS`のurlSlug/normalizedSlug対応）、`src/app/person/[slug]/page.tsx`（VOD配信アコーディオン）、`src/app/layout.tsx`・`privacy`・`disclaimer`（既存のアフィリエイト表記）を確認。

**新規DBテーブル（既存テーブルへの変更なし）：**
- `affiliate_programs` — VODサービス×ASP案件（`vodService`は`normalizeProviderName()`が返す正規化スラグと統一。例: hulu, lemino, unext, disneyplus, dmmtv, fod, telasa, abema）
- `affiliate_creatives` — 広告素材本体（`type`: raw_html/direct_url/banner/text/embed、`rawCode`にASP提供HTMLをそのまま保存、`device`: all/desktop/mobile、`priority`、`startsAt`/`endsAt`）
- `affiliate_placements` — 広告素材と掲載箇所（`slotKey`）の中間テーブル。1素材を複数箇所に掲載可能
- migration記録: `drizzle/0009_affiliate_tables.sql`（既存運用と同じく実際の本番適用は`/admin/db-init`から実行）
- `src/app/api/admin/db-init/route.ts`にCREATE_STATEMENTS 3件・TABLE_NAMES 3件を追記

**新規ファイル：**
- `src/db/schema.ts`（追記） — 上記3テーブル定義
- `src/lib/affiliate-constants.ts` — `KNOWN_SLOT_KEYS`（work_provider/vod_hero/vod_mid/vod_bottom/person_vod）。DBに依存しない定数のみを分離（'use client'から安全にimportするため。後述のclient/server境界テストで発覚し対応）
- `src/lib/affiliate-store.ts` — 案件・素材・掲載位置のCRUD、および公開ページ向けの`resolveAffiliateSlot(vodService, slotKey)`（有効案件→有効素材→該当slotKey→期限内→device一致→priority降順で1件解決。例外を投げず失敗時は`{mobile:null,desktop:null}`を返す設計）
- `src/lib/affiliate-revalidate.ts` — `/vod/[urlSlug]`のISRキャッシュを管理画面からの変更時に再検証するヘルパー
- `src/components/site/AffiliateSlot.tsx` — 公開ページ共通の広告表示Server Component。`fallback`未指定なら広告0件時は何も描画せず（VODページ・人物ページ用）、`fallback`指定時は広告0件時にfallback（＝既存VODリンク）をそのまま描画する（作品詳細ページ用）。desktop/mobileで別素材が選ばれる場合のみCSSレスポンシブ切替（`hidden md:block`/`md:hidden`）で出し分け、同一の場合は二重出力しない
- `src/app/api/admin/affiliates/route.ts`（GET一覧集約・POST案件作成）
- `src/app/api/admin/affiliates/[id]/route.ts`（PUT/DELETE 案件）
- `src/app/api/admin/affiliates/[id]/creatives/route.ts`（POST 素材作成）
- `src/app/api/admin/affiliates/creatives/[id]/route.ts`（PUT/DELETE 素材）
- `src/app/api/admin/affiliates/creatives/[id]/placements/route.ts`（POST 掲載位置追加）
- `src/app/api/admin/affiliates/placements/[id]/route.ts`（PUT isActive切替／DELETE 掲載位置削除）
- `src/app/admin/affiliates/page.tsx` + `AffiliateManager.tsx` — 新規管理画面。`/admin/providers`のUIパターン（Tailwindベタ書き・2クリック削除確認・fetchベース保存）を踏襲。案件カード展開→素材追加/編集（type別に入力欄を出し分け・プレビューは`pointer-events:none`+透明オーバーレイでクリック不可）→掲載位置チェックボックス（個別isActiveトグル付き）の3階層UI

**既存ファイルの変更（差し込みのみ・既存ロジック本体は無変更）：**
- `src/app/work/[workId]/page.tsx` — 配信サービスカードの「〇〇で今すぐ見る→」ボタン／フォールバック文言を、`<AffiliateSlot vodService={normalizeProviderName(p.providerName)} slotKey="work_provider" fallback={...(既存JSXそのまま)} />`でラップ。availabilityType判定・配信データ取得ロジックは一切変更していない
- `src/app/vod/[provider]/page.tsx` — `vod_hero`（導入文の直後）・`vod_mid`（人物一覧と作品一覧の間）・`vod_bottom`（作品一覧の後）の3箇所に`<AffiliateSlot vodService={config.normalizedSlug} slotKey="..." />`を追加（fallbackなし＝広告0件なら何も描画されない）。SEO文章・JSON-LD・ページネーション・generateStaticParams等は無変更
- `src/app/person/[slug]/page.tsx` — VOD配信アコーディオンの各プロバイダー展開部分に`<AffiliateSlot vodService={normalizeProviderName(providerName)} slotKey="person_vod" />`を追加（fallbackなし）。出演作品・商品・SEOセクションは無変更
- `src/app/admin/AdminLayoutClient.tsx` — `NAV_ITEMS`に「💰 アフィリエイト」を追加（既存テストが「VOD再確認は配信サービスの直後」を検証していたため、アフィリエイトはVOD再確認の直後に配置し既存順序を壊さないようにした）
- `src/app/layout.tsx` — フッター表記を「本サイトはアフィリエイト広告（楽天市場・楽天ブックス）を掲載しています。」→「本サイトはアフィリエイト広告を利用しています。」に変更（VOD広告にも対応する汎用表現）
- `src/app/privacy/page.tsx` / `src/app/disclaimer/page.tsx` — 「アフィリエイト広告について」セクションに、提携VODサービスの広告掲載がありうる旨を追記

**PR表記：** `AffiliateSlot`内の`AdWrapper`が広告表示時のみ小さく「PR」ラベルを付与（ASP広告コード自体は改変しない。外側に表示）。広告が無い場合（fallback表示時含む）はPRラベルは出さない。

**優先度・期限・device判定：** `resolveAffiliateSlot()`内で、有効な案件→有効な素材→該当slotKeyの掲載→`startsAt`/`endsAt`が現在時刻を含む→`device`が'all'または対象端末、の順にフィルタし、残った候補を`priority`降順（同点は`createdAt`昇順で安定）にソートして1件選択。desktop/mobileは別々に解決し、同じ素材が選ばれた場合のみ1回だけレンダリングする（User-Agent判定は`/vod/[provider]`のISRを壊すため使わない設計判断）。

**フォールバック設計：** `resolveAffiliateSlot()`はtry/catchで全DB例外を吸収し、失敗時は空の解決結果を返す（本体ページを500にしない）。`AffiliateSlot`は広告0件時、`fallback` propが渡されていればそれを描画し（作品詳細の既存リンクはこの経路で常に維持される）、無ければ何も描画しない（VODページ・人物ページの新規枠は広告が無ければ余白ゼロ）。

**client/server境界の注意点（実装中に発見）：** 当初`KNOWN_SLOT_KEYS`を`affiliate-store.ts`（DB接続あり）に置いていたところ、'use client'の`AffiliateManager.tsx`がそれを値importしたことで、既存の`client-server-boundary.test.ts`（'use client'ファイルが`src/db/client.ts`等に到達しないことを検証する回帰テスト）が失敗した。DBに依存しない`affiliate-constants.ts`へ`KNOWN_SLOT_KEYS`を分離し、`affiliate-store.ts`側は re-export のみにすることで解消。同様の理由で、`AffiliateManager.tsx`が使う型は全て`import type`にしている。

**動作確認：**
- affiliate関連3テーブルが空の状態で`npx vitest run`（既存1400テスト）・`npx tsc --noEmit`・`next build`をすべて実行し、既存ページ（work/vod/person等）に影響がないことを確認
- `next build`で`/admin/affiliates`・`/api/admin/affiliates/*`が正しくルーティングされることを確認
- `/vod/[provider]`が本変更前後どちらでも`ƒ`(Dynamic)表示になることを確認済み（AffiliateSlot追加前の状態に一時的に戻して再ビルドし比較。既存コードの挙動であり今回の変更による退行ではない）
- 実データでのHulu/Lemino広告登録・表示確認はASP広告コード入力後に別途実施が必要（今回は架空データを本番へ投入していない）

**未実施（意図的）：** クリック数・表示回数・CTR計測、affiliate_stats、独自リダイレクトURL、A/Bテスト、ASP API連携は要件通り実装していない。Hulu/Leminoの実際のASP広告コードは登録していない（管理画面から後日入力する運用）。

---

## Task 19 追記 — vodService表記ゆれによるフォールバック不具合の修正

**背景：** 本番で `/admin/affiliates` からHulu案件（`vodService: "Hulu"`）・広告素材・`work_provider` placementを登録・有効化したが、作品詳細ページには広告ではなく従来の「Huluで今すぐ見る→」が表示され続けた。

**原因調査（読み取り専用の一時スクリプトで本番DBを確認、調査後に削除）：** 案件・素材・placementはすべて正常に保存・有効化されていた（`isActive: true`・`startsAt/endsAt: null`・`device: "all"`）。唯一の不一致は `affiliate_programs.vod_service` が `"Hulu"`（管理画面の自由入力欄にそのまま保存）である一方、`src/app/work/[workId]/page.tsx` は `normalizeProviderName(p.providerName)` の戻り値 `"hulu"` を`AffiliateSlot`へ渡しており、`resolveAffiliateSlot()`内の`eq(vodService, ...)`がPostgresの大文字小文字を区別する比較のため一致せず、案件0件→常にfallback、という経路だった。

**修正（`src/app/api/admin/affiliates/route.ts`のPOST・`src/app/api/admin/affiliates/[id]/route.ts`のPUT）：** `vodService`をDBへ保存する直前に、公開ページ側と同じ`normalizeProviderName()`（`src/lib/vod-dedup.ts`、既存関数を再利用・新規関数は作らない）を適用するよう変更。「Hulu」→「hulu」、「Lemino」→「lemino」、「U-NEXT」→「unext」のように今後は自動的に正規化スラグで保存される。`resolveAffiliateSlot()`・`AffiliateSlot`・DBスキーマ・migrationは無変更。既存のHulu案件データ自体は自動更新せず、管理画面から手動で`Hulu`→`hulu`に修正する運用とした。

**追加テスト：** `src/lib/__tests__/affiliate-programs-route.test.ts`（新規7件）— POST/PUTで"Hulu"→"hulu"、"Lemino"→"lemino"、"U-NEXT"→"unext"に正規化されること、前後空白のtrim+正規化の順序、vodService未指定時は既存値を維持すること、空文字は400になることを検証。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1407テスト全通過（既存1400 + 新規7）
- `next build` 成功

---

## Task 20 — VOD自動更新・人物自動処理の無駄削減（OpenAI Web Search削減）

**目的：** 前回調査（Task内で口頭調査、ログ未記載）で判明した「vod-refreshとvod-recheckが配信情報0件の作品を短時間で二重にAI Web検索しうる」「vod-recheckが毎日全カタログの一部を巡回しコストが積み上がる」「vodCheckStatus='checking'のまま永久停止する作品がある」「person-fetch Cronが人物登録のたびにOpenAI費用を自動発生させる」という4つの無駄を、既存の配信情報鮮度・管理画面の手動操作を壊さずに削減する。

**変更ファイル：**
- `vercel.json` — `person-fetch`のCronエントリを削除。`vod-recheck`のスケジュールを`0 5 * * *`（毎日）→`0 5 1 * *`（毎月1日）に変更。`refresh`/`vod-refresh`は無変更（毎日のまま）。
- `src/lib/vod-check-throttle.ts`（新規）— vod-refresh/vod-recheckが共有するクールダウン判定。既存の`WorkRecord.nextVodCheckAt`（`work-processor.ts`が既に使う30日スロットリングと同じフィールド）を再利用し、新規DBカラムは追加していない。`isVodCheckThrottled()`・`computeNextVodCheckAt()`（30日固定、`work-processor.ts`と統一）・`isStuckChecking()`（`vodCheckStatus='checking'`が2時間以上更新されていなければ放棄されたとみなす）を提供。
- `src/app/api/cron/vod-refresh/route.ts` — AI補完実行前に`isVodCheckThrottled(work)`を追加条件にし、vod-recheckが直近チェック済みの作品を再検索しないようにした。AI実行後は`computeNextVodCheckAt()`で`nextVodCheckAt`を設定。`maxDuration=300`を追加（timeout対策）。TMDb 7日基準・AI 30日基準（`AI_STALE_DAYS`）はいずれも無変更。
- `src/app/api/cron/vod-recheck/route.ts` — 「配信情報0件（noVod）なら180日基準を無条件にバイパスする」ロジックを修正し、`isVodCheckThrottled()`がfalseの場合のみ対象にするよう変更（`RECHECK_STALE_DAYS=180`自体は無変更、短縮していない）。`runRecheck()`のAI再確認後にも`computeNextVodCheckAt()`で`nextVodCheckAt`を設定し、vod-refresh側と同じクールダウンを共有。`collectConditionTargets`/`collectIntensiveTargets`双方で`isStuckChecking()`による「checking固着からの自己修復」を追加。`maxDuration=300`を追加。ヘッダーコメントを月次実行に更新。
- `src/app/api/cron/person-fetch/route.ts` — ルート自体は削除せず（`CRON_SECRET`認証つきのまま残置）、Cronから外れて自動実行されなくなった経緯をコメントで明記。処理本体（`processQueuedPersonJobs`）は変更していない。
- `src/lib/__tests__/vod-check-throttle.test.ts`（新規）— 10件、上記3関数の境界値を検証。
- `scripts/reset-stuck-vod-checking.ts`（新規・恒久スクリプトとして残置）— `vodCheckStatus='checking'`のまま`STUCK_CHECKING_MS`（2時間）以上放置された作品を、既存の`updateWorkVodCheckStatus()`のみを使って`needs_recheck`へ戻す。生SQLの一括UPDATEは行わない。実行済み：本番DBで34件を検出・復旧（`npx dotenv -e .env.local -- npx tsx scripts/reset-stuck-vod-checking.ts`）。

**調査で判明していた事実（今回のコード修正の根拠）：**
- `openai_usage_logs`の`feature='vod_research'`（gpt-4o使用）が全OpenAI費用の約78%を占めていた。
- vod-recheckの`noVod`分岐は`isStale`（180日）判定を素通りし、`vodAiCheckedAt`の新旧に関わらず毎回対象になっていた。vod-refreshは独自に30日クールダウンを持つが、vod-recheckはそれを参照しておらず、4:00 UTC(vod-refresh)→5:00 UTC(vod-recheck)の1時間差で同一作品が二重にAI Web検索されうる状態だった。
- `WorkRecord.nextVodCheckAt`は`work-processor.ts`・`/api/admin/vod-fetch`では既に使われているスロットリング機構だが、vod-refresh/vod-recheckのどちらからも参照・設定されていなかった。
- `vodCheckStatus='checking'`のまま止まっている作品は、選定条件`vodCheckStatus !== 'checking'`により永久に再確認対象から除外される。原因はいずれのCronルートにも`maxDuration`が未設定で、Vercel Function timeoutで`runRecheck()`が完走しない場合に発生していたと推定される。

**実行頻度の変更：**

| Cron | 変更前 | 変更後 |
|---|---|---|
| refresh | 毎日 3:00 UTC | 変更なし |
| vod-refresh | 毎日 4:00 UTC | 変更なし |
| vod-recheck | 毎日 5:00 UTC | **3日に1回 5:00 UTC**（`0 5 */3 * *`、日本時間 同日14:00頃。月10回程度） |
| person-fetch | 毎日 9:00 UTC | Cron削除。`/api/admin/person-jobs/process-now`（既存の管理画面「処理開始」ボタン）から手動実行のみ |

**確認した既存の手動経路（維持されていることを確認済み）：** `/api/admin/people/import`（人物登録・キュー追加のみ、自動処理なし）、`/api/admin/person-jobs/process-now`（管理画面の「処理開始」ボタン）、`/api/admin/people/fetch`（「データ取得」ボタン、単体人物の即時処理）、`/api/admin/ai-judge`・`/api/admin/vod-fetch`・`/api/admin/vod-recheck`・`/api/admin/vod-person-recheck`（各種手動AI判定・VOD調査ボタン）はすべて無変更。`refresh`Cron（`processAllPersons`）は`getAllPersonsMerged()`＝公開済み人物のみを対象としており、新規登録・未処理人物には影響しないことを確認済み。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過（既存1407 + 新規10）
- `next build` 成功、`/api/cron/*`4ルートとも正常にビルドされることを確認

---

## Task 20 追記 — vod-recheckの月次→3日毎への調整・優先順位のlastAiCheck昇順ソート追加

**背景：** Task 20実装後、実際の本番DBを調査した結果、以下が判明した。
1. `openai_usage_logs`の`duration_ms`実測から、`supplementVodWithAI()`1回あたり平均7.19秒（中央値5.64秒、P99 20.2秒、最大48.6秒）かかることが判明。vod-recheckは完全な直列処理（`for`ループ内`await`、並列化なし）のため、`VOD_RECHECK_LIMIT=300`を月1回のまま実行すると約36分かかり、`maxDuration=300`（5分）を大幅に超過してVercel Functionがタイムアウトすることが判明した。
2. 180日以上未確認グループ（5,477件）が単一の優先度（priority=10）にまとめられ、グループ内の並び順が`Array.sort()`の安定ソートによる実質固定順（人物・作品の取得順）になっており、「長期間未確認の作品を優先」という意図を満たしていなかった。
3. OpenAI公式のWeb Search Preview課金（$25/1,000 call）が、社内の`openai_usage_logs`（`calcCostUsd()`）には一切含まれておらず、トークン費用のみを計測していたことが判明（`product_ai`/`work_ai`は`chat.completions.create()`のみでtool未使用のため影響なし。影響は`vod_research`のみ）。

**対応：** 「月1回」という要件は、同一作品を短期間に繰り返し検索しないというクールダウン設計（`nextVodCheckAt`等、Task 20本編で実装済み）で維持しつつ、バックログ5,000件超を安全に分割処理するため、実行頻度とロジックを以下のように調整した。

- `vercel.json` — vod-recheckのスケジュールを`0 5 1 * *`（毎月1日）→`0 5 */3 * *`（3日に1回、月10回程度）に変更。
- `src/app/api/cron/vod-recheck/route.ts` — `DEFAULT_RECHECK_LIMIT`を20→**30**に変更（3日毎×30件≒月間約300件）。`RecheckTarget`に`lastAiCheck`（`Math.max(lastVodCheckAt, vodAiCheckedAt)`）フィールドを追加し、`regularTargets.sort()`を「priority降順→同priority内はlastAiCheck昇順（最後に確認された日時が古い作品から）」の2キーソートに変更。180日基準（`RECHECK_STALE_DAYS`）・クールダウン機構（`isVodCheckThrottled`/`nextVodCheckAt`）・vod-refreshとの重複防止ロジックはいずれも無変更。
- ヘッダーコメントを新しいスケジュール・優先順位に合わせて更新。

**検証（本番DB、読み取り専用スクリプトで確認・調査後削除済み）：** 新しい選定ロジックを実際のデータで再現し、上位30件が「noVod（配信情報未取得、24件）→180日超過（lastAiCheck古い順）」の順に正しく並ぶことを確認した。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過（既存テストから変更なし。新しいソートロジックは既存の`vod-check-throttle.test.ts`が検証する`isVodCheckThrottled`/`computeNextVodCheckAt`/`isStuckChecking`をそのまま利用しているため追加テストは不要と判断）

---

## Task 21 — VOD CTAボタンの配信サービス別デザイン化（availabilityType色分けの廃止）

**目的：** 人物詳細ページ・作品詳細ページのVOD CTAボタンが、これまでavailabilityType（見放題/無料/レンタル/購入）で色分け（緑/黄/橙/青）されており、どのサービスへ遷移するボタンなのか一目で分からなかった。これを配信サービスのブランドカラー・ロゴに基づく配色に変更し、クリック時に「どこへ飛ぶか」を一瞬で認識できるようにした。DB・API・アフィリエイトリンクロジック・作品選定ロジック・ページ構造は変更していない（見た目のみの変更）。

**変更したファイル：**
- `src/lib/vod-cta.ts` — `VOD_TYPE_CONFIG`からCTA配色用フィールド（`icon`/`btn`）を削除し、常にニュートラルなグレー系（`border-gray-200`/`bg-gray-50`/`text-gray-600`）のみを持つ、availabilityTypeの補助チップ専用の設定に変更。新たに`VOD_SERVICE_STYLE`（`normalizeProviderName()`のスラグ→background/color等）と`getVodServiceStyle()`を追加し、CTA本体の配色を配信サービス単位で決定するようにした。
- `src/app/globals.css` — `.affiliate-slot--work-provider a`（AffiliateSlot経由の実ASP広告向け）に配信サービスごとの配色を`[data-vod-service="xxx"]`属性セレクタで追加（`VOD_SERVICE_STYLE`と値を同期）。新規`.vod-cta-btn`共通クラスで、JS側フォールバックCTA・実ASP広告CTA双方に共通のhover（`filter: brightness(0.92)`）・focus-visibleアウトライン・box-shadowを統一。YouTube（ホバー時のみ薄い赤背景）・ABEMA（黄色アクセントドット）・YouTube（赤い再生アイコン）は個別に上書き。
- `src/components/site/AffiliateSlot.tsx` — `AdWrapper`/`renderBranch`に`vodService`を渡すよう変更し、`work_provider`スロットのラッパーdivに`data-vod-service`属性を追加（ASP提供コード自体は無変更）。
- `src/components/site/VodTrackLink.tsx` — `style`プロパティを追加（サービス別配色をinline styleで渡すため）。
- `src/components/site/StreamingNowSection.tsx` / `src/app/work/[workId]/page.tsx` — フォールバックCTAのclassNameから`cfg.btn`（色分け）を除去し、`getVodServiceStyle()`のinline styleを適用。availabilityTypeチップから色付き絵文字（🟢🟡🟠🔵）を削除しラベルのみ表示。StreamingNowSectionのCTAには`ProviderLogo`をインラインで追加（作品詳細ページ側はカードヘッダーに既存の大きいロゴがあるため追加せず）。

**配色一覧（`VOD_SERVICE_STYLE`）：** Hulu=`#22C55E`/濃緑文字、U-NEXT=`#0D0D0D`/白、Lemino=`linear-gradient(#BE185D→#C2410C)`/白、Netflix=`#111111`/白、Prime Video=`#0B2545`/白、DMM TV=`#FFDD00`/黒、TELASA=`#C2410C`/白、FOD=`#E4002B`/白、ABEMA=`#0B0B0B`/白+黄色アクセントドット、TVer=`linear-gradient(#7DD3FC→#2563EB→#1E3A8A)`/白、Disney+=`linear-gradient(#0B1F3A→#0E6B7A)`/白、YouTube=白/黒文字+薄灰枠+赤三角アクセント（ホバー時のみ薄赤背景`#FEF2F2`）、NHKオンデマンド=`#C2540A`/白、未対応サービス=`#374151`（グレー）/白。いずれもWCAG AA相当（4.5:1以上）のコントラスト比を確認済み。

**設計上の判断：**
- TVer・Lemino・Disney+はグラデーション端の一部が単色では白文字コントラスト不足になるため、ブランドイメージを保ちつつ端の色調を少し暗め・中央を安全な濃さに寄せて調整した（例: TVerは3色ストップで左端のみ薄い水色を残し、中心〜右は青系に寄せている）。
- ASP提供の生HTML広告（`dangerouslySetInnerHTML`）内の`<a>`はReactのinline styleを直接付与できないため、CSS属性セレクタ（`!important`付き）で配色を上書きする方式を採用（Hulu用に既にあった仕組みを全サービスに拡張）。
- 構造（高さ・padding・角丸・フォント・hover/focus/shadow）はTailwindユーティリティの上書き順序（`@tailwind utilities`より後にカスタムCSSが来ると同一詳細度のクラスが常に勝ってしまう）を考慮し、`.vod-cta-btn`は配色以外の共通挙動のみを持たせ、width/padding/font-size等は既存どおり各呼び出し側のTailwindクラスに委ねている。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過（既存テストから変更なし）
- `next build` 成功
- Playwright（目黒蓮ページ）で375/390/430/1280pxを確認。横スクロール・コンソールエラーなし。Netflix+U-NEXT+FOD+TVer+Hulu+DMM TV+Disney+等が同一ページに共存する状態でも、色数を絞った落ち着いた印象になっていることを目視確認。作品詳細ページ（DMM TV/FOD収録作品）でも配色・構造の統一を確認。ABEMA/YouTube/Leminoは対象人物のデータに存在しなかったため、同一CSSを使った検証用マークアップで個別に見た目を確認した。

---

## Task 21 追記 — フィードバックに基づく4点の微調整・CTA内ロゴ追加

**背景：** Task 21実装後のレビューで、次の微調整依頼を受けた。
1. ABEMAの黄色アクセントドットが不要（黒＋白の印象で十分）。
2. Huluの`#22C55E`は一般的なTailwind greenに見えるため、既存アセット（ProviderLogo経由で実際に表示されているHuluロゴ画像）の実際の色に近づける。
3. TELASAの`#C2410C`はやや茶色寄りなので、既存ロゴの鮮やかなオレンジに近づける（白文字コントラストが必要なら明度のみ調整）。
4. Prime Videoの単色`#0B2545`を、Disney+・TVerと区別できる濃紺→ブルーのグラデーションに変更。
5. （追加要望）VOD CTAにサービスロゴが表示されていない箇所には、既存アセットのみを使って左側に小さくロゴを追加する。

**対応：**
- 新しい画像・ブランドアセットは一切取得せず、既にサイト上でProviderLogoが表示しているHulu・TELASAの実画像をPlaywrightのcanvasでピクセルサンプリングし、実際に使われている色を抽出した。Hulu＝`rgb(64,224,48)`＝`#40E030`（画像の85%を占める支配色）、TELASA＝`rgb(240,88,8)`＝`#F05808`をそれぞれ採用。TELASAは白文字とのコントラストが不足する（推定コントラスト比約3.4:1）ため、色相・彩度を保ったまま明度を約80%に落とした`#C04606`（コントラスト比約5.1:1）を最終値とした。Huluは新しい色でも明度が高くコントラスト比が向上（濃緑文字との比で約8.4:1）したため文字色`#052e16`は変更していない。
- `src/lib/vod-cta.ts`の`VOD_SERVICE_STYLE`：`hulu.background`を`#40E030`、`telasa.background`を`#C04606`に変更。`primevideo`/`amazonprimevideo`を単色から`linear-gradient(90deg, #0B2545 0%, #14508C 100%)`（濃紺→ブルー、ティールを含まず色相を青のみに絞ることでDisney+・TVerと区別）に変更。`abema`/`abemat`から`accentColor`フィールドを削除。
- `src/app/globals.css`：`.affiliate-slot--work-provider[data-vod-service="hulu"|"telasa"|"primevideo"|"amazonprimevideo"]`の背景値を上記に同期。ABEMAの黄色アクセントドット用CSS（`.vod-cta-btn--abema::before`等）を削除。YouTubeの赤い再生アイコンアクセントは対象外のため無変更。
- `src/components/site/StreamingNowSection.tsx` / `src/app/work/[workId]/page.tsx`：ABEMA用の`accentClass`分岐を削除（YouTubeのみ残存）。作品詳細ページのCTAボタン内側にロゴが無かったため、`StreamingNowSection`と同じ`ProviderLogo`（`size="xs"`、既存アセットのみ使用）をCTAテキストの左側に追加し、ロゴサイズ・位置を全サービス共通にした（カードヘッダーの既存の大きいロゴは変更なしで維持）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過
- `next build` 成功
- Playwrightで375/390/430/1280pxを再確認（目黒蓮ページ・Prime Video/TELASA共演作品ページ）。横スクロール・コンソールエラーなし。ABEMAは黒＋白のみになったこと、Huluはより実ロゴに近い黄緑がかった鮮やかな緑になったこと、TELASAは鮮やかなオレンジに、Prime Videoは濃紺→ブルーのグラデーション＋アイコン表示になったことを目視確認。

---

## Task 22 — UI/UX・収益導線を壊さないSEO/AI検索/アクセシビリティ改善（安全項目のみ）

**目的：** 人物ページのUI改善（Task 21まで）と並行して、「見た目を変えず改善できる」SEO/AI検索クローラー対応・アクセシビリティ・内部データ漏洩の修正のみを実施した。見た目に影響する項目（統計下の説明文追加、Person/MovieのOG画像追加、Organization.sameAs等）は今回意図的に見送っている。

**変更したファイルと内容：**

1. **人物名の重複読み上げ対策**（`aria-hidden="true"`未設定だった7箇所に追加。見た目は完全不変）
   - `src/components/PersonCard.tsx` / `src/components/VodTopPersonCard.tsx` / `src/components/site/GroupMemberCard.tsx`（頭文字アバターdiv）
   - `src/app/search/SearchResults.tsx`（人物カードアバター・グループカードアイコンの2箇所）
   - `src/app/groups/[groupSlug]/page.tsx`（グループヒーローの頭文字アイコン）
   - `src/app/work/[workId]/page.tsx`（出演者一覧の頭文字アバター）
   - `PersonHero.tsx`・`RankingPersonCard.tsx`・`HomePersonCard.tsx`は既に対応済みだったため変更なし。

2. **内部プレースホルダー文言「人物登録時に自動作成」の公開ページ漏洩を修正**
   - `src/lib/group-note.ts`（新規）：db依存を持たない純粋関数`getPublicGroupNote(note)`を追加。既知の内部プレースホルダー文字列のみをundefinedにし、それ以外の管理者記入noteはそのまま返す。`'use client'`の`SearchResults.tsx`からもimportされるため、db importを持つ`group-meta.ts`とは別ファイルに分離した（クライアント/サーバー境界を壊さないため）。
   - `src/lib/group-meta.ts`：同名関数を`group-note.ts`からre-exportするのみに変更（既存の呼び出し元との互換性維持）。
   - `src/app/groups/[groupSlug]/page.tsx`（ヒーロー直下・解散バナー内の2箇所）、`src/app/search/SearchResults.tsx`（グループカード）で`group.note`を直接表示せず`getPublicGroupNote()`を経由するよう変更。
   - 本番相当のDB（`.env.local`接続）で確認したところ、note登録済み46グループ**全件**がこの内部プレースホルダーそのものであり、修正前は46グループのページ・検索結果カードすべてに管理用文言が公開表示されていたことを確認した。DBの値自体は変更していない。

3. **robots.txtにAI検索・主要検索エンジンボット向けの明示ルールを追加**
   - `src/app/robots.ts`：`Googlebot`・`Bingbot`・`OAI-SearchBot`・`PerplexityBot`向けに、既存の`*`ルールと同一のAllow/Disallow（`/admin/`・`/api/`・`/search?`は引き続き禁止）を個別追加。`GPTBot`・`Google-Extended`は指示により現状維持（`*`の総合ルールに任せる）で、専用ブロックは追加していない。

4. **sitemap.xmlの`lastModified`欠落を実データで補完**
   - `src/lib/work-store.ts`：新規`getAllPublishedWorkLastModified()`を追加（workId→DB実`updatedAt`のMap）。既存の`getAllPublishedWorkPersonMap()`は変更せず、別関数として追加したため既存呼び出し元への影響なし。
   - `src/app/sitemap.ts`：work・groupエントリに実データの`lastModified`を追加（groupは`groupMeta.updatedAt`）。person・genre・vod-providerエントリは信頼できる個別更新日時がDBに存在しないため、架空の日付を入れず従来通り`lastModified`なしのままとした（虚偽のlastmodはGoogleの評価を下げるリスクがあるため）。

5. **work詳細ページのcanonicalフォールバックURL不整合を修正**
   - `src/app/work/[workId]/page.tsx`：本番ドメイン未設定時のフォールバックが他ページと異なり`oshi-search.vercel.app`になっていたバグを`oshi-search.jp`に統一。

6. **JSON-LD `Person`の拡充（実データのみ・表示内容と一致させる）**
   - `src/app/person/[slug]/page.tsx`：`personMeta.publicRoles`から`jobTitle`、`personMeta.awards`から`award`、プロフィール欄と同じ実フィールド（役職・ジャンル・所属）から`description`を追加。値が存在しない場合は各プロパティ自体を出力しない。画像データが存在しないため`image`は追加していない（作品ポスターの代用は方針により禁止）。

7. **サイト全体の`WebSite`+`Organization` JSON-LDをトップページに新規追加**
   - `src/app/page.tsx`：どのページにも存在しなかった`WebSite`（既存の`/search?q=`を使った`SearchAction`付き）と`Organization`のJSON-LDを追加。新規ページ・新規事実の主張ではなくサイト識別情報のみのため、表示内容との不一致は生じない。

8. **VOD比較セクションの見出し階層を`h3`化**
   - `src/app/person/[slug]/page.tsx`：`#vod`セクション内で配信サービス名を保持していた`<span>`を`<h3>`に変更（`m-0`クラス追加、他のクラス・文言は無変更）。Tailwindのpreflightでh1〜h6のfont-size/font-weight/marginは既定でリセットされるため、Playwright実機確認でも見た目の差分はゼロだった。h1→h2(#vod-heading)→h3(サービス名)という正しい文書アウトラインになった。

**見送った項目（今回は実装せず）：**
- 人物ページ統計表示直下の短い説明文追加（視覚要素が増えるため保留）
- Person/MovieのOG画像追加（人物の実写真データが無いため。作品ポスターを人物画像として代用することは明示的に禁止されている）
- グループOrganization JSON-LDへの`sameAs`（`officialSite`）追加（現状ページ上に表示されていないフィールドのため、JSON-LDと表示内容を一致させる原則により見送り。可視化する場合は別途UI検討が必要）
- FAQ拡充・セクション順序変更・aggregateRating/offers等の評価/価格スキーマ（データが存在しない、または既存機能で回答できないため）

**設計上の判断：**
- 「安全な変更」の基準を「DOM構造・アクセシビリティ属性・メタデータ・レスポンスヘッダーは変更するが、ユーザーに見える文字・色・レイアウトは一切変えない」に限定した。視覚要素が1つでも増える提案（説明文・OG画像）は、たとえ軽微でもこのタスクの対象から外している。
- JSON-LDに追加する情報は、既に画面上の同じセクション（プロフィール欄）に表示されている実データのみを機械的に転記する方式を徹底し、要約や推測による文章生成は行っていない。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過（既存テストから変更なし）
- `next build` 成功
- ローカルDB接続で全46件の`group.note`を確認し、修正が実データに対して正しく機能することを検証（上記2番）
- Playwrightで人物ページ・work詳細ページ・グループページ・検索結果ページを375px/1280pxで確認。横スクロール・コンソールエラーなし。VOD比較セクションの`h3`化前後で見た目の差分なし。グループページ・検索結果からプレースホルダー文言が消えたことを確認。
- `/robots.txt`・`/sitemap.xml`の実際の出力をcurlで確認（Googlebot/Bingbot/OAI-SearchBot/PerplexityBotの個別ルール、work/groupエントリの`lastmod`実在確認）
- `/admin`が引き続き`noindex, nofollow, noarchive`でありログイン導線も正常動作することを確認

---

## Task 22 追記 — 頭文字アバターをDOMテキストノードから完全除外（AI検索bot対策）

**背景：** Task 22で追加した`aria-hidden="true"`はスクリーンリーダー対策としては有効だが、本番公開後に外部AIクローラー相当のテキスト取得を確認したところ、トップページ等で依然として「賀賀喜遥香」「井井上和」「目目黒蓮」のように、頭文字アバターのテキストノードと氏名テキストが連結されて取得される事象が確認された。`aria-hidden`はアクセシビリティツリーからの除外のみで、生HTMLのテキストノード自体は残るため、単純なHTML→テキスト抽出（多くのAI検索bot・簡易クローラーが採用する方式）には効果がなかった。

**対応：** 頭文字を`data-initial`属性にのみ保持し、CSS生成コンテンツ（`::before { content: attr(data-initial) }`）で視覚表示のみ行う方式に変更した。生成コンテンツはDOMのテキストノードではないため、`textContent`ベースの抽出やHTMLタグ除去による単純なテキスト化では一切出力されない（Googleのガイドラインでも、CSSの`content`プロパティによるテキストは通常のコンテンツとして扱われない）。

- `src/app/globals.css`：`[data-initial]::before { content: attr(data-initial); }`を追加。color/font-size/font-weight等は各要素からそのまま継承されるため、見た目は完全に同一。
- 頭文字を表示する全10箇所（`src/components/PersonCard.tsx`、`VodTopPersonCard.tsx`、`site/GroupMemberCard.tsx`、`site/HomePersonCard.tsx`、`site/PersonHero.tsx`、`site/RankingPersonCard.tsx`、`src/app/search/SearchResults.tsx`の人物カード・グループカード2箇所、`src/app/groups/[groupSlug]/page.tsx`のグループヒーロー、`src/app/work/[workId]/page.tsx`の出演者一覧）で、`{initial}`のようなテキストノード出力を廃止し、`data-initial={initial}`属性を持つ自己閉じ要素に変更した。
- 事前に全コードベースを再調査（`name[0]`パターンの網羅grep）し、Task 22で`aria-hidden`を付与した箇所に加え、既に`aria-hidden`を持っていた`PersonHero`・`RankingPersonCard`・`HomePersonCard`の3箇所も同じ問題を抱えていたため、あわせて修正した。人物・グループとも写真データを持つ機能が存在しないため、全箇所が常に頭文字表示のみであることを確認済み（画像がある人物への影響はそもそも発生しない）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過
- `next build` 成功
- Playwrightで`document.body.textContent`（DOMテキストノードのみ、非レンダリング型クローラーの抽出方式に相当）を人物ページ・グループページ・検索結果・作品詳細・トップページ（今人気の人物／急上昇／注目の人物を含む）で取得し、頭文字と氏名の重複パターンが一件も存在しないことを確認。
- 同じページ群のスクリーンショットで、修正前と見た目が完全に一致していることを目視確認（頭文字の文字・色・配置に変化なし）。

---

## Task 23 — 「楽天再取得」ボタンのエラー修正（/admin/product-check）

**目的：** 本番で`/admin/product-check`の「楽天再取得」ボタンを押すと`SyntaxError: Unexpected token 'A', "An error o"... is not valid JSON`や`TypeError: Failed to fetch`が発生する不具合を調査・修正した。

**原因：**
1. `src/app/api/admin/rakuten-refetch/route.ts`に`maxDuration`が未設定だった。`processPerson()`（`src/lib/batch-processor.ts`）は`MAX_AI_PER_PERSON = 150`（コメントに「Vercelの300sタイムアウト対策」と明記）という300秒枠前提の設計だが、同種の重い処理を行う他ルート（`person-jobs/process-now`・`cron/vod-recheck`等）が全て`maxDuration = 300`を明示しているのに対し、本ルートのみ未設定でVercelの既定タイムアウトのまま動作していた。商品数の多い人物では実行時間が既定値を超過し、Vercelがプロセスを強制終了 → プラットフォームが返す非JSONのエラーページ（`SyntaxError`の原因）や接続切断（`Failed to fetch`の原因）につながっていた。
2. `src/lib/rakuten.ts`の`getProductsByCategory`のcatchブロックが、`RakutenApiError`以外の例外（ネットワーク断・fetch自体の失敗等）を一切ログに残さず`{status:'error'}`を返すのみだったため、実際に何が起きたのかVercel Logsから確認できなかった。
3. `src/app/admin/product-check/PersonRakutenFetchButton.tsx`が`res.json()`をres.ok/content-type確認なしに無条件実行しており、非JSONレスポンス時にSyntaxErrorが発生していた（try/catch自体はあり画面クラッシュはしないが、原因不明の生エラー文字列がそのまま表示されていた）。

**変更したファイルと内容：**
- `src/app/api/admin/rakuten-refetch/route.ts`：`export const maxDuration = 300;`を追加（他の重い処理ルートと同値）。
- `src/lib/rakuten.ts`：`getProductsByCategory`のcatchブロックに、`RakutenApiError`以外の例外の種別・メッセージ・category・personNameを`console.error`で出力する行を追加。戻り値（`{status:'error'}`）・楽天API検索条件・商品取得ロジックは無変更。
- `src/app/admin/product-check/PersonRakutenFetchButton.tsx`：`res.json()`を呼ぶ前にレスポンスのcontent-typeを確認し、JSON以外の場合は`res.text()`で読み取ってHTTPステータス付きのエラーメッセージを表示するよう変更。JSONレスポンス時の既存の成功/エラー分岐ロジックは無変更。

**設計上の判断：**
- 楽天APIの検索条件・DB保存仕様・AI判定処理・既存商品の扱いには一切触れておらず、`ProductCheckPersonSection.tsx`の1箇所でのみ使用される本コンポーネント以外の管理画面機能への影響もない。
- `maxDuration`追加はインフラ設定のみの変更で、正常に完了していたリクエストの挙動は変わらない（実行可能時間の上限が伸びるのみ）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1417テスト全通過（既存テストから変更なし）
- `next build` 成功
- commit/push/deployは未実施（指示待ち）。

---

## Task 24 — 「楽天再取得」のカテゴリ単位分割によるタイムアウト根本対策

**背景：** Task 23で`maxDuration=300`を追加した後も、本番で佐藤勝利の「楽天再取得」がHTTP 504 `FUNCTION_INVOCATION_TIMEOUT`になる事象を確認。写真集カテゴリだけで最大50回程度の楽天APIリクエスト（別名・グループ名・keyword補完の組み合わせ）＋最大150件の逐次AI判定という処理量が、商品数の多い人物では300秒の壁すら超えうることが根本原因と判明したため、単純なmaxDuration延長ではなく処理を分割する設計に変更した。

**採用した設計：**
- 楽天取得を6カテゴリ（写真集・本・雑誌・Blu-ray・DVD・グッズ・CD・中古）に分割し、1カテゴリ=1 HTTPリクエストとしてフロントから順番に呼ぶ。
- AI判定は新規実装せず、既存の`/api/admin/ai-judge`（`judgeStoredProducts`、10件ずつ）をフロントから「全件AI判定」と同じ継続呼び出しパターンで繰り返し呼ぶことで代替する。
- ユーザー操作は従来通り「楽天再取得」ボタン1回のみ。

**変更したファイルと内容：**
- `src/lib/batch-processor.ts`：`processPerson()`のカテゴリループ本体（楽天API取得→DB保存→ルールベース判定）を新規`processPersonCategory()`として抽出した（ロジック・ログ・判定順序は一切変更せず、コードを移動しただけ）。`processPerson()`は抽出後の関数を6回ループで呼ぶだけになり、シグネチャ・戻り値・AI判定（`judgeProducts`呼び出し）を含む外部から見た挙動は完全に無変更。中古カテゴリの重複抑制（同一タイトルの新品が既に取得済みなら除外）のみ、実行内メモリでの蓄積からDB（`getAllStoredProducts`で他5カテゴリの保存済みタイトルを読み直す）に変更した——中古は元々CATEGORIES配列内で最後に処理されるため、カテゴリ単位のHTTPリクエストに分割しても同じ判定結果になる（ルール・しきい値・上限件数は無変更）。
- `src/app/api/admin/rakuten-refetch/route.ts`：1リクエスト=1カテゴリの契約に変更。`category`パラメータを追加し、`processPersonCategory()`を呼ぶ。人物単位の排他ロック（後述）を追加。AI判定関連のフィールドは返さない（フロントが別途`/api/admin/ai-judge`を呼ぶため）。
- `src/lib/batch-lock.ts`：`personRakutenFetchLockKey()`を追加（既存の`personAiJudgeLockKey`と同じ仕組み・同じロックテーブルを再利用し、名前空間だけ別にした別名。AI判定ロックとは独立しており互いに干渉しない）。
- `src/app/admin/product-check/PersonRakutenFetchButton.tsx`：内部で6カテゴリを順番に呼ぶループ→完了後`/api/admin/ai-judge`を未判定が無くなるまで繰り返し呼ぶループ、の2フェーズに変更。進捗表示（「楽天取得中 N/6：カテゴリ名」「AI判定中：N件完了」）、カテゴリ単位のエラー表示（どのカテゴリで失敗したか）、失敗後の再クリックで成功済みカテゴリをスキップして再開する仕組み（`completedCategoriesRef`）を実装。Task 23で入れたcontent-type確認（非JSON応答時にSyntaxErrorにしない）は両フェーズの通信に維持。

**設計上の判断・安全性：**
- **重複登録防止**：`storeProducts()`の既存マージロジック（商品IDベース）は無変更のため、同じカテゴリを再実行しても重複保存にはならない。
- **AI判定の二重実行防止**：`/api/admin/ai-judge`側の既存ロック（`personAiJudgeLockKey`）は無変更のまま機能する。
- **楽天取得側の二重実行防止**：新規に`personRakutenFetchLockKey`による排他ロックを追加。カテゴリ呼び出し1回ごとに取得・解放するため、フロントの6カテゴリ順次呼び出し自体は妨げない。
- **途中失敗時の再開**：各カテゴリ・各AI判定バッチは冪等（べき等）なため、失敗した単位だけを再実行すれば安全（成功済みカテゴリの再取得は不要）。
- **既存呼び出し元への影響ゼロ**：`processPerson()`を呼ぶ`processAllPersons()`（cron）・`api/admin/batch/route.ts`・`api/admin/people/fetch/route.ts`・`person-job-processor.ts`は、`processPerson()`のシグネチャ・戻り値が完全に無変更のため無影響。`/api/admin/ai-judge`・`PersonAiJudgeButton.tsx`（AI判定10件・全件AI判定）はコード自体に触れていないため無影響。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1426テスト全通過（既存1417件のうち、契約変更に合わせて`rakuten-refetch-route.test.ts`を新しいカテゴリ単位の契約用に書き直し、`batch-processor.test.ts`の中古dedupテストのモックを更新。それ以外の既存テストは無変更で全通過）
- `next build` 成功
- 実際の本番データに対するライブ実行（実際の楽天API・OpenAI呼び出し・DB書き込みを伴う）は、実データを変更してしまうため今回は実施していない。commit/push/deployは未実施（指示待ち）。

---

## Task 25 — SEO改善 STEP2着手：人物ページtitle/description条件分岐・作品ページBreadcrumbList修正

**目的：** Search Console調査（クリック少・平均掲載順位54.5位・作品ページの多くが「検出-インデックス未登録」）を踏まえたSEO改善プロジェクトの最初の安全な実装。既存URL・DB・robots.txt・sitemap・AIクローラー設定・デザインには一切触れず、metadata/JSON-LDの精度向上のみを行った。

**変更したファイルと内容：**
- `src/app/person/[slug]/page.tsx`：`generateMetadata()`のtitle/descriptionを、実際にDBへ登録されている出演作品（`getPublishedWorksOrThrow`）から動的に条件分岐するよう変更。`getDisplayWorkType(w)`が`'movie'`/`'drama'`かどうかで「出演ドラマ・映画」「出演ドラマ」「出演映画」「出演作品」（作品はあるが映画・ドラマ以外のみの場合）を出し分け、`isConfirmedVodAvailability`で確認済みVOD提供元が1件もない人物には「配信情報」を書かない。架空データは一切生成せず、既存DBの値のみを参照する。
- `src/app/work/[workId]/page.tsx`：JSON-LDの`BreadcrumbList`を、画面上の可視パンくず（ホーム›作品タイトル）と一致する2階層に修正。従来は中間階層が実在しない`/work`（一覧ページ無し）を参照していたため、実在するURLのみの構成にした。作品には複数出演者がいるため、特定人物ページを親階層にはしていない（ユーザー指示通り）。
- `src/lib/work-store.ts`：`getPublishedWorksOrThrow()`をReactの`cache()`でラップ。`generateMetadata()`とページ本体の両方が同じ人物の作品データを必要とするため、cache()によりリクエスト内で実際のDBクエリは1回のみに抑えた（クロスリクエストのキャッシュではないため、管理画面での更新は次のリクエストから即座に反映される。既存の他の呼び出し元（ページ本体・`admin/data-loss-audit`）への影響なし、戻り値・シグネチャは無変更）。

**設計上の判断：**
- title/descriptionの基本文型（「○○（グループ）の写真集・グッズ・出演作品・配信情報まとめ」に類する自然な日本語）は維持し、パイプ区切りのキーワード列挙のような不自然な形式へは変更していない（過度なキーワード詰め込み回避）。
- 「写真集・グッズ」は商品検索が全登録人物でほぼ共通のため条件分岐対象外とし、明示的に指示のあった「映画」「ドラマ」「配信情報」のみを実データで分岐した。
- VOD判定は`isConfirmedVodAvailability`のみを使用し、`terminatedSlugs`（サービス終了判定）は含めていない（メタデータの有無判定のみのため、既存の完全な公開フィルタと厳密に一致させる必要はないと判断）。

**動作確認：**
- `npx tsc --noEmit` エラーなし（lintスクリプトは本プロジェクトに未設定のため実行対象なし）
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功
- 実データで確認：目黒蓮（映画・ドラマ・VODあり）→「出演ドラマ・映画・配信情報」、遠藤光莉・鶴崎仁香（作品はあるが映画・ドラマ非該当、VODあり）→「出演作品・配信情報」と正しく出し分けられることを確認。作品ページのBreadcrumbList JSON-LDが画面表示と一致（ホーム›作品タイトルの2階層）することを確認。

---

## Task 25 追記 — 人物ページtitle/descriptionの「写真集・グッズ」も実データで条件分岐

**背景：** Task 25で対応した映画・ドラマ・配信情報の条件分岐に続き、「写真集・グッズ・CD・Blu-ray」がほぼ全人物に固定文言で入っている点も実データと一致させるようフィードバックを受けた。既存の商品データ取得処理（`getAllStoredProductsOrThrow`・`getAllVerdictsOrThrow`、どちらも人物ページ本体が既に呼んでいる）を調査し、SEO目的の新しい重いクエリ・楽天API呼び出しを一切追加せずに対応した。

**変更したファイルと内容：**
- `src/lib/product-store.ts` / `src/lib/judgment-store.ts`：`getAllStoredProductsOrThrow` / `getAllVerdictsOrThrow`をそれぞれReactの`cache()`でラップ（`getPublishedWorksOrThrow`と同じ既存パターン）。`generateMetadata()`とページ本体の両方が同じ人物のデータを必要とするため、実DBクエリを1回のみに保つための対応（戻り値・シグネチャは無変更、他の呼び出し元にも影響なし）。
- `src/app/person/[slug]/page.tsx`：
  - `generateMetadata()`で上記2関数を追加取得し、人物ページの商品分類ロジック（`DISPLAY_SECTIONS`）と同じカテゴリ対応で「写真集」（DBカテゴリ'写真集'+'本・雑誌'のいずれかに、明示的にunrelated/deleted判定されていない商品が1件以上）と「グッズ」（'CD'/'Blu-ray・DVD'/'グッズ'/'中古'のいずれか）の有無を判定する`hasUsableProducts()`を追加。CD/Blu-rayを個別の語として名指しすることはせず、存在確認できるカテゴリ群をまとめて「グッズ」1語で扱うことで、確認できないものを無条件に列挙しない方針にした。
  - title優先順位を「人物名→所属グループ→出演作品・配信先→写真集・グッズ」に組み替え、各要素を実データで条件分岐（例：`目黒蓮（Snow Man）の出演ドラマ・映画・配信先｜写真集・グッズ`）。何も情報が無い極端なケースでは人物名（＋グループ）のみのtitleにフォールバックする。
  - description も同じ実データで組み立て、1文目には必ず人物名を含める（商品データが無く出演作品文だけになる場合に、人物名の無い文で始まらないようにする追加対応）。
- URL・canonical・robots.txt・sitemap・AIクローラー設定・noindexには一切触れていない。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功
- 実データで写真集のみ（山里亮太）・グッズのみ（稲熊ひな）・双方あり（目黒蓮等6名）・双方なし（齊藤京子）の4パターンすべてを確認し、それぞれ正しく条件分岐されていることを確認。齊藤京子（商品データなし）のdescriptionが人物名を含まない文になっていたバグを発見・その場で修正し、再確認済み。

---

## Task 25 再追記 — 「写真集」表記をDBカテゴリ'写真集'単独に厳密化、それ以外は「関連商品」に統一

**背景：** Task 25追記で「写真集」を判定する際、DBの'写真集'カテゴリと'本・雑誌'カテゴリをまとめて1語で扱っていたため、実際には'本・雑誌'カテゴリの商品しか無い人物（例: 音嶋莉沙、成田凌）のtitleにも「写真集」と表示される不整合が見つかり、修正した。

**変更したファイルと内容：**
- `src/app/person/[slug]/page.tsx`：
  - `hasPhotobook`をDBカテゴリ'写真集'のみで判定するよう厳密化（'本・雑誌'は含めない）。
  - 新たに`hasMagazine`（'本・雑誌'）・`hasCdOrBd`（'CD'+'Blu-ray・DVD'）・`hasGoods`（'グッズ'）・`hasUsedOnly`（'中古'）を個別に判定。
  - title：「写真集」以外の商品カテゴリはすべて「関連商品」1語にまとめる（写真集のみ→「写真集」、それ以外のみ→「関連商品」、両方→「写真集・関連商品」、いずれも無し→商品節自体を省略）。
  - description：カテゴリを正確に判定できるものだけ具体的な語（写真集／本・雑誌／CD・Blu-ray／グッズ）を列挙し、単独の判定が難しい「中古」のみの場合に限り「関連商品」にフォールバックする。
- 新しい楽天API呼び出し・追加DBクエリは発生していない（既存の`getAllStoredProductsOrThrow`/`getAllVerdictsOrThrow`の戻り値を、より細かい単位で参照するようにしただけ）。URL・canonical・robots・sitemap・AIクローラー設定・noindexは無変更。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功
- 実データ確認：目黒蓮（写真集+複数商品あり）→「写真集・関連商品」、音嶋莉沙・成田凌（本・雑誌のみ、写真集カテゴリ自体は0件）→「関連商品」のみ（誤って「写真集」と書かれないことを確認）、山里亮太（写真集のみ）→「写真集」のみ、稲熊ひな（CD/Blu-rayのみ）→title「関連商品」・description「CD・Blu-ray」、齊藤京子（商品データなし）→商品節なし。

---

## Task 26 — SEO改善 第2段階：内部リンク構造＋ジャンルページSEO改善（未commit・調査結果は本エントリに記録）

**目的：** Search Console改善の第2段階として、既に存在する人物・作品・グループ・ジャンルページ間の内部リンク構造を強化し、ジャンルページ（`/genre/[genre]`）にcanonical・BreadcrumbList・データに基づくtitle/descriptionを追加した。ページ増設・URL変更・DB変更・noindex追加は一切行っていない。

**STEP1: 内部リンク投資調査結果（9項目）：**

| 関係 | 実装箇所 | 状態 |
|---|---|---|
| グループ→メンバー | `src/components/site/GroupMemberCard.tsx` | 実在する`<Link href="/person/...">`で既に対応済み（変更不要） |
| 人物→所属グループ | `src/app/person/[slug]/page.tsx` パンくず部 | 実在する`<Link>`で既に対応済み（変更不要） |
| 人物→出演作品 | `src/components/WorkCard.tsx` | 実在する`<Link href="/work/...">`で既に対応済み（変更不要） |
| 作品→出演人物 | 作品ページのキャスト一覧 | 実在する`<Link href="/person/...">`で既に対応済み（変更不要） |
| 作品→配信サービス | `src/app/work/[workId]/page.tsx` プロバイダカード | **リンクなし（外部の実配信サービスへのCTAのみ）。今回`/vod/[provider]`への内部リンクを追加** |
| 人物→関連人物 | （直接的な「関連人物」導線は現状なし） | 今回は追加見送り（大規模設計変更が必要なため対象外と判断） |
| 作品→関連作品 | （直接的な「関連作品」導線は現状なし） | 同上、見送り |
| ジャンル→人物 | `src/app/genre/[genre]/page.tsx` `<PersonCard>`一覧 | 実在する`<Link>`で既に対応済み（変更不要） |
| 人物→ジャンル | `src/app/person/[slug]/page.tsx` パンくず部 | 実在する`<Link href="/genre/...">`で既に対応済み（変更不要） |

**STEP2: 実施した内部リンク改善（優先度Eのみ対応）：**
- `src/app/work/[workId]/page.tsx`：配信プロバイダカードごとに、`VOD_PAGE_PROVIDERS`（`src/lib/vod-page.ts`の既存13サービス静的設定）と`normalizedSlug`が一致する場合のみ、`/vod/[provider]`への小さな内部リンク（「○○の配信作品一覧を見る →」）を追加。一致しないサービスにはリンクを表示しない（実在しないURLを生成しない）。

**STEP3: ジャンルページ（`/genre/[genre]`）改善：**
- `src/app/genre/[genre]/page.tsx`：
  - `generateMetadata()`に自己参照の`alternates.canonical`を追加。
  - 人物0件（準備中）ページはtitle/description文言を変更せず、canonicalのみ追加（今回はnoindex化しない）。
  - 人物1件以上のページはtitle/descriptionを実データ（人物数）に基づき`「${g}一覧｜出演作品・配信情報から探す」`／`「${g}の人物を${persons.length}人掲載。出演作品・配信中の作品・写真集やグッズなどの関連商品をまとめて検索できます。」`に変更。
  - ページ本体に可視パンくず（ホーム›ジャンル名）と、実在URLのみを使う2階層`BreadcrumbList` JSON-LD（ホーム→ジャンル名）を追加（準備中ページ・通常ページ両方に適用）。
- `src/lib/persons.ts`：`getPersonsByGenreExtended`をReactの`cache()`でラップ（唯一の呼び出し元がジャンルページのみであることをgrepで確認済み）。`generateMetadata()`とページ本体が同一ジャンルのデータを必要とするため、実クエリを1回のみに抑えるための対応（戻り値・シグネチャは無変更）。

**STEP4: 薄いページ・準備中ページの調査結果（調査のみ・noindex追加やページ削除は未実施）：**

一時的な読み取り専用スクリプト（`scripts/genre-thin-audit.ts`、確認後削除・commit対象外）で本番相当のデータを集計（全43ジャンル、`DEFAULT_GENRE_ORDER`基準）：

- **人物0件（準備中）：16件** — バラエティ、編曲家、音楽プロデューサー、小説家、漫画家、映画監督、監督、プロデューサー、スポーツ選手、アスリート、コーチ、キャスター、コメンテーター、政治家、研究者、文化人。現状インデックス可能（noindexなし）。改善案：これらのジャンルに該当する人物データが今後追加されるまでは意図的にthinなままであり、急いでnoindexにする必要はないが、恒久的に0件のままなら将来的にnoindex検討の候補。
- **人物1件のみ：5件** — グラビア、シンガーソングライター、作詞家、DJ、脚本家。改善案：現状は1人分のPersonCard一覧のみで内容は薄いが、該当人物の個別ページへの正しい導線にはなっているため、今回は現状維持。
- **人物2〜5件（薄め）：8件** — 声優(3)、作曲家(2)、作家(3)、クリエイター(4)、ダンサー(2)、アナウンサー(2)、インフルエンサー(4)、実業家(3)。改善案：件数が増えるまでは経過観察、現状は変更不要。
- **人物6件以上（十分な内容）：14件** — 坂道(198)、アイドル(114)、元アイドル(115)、タレント(75)、芸人(8)、テレビ(60)、女優(73)、俳優(66)、モデル(43)、歌手(14)、アーティスト(42)、バンド(11)、YouTuber(6)、芸能界引退(6)。これらは既に十分な内容があり、今回追加したtitle/description/BreadcrumbList改善の効果が最も見込める。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功（`/genre/[genre]`は引き続きSSG、43件の静的パス生成を確認）
- `git diff`で人物ページ（第1段階のmetadataロジック）・作品ページのBreadcrumbList（第1段階の実装）に変更がないことを確認済み

**変更なし（今回維持）：** robots.txt、AIクローラー設定、llms.txt、sitemap.xml構造、URL構造、DBスキーマ・マイグレーション、noindex（新規追加なし）、大量ページ生成なし。

**注記：** このタスクはユーザー指示により、この時点でcommit/pushを行っていない（次回のセッションでレビュー後にcommit予定）。

---

## Task 27 — SEO改善 第3段階：薄いページ整理判断＋作品ページクロール/インデックス改善調査（未commit）

**目的：** Search Console「検出 - インデックス未登録」約3,512件（大部分が/work/作品ページ）の原因調査と、既存データのみを使った安全な作品ページ改善。ページ削除・noindex追加・URL変更・sitemap構造変更は一切行っていない（今回は提案のみ）。

**調査方法：** 一時的な読み取り専用スクリプト（`scripts/work-page-seo-audit.ts`、確認後削除・commit対象外）で本番相当データを集計。DB書き込みは一切なし。

**主な確認事実：**
- 総公開作品数（distinct workId）: 13,225件（personName×workId行数は22,181行、1作品平均1.68人の出演者）
- 人物ページと紐づく作品数: 13,225件（100%）／紐づかない作品数: 0件（`getAllPersonsForWork`が返すpersonNameは常に有効な公開人物と一致することを確認。「孤立作品ページ」は人物リンク不備が原因ではないことが判明）
- VODあり: 7,333件（55.5%）／VODなし: 5,892件（44.5%）
- workId接頭辞別・あらすじ(overview)保有率: csv-tv 9,221件中0件（0%）、csv-movie 757件中0件（0%）、tmdb-tv 1,790件中1,399件（78%）、tmdb-movie 1,452件中1,014件（70%）— **Search Consoleが薄いページとして検出しているcsv-tv/csv-movie系（全体の69.7%）は、あらすじが構造的に0%であることを確認**。これがSTEP5の主要な確認済み原因。
- 品質分類（あらすじ・VOD・公開年の3項目のうち何項目該当するかで判定。人物リンク・役名はほぼ全作品にあり判別力が無いため除外）: A（3項目すべて該当）2,112件／B（1〜2項目）11,084件／C（0項目、タイトル＋人物・役名のみ）29件／D（タイトルplaceholder等の問題候補）0件
- `work_aliases`（統合済み重複）409件のうち19件は、統合元workIdが依然としてauto_published公開作品としても存在しており、sitemapに308リダイレクト対象URLが混入している状態を確認（管理画面の重複統合フローで解消できる候補、削除・redirect追加は今回未実施）
- `normalizedTitle`が同一で`work_aliases`未登録の重複候補: 307組・632workId（例: 「ポケットモンスター」がcsv-tv-ポケットモンスターとtmdb-tv-60572の両方に存在）— 既存の重複統合レビュー機能（work-dedup）の対象候補として報告のみ
- 内部リンク到達性: ホーム→グループ/ジャンル（1クリック、全件リンクあり）→人物（2クリック）→作品（3クリック）。ホーム→VODページ（1クリック）→作品（2クリック、VODありの55.5%のみ）。ホームの「注目の人物」枠は12人限定だが、グループ・ジャンル経由では全人物に到達可能なため、真に孤立した（どこからも到達不能な）作品ページは無いことを確認。

**あらすじフォールバック文の実装 → 実データ検証の結果、不採用として差し戻し：**
- 当初、`src/app/work/[workId]/page.tsx`にあらすじ（`work.overview`）未登録作品向けの要約文フォールバック（既存データのみから「{タイトル}は{種別}（{年}）。{出演者}が出演。{VOD}で配信中。」という文を組み立てて表示）を実装したが、ユーザー指示によりcsv-tv 3件・csv-movie 2件の実データで検証したところ、5件とも文法構造が完全に同一で名詞部分のみが入れ替わる、高度にテンプレート化された文章であることが判明（例：「パクパクasmiちゃんはドラマ（2025年）。asmiが出演。TVerで配信中。」「サムライフは映画（2015年）。松岡茉優が出演。U-NEXTで配信中。」）。この文は同ページ内に既に表示済みの構造化データ（タイトル・種別バッジ・公開年・出演者一覧・配信情報セクション）を単に文章として再構成したものに過ぎず、新しい情報量を追加しない。ユーザーの明示的な基準（「9,000ページ以上でほぼ同型になるだけのテンプレート文章であれば採用しない」）に該当すると判断し、**実装を差し戻した**（`git diff`で当該ファイルの差分が完全に消えていることを確認済み）。
- 差し戻しにより、今回のセッションでの`src/app/work/[workId]/page.tsx`への変更は最終的に無し。

**work_aliases 19件の詳細確認結果：** 全19件がいずれも単純な1段リダイレクト（旧workId→canonical workIdの1対1）で、redirect先はすべて現在auto_published公開作品として200を返し、chainやloopは無く、redirect先URLはすべて既にsitemapに含まれていることを確認。この整合性の高さから、「sitemap生成時にwork_aliasesのaliasWorkIdのみをworkPersonMapから除外する」という安全な対応が技術的に成立する見込み（DBレコード削除・status変更は不要）。ただしユーザー指示により今回は実装せず、調査結果の報告のみに留めた。

**今回実装しなかったもの（理由）：**
- あらすじフォールバック文（上記の通り、実データ検証の結果テンプレート化が確認されたため不採用）
- 内部リンク追加（STEP6）：第1・第2段階で既に人物→作品・作品→人物・作品→VOD・グループ→人物の主要導線が実装済みであり、優先順位リストに沿った新たな欠落は確認できなかったため、今回の追加実装はなし。
- sitemapからのwork_aliases除外：技術的に安全に実装可能と判断したが、ユーザー指示により今回は調査・提案のみで実装は見送り。
- noindex追加・ページ削除・redirect追加・sitemap除外（STEP9の③④）・normalizedTitle重複307組の統合：ユーザー指示により提案のみに留め、実装はしていない（既存のwork-dedupレビュー機能での人手確認を維持）。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功
- `git status`／`git diff`で、第3段階に関するコード変更が最終的に0件（開発ログ追記のみ）であることを確認

**変更なし（今回維持）：** robots.txt、AIクローラー設定、llms.txt、sitemap.xml構造、URL構造、DBスキーマ・マイグレーション、noindex（変更・追加なし）、既存人物/作品/グループURL、第1・第2段階のmetadata/BreadcrumbList実装、`src/app/work/[workId]/page.tsx`（差し戻し後、無変更）。

**注記：** 第3段階の前半（あらすじフォールバックの実装・差し戻し）はコード変更なしで終了。sitemapのwork_aliases除外は、続くTask 28として実装した。

---

## Task 28 — SEO改善 第3段階（続き）：sitemapからwork_aliases統合元URLを除外

**目的：** Task 27で確認した「work_aliasesに統合元として登録済みだが依然auto_published公開作品としても存在する19件」について、DBレコードのstatus変更・削除・redirectロジック変更を一切行わずに、sitemap生成時のみこれらのURLを除外する。

**実装前の内部リンク監査（コード変更前に実施）：** 全ての`/work/{workId}`href生成は`src/lib/work-url.ts`の`getWorkPublicUrl()`という単一の共通関数を経由していることをgrepで確認（WorkCard.tsx、StreamingNowSection.tsx、person/work/groups各ページ、vod-page.ts、ranking.tsなど全呼び出し元で例外なし）。この関数は`canonicalWorkId`引数を受け取れる設計になっているが、**実際にはどの呼び出し元もこの引数を渡しておらず、alias→canonical変換は現状どこでも行われていない**ことを確認。実データ検証として、`csv-tv-教場ⅱ`（work_aliasesの統合元workId）が目黒蓮の人物ページの「出演作品」一覧に実際に`href="/work/csv-tv-%E6%95%99%E5%A0%B4%E2%85%B1"`として出力されていることをdevサーバー上のHTMLで直接確認した。つまり、sitemap除外だけでは内部リンク経由のクロールは止められない（今回はsitemapのみの対応とし、内部リンクのalias解決は別タスクとする）。

**変更したファイルと内容：**
- `src/lib/work-store.ts`：`getAllWorkAliasSourceIds()`を新規追加。`work_aliases`テーブルの`alias_work_id`列のみを取得しSetで返す読み取り専用関数（DB書き込みなし）。
- `src/app/sitemap.ts`：`getAllWorkAliasSourceIds()`を追加取得し、作品URL生成のループ直前で`workPersonMap.keys()`から`aliasSourceIds`に含まれるworkIdを`.filter()`で除外。`getAllPublishedWorkPersonMap()`自体（`src/lib/ranking.ts`でも使用中）は無変更のため、他の呼び出し元への影響なし。

**設計上の判断：**
- DBのstatus変更・レコード削除は一切行わず、sitemap生成という「読み取り側」でのみフィルタすることで、既存のredirectロジック（`lookupWorkAlias`→`permanentRedirect`）や公開判定条件に一切触れずに実現した。
- 追加DBクエリは`SELECT alias_work_id FROM work_aliases`（主キーのみ、409行）の1本のみ。sitemapが既に行っている22,000行超の作品集計・VOD集計と比べて無視できる負荷。

**動作確認（実データ）：**
- sitemap総URL数：変更前13,656件 → 変更後13,637件（**差分19件、Task 27で確認した対象件数と完全一致**）
- 確認済み19件全て：`/work/{aliasWorkId}`がsitemapから消え、対応するcanonical workIdのURLはsitemapに残っていることを個別に確認（例：`csv-tv-venue101`は消滅、`tmdb-tv-202091`は残存）
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1427テスト全通過（既存テストから変更なし）
- `next build` 成功

**変更なし（今回維持）：** robots.txt、AIクローラー設定、llms.txt、sitemap.xml全体の構造（URLリスト生成ロジック以外）、URL構造、DBスキーマ・マイグレーション、DBレコードのstatus/deleted、work_aliasesテーブルの内容、redirectロジック、noindex。

---

## Task 29 — SEO改善 第3段階（続き）：内部リンクのwork_aliases旧URL出力を解消（canonical直接リンク化）

**目的：** Task28で判明した「内部リンク生成が`getWorkPublicUrl()`経由でwork_aliasesの統合元workId（旧URL）をそのまま出力してしまう」問題を解消する。旧URLへの308リダイレクト機能自体は維持したまま、サイト内部からは最初からcanonical URLへ直接リンクするようにする。

**STEP1 設計調査結果：**
- `/work/{workId}`のhref生成は全て`src/lib/work-url.ts`の`getWorkPublicUrl()`という単一の共通関数を経由（grepで全呼び出し元確認済み・例外なし）。
- `getWorkPublicUrl()`は元々`canonicalWorkId`引数を受け取れる設計だったが、どの呼び出し元も渡していなかったため、alias解決が機能していなかった。
- 実際にhrefを生成している箇所は6ファイル：`src/components/WorkCard.tsx`（Client Component）、`src/components/site/StreamingNowSection.tsx`（Server Component）、`src/app/person/[slug]/page.tsx`（Server Component、配信サービス別グループのリンク）、`src/app/work/[workId]/page.tsx`（Server Component、関連作品セクション）、`src/app/groups/[groupSlug]/page.tsx`内の`CompactWorkLink`（Server Component）、`src/lib/ranking.ts`（人気作品のdetailUrl構築）、`src/lib/vod-page.ts`（`/vod/[provider]`一覧のdetailUrl構築）。
- これらのうち`WorkCard.tsx`と`StreamingNowSection.tsx`はいずれも`WorkRecord`をpropsとして受け取るだけで、自らDBアクセスは行わない（`WorkCard`は`'use client'`）。そのため、canonicalWorkIdをこれらのコンポーネントで新たに解決するのではなく、**データ取得元（サーバー側）で`WorkRecord`にcanonicalWorkIdを付与してから渡す**設計を採用した。

**採用した解決方法：**
- `src/types/work.ts`：`WorkRecord`に`canonicalWorkId?: string`を追加（オプショナルフィールド。既存の`id`フィールドは一切変更しない＝DB行の識別子としての`id`の意味は保持）。
- `src/lib/work-store.ts`：`getWorkAliasCanonicalMap()`を新規追加（`work_aliases`から`aliasWorkId→canonicalWorkId`のMapを構築、reactの`cache()`でリクエスト内重複取得を防止）。`getPublishedWorks()`・`getPublishedWorksOrThrow()`の両方で、このMapを使い返却前のWorkRecord[]に`canonicalWorkId`を付与する`withCanonicalWorkId()`ヘルパーを適用。
- `src/lib/ranking.ts`：人気作品構築時に同じ`getWorkAliasCanonicalMap()`を追加取得し、`detailUrl`生成時に`canonicalWorkId`を渡すよう変更。
- `src/lib/vod-page.ts`：`getWorksForVodProvider()`内で同じMapを取得し、`mapRawRowToVodPageWork()`の`detailUrl`生成時に使用。
- `src/components/WorkCard.tsx`・`src/components/site/StreamingNowSection.tsx`・`src/app/groups/[groupSlug]/page.tsx`（CompactWorkLink）・`src/app/work/[workId]/page.tsx`（関連作品）・`src/app/person/[slug]/page.tsx`（配信サービス別リンク）：各`getWorkPublicUrl()`呼び出しに`canonicalWorkId: work.canonicalWorkId`（該当フィールド名は箇所により`work`/`w`）を追加しただけ。**`getWorkPublicUrl()`自体のAPI・挙動は一切変更していない**（既存の`canonicalWorkId?.trim() || workId?.trim()`というfallbackロジックがそのまま機能する）。

**N+1対策：** 新規クエリは`getWorkAliasCanonicalMap()`（`work_aliases`の全件、409行、主キーのみ）1本のみ。react `cache()`でラップしているため、1リクエスト内で複数回呼ばれても（例: グループページでメンバーごとに`getPublishedWorks()`を並列呼び出しする場合）実際のDBクエリは1回に集約される。作品カード1件ごとのクエリは一切追加していない。

**動作確認（実データ・devサーバーで確認）：**
- 目黒蓮／森本慎太郎／阿部亮平／金村美玖／冨里奈央の5人物ページで、対応するalias workId（csv-tv-教場ⅱ／csv-movie-燃えよ剣／csv-movie-君のクイズ／csv-tv-hinabingo／csv-tv-venue101）のhrefが消え、canonical workIdのhrefに変わっていることを確認。
- 公開alias19件・関連する30人の人物ページ全44組み合わせを機械的に確認し、alias hrefの残存は0件。
- `/groups/hinatazaka46`グループページ、`/vod/hulu`（csv-tv-hinabingo→tmdb-tv-100357）でも同様にcanonical直接リンクを確認。
- 旧URL（例: `/work/csv-tv-hinabingo`）への直接アクセスは引き続き308でcanonical URLへリダイレクトされ、リダイレクト先は200を返すことを確認（redirectロジックは無変更）。
- sitemap除外ロジック（Task28）は今回変更しておらず、sitemap側の挙動に影響なし。

**動作確認（テスト）：**
- `npx tsc --noEmit` エラーなし
- `npx vitest run` 1428テスト全通過（`ranking.test.ts`にwork_aliases解決の新規回帰テストを1件追加、既存テストは無変更のまま全通過）
- `next build` 成功

**変更なし（今回維持）：** robots.txt、AIクローラー設定、noindex、URL構造、DBスキーマ・マイグレーション、DBレコード（work_aliasesの内容・works.status等）、redirectロジック（`lookupWorkAlias`→`permanentRedirect`は無変更）、sitemapのwork_aliases除外ロジック（Task28）。

**注記：** ユーザー指示により、この時点でcommit/pushを行っていない（レビュー後に指示を待つ）。

---

## Task 30 — Instagram自動投稿ツール向け：人物データの読み取り専用エクスポートスクリプト追加

**目的：** 完全に独立したサブプロジェクト`tools/instagram-post-generator/`（Instagram自動投稿ツール）が、「人物名を指定するだけ」で本体の実データ（作品・VOD・画像URL）を取得できるようにする。新しい選定ロジックを重複して作らず、Canva一括作成ツール（`tools/canva-instagram/generate-csv.ts`）が既に持つ`selectTopWorks()`（movie/drama判定・VOD優先・新しい順・画像利用可否チェック済みの3件選定）をそのまま再利用する。

**変更したファイル：**
- `tools/canva-instagram/generate-csv.ts`：`selectTopWorks`・`buildVodDisplayString`・関連する型（`SelectionResult`・`SelectedWork`）に`export`を追加しただけ（ロジック・挙動は一切変更なし）。あわせて、末尾のCLI起動処理（`main().catch(...)`）を`if (require.main === module)`で囲み、他ファイルからのimport時にCSV/XLSX生成やDownloadsへのコピーが誤って走らないようにした（直接実行時の挙動は変更なし、動作確認済み）。
- `tools/canva-instagram/export-person-for-ig.ts`（新規）：人物名を受け取り、`getPersonWithConfigMerged`（`@/lib/persons`）・`selectTopWorks`・`getWorkDisplayImage`/`getRenderableWorkImageUrl`（`@/lib/work-image`）のみを使って`{ personName, works: [{title, vod, image}] }`をJSONとして標準出力に書き出す、読み取り専用スクリプト（INSERT/UPDATE/DELETEなし）。`src/lib`側の既存`console.log`診断出力（`persons.ts`の`getPublishedExtra`）が標準出力のJSON契約を汚染しないよう、このファイル内でのみ`console.log`をstderrへリダイレクトしている（`persons.ts`自体は変更していない）。

**呼び出し元：** `tools/instagram-post-generator/scripts/fetch-person-data.ts`（独立サブプロジェクト側、詳細は同ツールのREADME参照）が、`npx dotenv -e .env.local -- npx tsx tools/canva-instagram/export-person-for-ig.ts "人物名"`を子プロセスとして呼び出し、標準出力のJSONのみを受け取る。本体の`src/lib`を独立サブプロジェクトから直接importすることはしていない（既存の「本体から完全に独立したサブプロジェクト」という設計方針を維持）。

**動作確認：**
- `npx tsc --noEmit`（本体） エラーなし
- 実データで動作確認：`npx dotenv -e .env.local -- npx tsx tools/canva-instagram/export-person-for-ig.ts "森本慎太郎"` → 標準出力に純粋なJSON（作品3件・VOD・TMDb画像URL）のみが出力されることを確認
- `generate-csv.ts`を直接実行するそれまでの既存フローに影響がないことを確認（`npx tsx tools/canva-instagram/generate-csv.ts "森本慎太郎"`を再実行し、従来どおりCSV/XLSX生成・Downloadsコピーまで動作、検証用に生成したファイルは削除済み）

**変更なし（今回維持）：** DBスキーマ・マイグレーション、既存の管理画面・公開サイトの挙動、`generate-csv.ts`の作品選定ロジック・CSV/XLSX出力内容。

---

## Task 31 — Instagram投稿 管理画面（/admin/instagram-post）新規実装

**目的：** `tools/instagram-post-generator`（CLI版）で動作確認済みのInstagram自動投稿の仕組みを、Cursor/ターミナルを使わずに管理画面だけで完結できるようにする。人物選択→投稿画像3枚生成→プレビュー→キャプション確認→最終確認→Instagram投稿までを`/admin/instagram-post`で提供する。

**設計方針：** CLI版（`tools/instagram-post-generator/`）は独立したサブプロジェクトのため、コードをそのまま`src/`からimportすることはできない（別tsconfig・別node_modules）。CLI版をshell実行するだけの実装は避け、同じロジックを`src/server/instagram-post/`にNext.js向けとして移植し、すべてメモリ上（Buffer）で完結させる設計にした（ローカルディスクへ一切書き込まない。将来Vercelのサーバーレス環境でも動作しやすい構造）。

**新規追加ファイル：**
- `tools/canva-instagram/work-selection.ts`：`generate-csv.ts`から作品選定ロジック（`selectTopWorks`・`buildVodDisplayString`・画像利用可否チェック）のみを副作用なしで切り出した共有モジュール（ロジック変更なし、export化のみ）。`generate-csv.ts`・`export-person-for-ig.ts`の両方がこれを参照するよう更新（重複ロジックを解消）。
- `src/server/instagram-post/`（新規ディレクトリ、すべて`server-only`でクライアントバンドルへの混入を防止）：`config.ts`（環境変数読み込み）、`graph-client.ts`（Instagram API with Instagram Loginクライアント）、`caption.ts`（キャプション・ハッシュタグ生成）、`blob.ts`（Vercel Blobアップロード・人物写真の検索）、`image-prep.ts`（JPEG変換・MIME判定）、`render.ts`（Playwrightで3ページをメモリ上でPNG化。テンプレートは`tools/instagram-post-generator/templates/`をそのまま参照）、`person-data.ts`（`work-selection.ts`経由での実データ取得）、`build-post.ts`（「投稿を作成」の処理本体、Instagram APIは呼ばない）、`publish.ts`（コンテナ作成〜media_publishを1回で実行し成功時にDB記録）。
- `src/lib/instagram-post-store.ts`：投稿成功履歴の読み書き（新設テーブル`instagram_posts`）。
- `src/db/schema.ts`・`src/app/api/admin/db-init/route.ts`・`drizzle/0010_instagram_posts.sql`：`instagram_posts`テーブル新設（既存テーブルへの変更なし、追加のみ）。実際にdb-init経由（今回はスクリプトで直接実行）で本番DBに作成済み。
- `src/app/api/admin/instagram-post/{photo,generate,duplicate-check,publish}/route.ts`：4本の新規APIルート。認証は既存の`src/proxy.ts`のマッチャーにより自動的に効くため追加コードなし。
- `src/app/admin/instagram-post/{page.tsx,InstagramPostClient.tsx,PublishConfirmModal.tsx}`：新規管理画面。人物選択は既存の`PersonCombobox`をそのまま再利用（新しい検索APIは作らず、`getAllPersonsMerged`+`getAllPersonMetasOrThrow`をpage.tsx側でサーバー取得して渡す既存パターンに準拠）。確認モーダルは`VodIntensiveModal.tsx`と同じ見た目・Phase状態管理パターンを踏襲。
- `src/app/admin/AdminLayoutClient.tsx`：ナビに「📸 Instagram投稿」を末尾追加（既存の順序アサーションテストに抵触しないことを確認済み）。

**機能：**
- 人物写真はVercel Blob（`person-photos/{人物名}`、`allowOverwrite:true`で差し替え可能）で管理。ブラウザから直接アップロードでき、CLI版のようにローカルファイルを事前配置する必要がない。
- 「投稿を作成」は画像生成・JPEG変換・Blobアップロード・キャプション生成までを行い、Instagram APIは一切呼ばない。生成後にプレビュー（3枚の画像・順番・使用作品/配信先・キャプション・ハッシュタグ）を表示し、「画像を再生成」で何度でも作り直せる。
- 「Instagramに投稿」は確認モーダルを必ず経由し、モーダル内「投稿する」を押した場合のみコンテナ作成〜`media_publish`を実行する。
- 重複投稿チェックは`instagram_posts`テーブルを参照し、投稿済みでも警告表示のみでブロックはしない（人物切り替え時に自動チェック）。
- エラー（人物写真なし・作品不足・画像URL取得失敗・Blob/Instagram APIエラー）はそれぞれ画面上に日本語で表示し、途中失敗時に自動でInstagram投稿へ進むことはない。

**セキュリティ：** `IG_ACCESS_TOKEN`・`BLOB_READ_WRITE_TOKEN`・`DATABASE_URL`はすべて`server-only`ファイル内でのみ読み込み、APIレスポンス・画面・ログに一切出力していない。Instagram/Blob/DBへの処理はすべてサーバー側（Route Handler）で実行し、ブラウザには結果（画像URL・キャプション・media_id等）のみを返す。

**動作確認（実データ・実インフラで確認、`media_publish`は未実行）：**
- `npx tsc --noEmit` エラーなし
- `npm run build` 成功（`/admin/instagram-post`・新規APIルート4本を含め全ルートビルド成功）
- `npx vitest run src/app/admin/__tests__/AdminLayoutClient.test.ts` 8件全通過（ナビ追加による既存アサーション破壊なし）
- ローカルであらためて`ADMIN_SESSION_SECRET`が未設定だったことが判明（管理画面ログイン自体が以前から不可能な状態だった、既存の別問題）。動作確認のためランダム値を生成し`.env.local`に追記（既存の値は一切変更していない）。
- 実際にログイン→`/admin/instagram-post`が200で表示されることを確認
- 森本慎太郎で実際に人物写真をアップロード（Blobへ保存・公開URL取得を確認）→重複チェック（未投稿と正しく判定）→「投稿を作成」相当のAPIを実行し、実データ（アイシー～瞬間記憶捜査・柊班～/FOD、良いこと悪いこと/Hulu、正体/Netflix・U-NEXT）を使って3枚の投稿画像を生成・Blobへアップロード・キャプション生成まで成功、3枚とも公開URLで取得可能なことを確認、目視でも1〜3枚目のデザイン（人物写真・作品一覧・プロフィールページスクリーンショット）が正しいことを確認
- `media_publish`の実行・投稿確認モーダルの「投稿する」操作は今回一切行っていない

**変更なし（今回維持）：** 既存の管理画面・公開サイトの挙動、既存DBスキーマ・データ、`tools/instagram-post-generator`（CLI版）のコード・動作。commit/push/deployは未実施。

---

## Task 32 — Instagram投稿管理画面：本番デプロイ前レビュー（テンプレート参照方式の修正、ブラウザ動作確認）

**目的：** Task31実装後、本番（Vercel）デプロイ前の最終確認として、ブラウザでの一連の動作確認と、Vercelサーバーレス実行時の既知リスク（`src/server/instagram-post/render.ts`が`tools/instagram-post-generator/templates/`をfs経由で参照していた点）の解消を行う。

**修正内容：**
- `src/server/instagram-post/templates/{page1,page2,page3,styles}.ts`（新規）：CLI版のHTML/CSSをそのままTS文字列定数としてコピー（内容は完全一致、生成はNode一回限りのスクリプトで機械的にコピー）。
- `render.ts`：`fs.readFileSync(TEMPLATES_DIR, ...)`による実行時ファイル読み込みを廃止し、上記の定数を通常の`import`で参照する方式に変更。これによりテンプレートは通常のJS/TSモジュールとしてバンドルされ、`outputFileTracingIncludes`等のNext.jsのファイルトレース設定に依存せずVercelのサーバーレス関数に確実に含まれるようになった。
- CLI版（`tools/instagram-post-generator/scripts/render.ts`）は無変更（今後も自身の`templates/*.html`をfs経由で読む従来方式のまま）。テンプレートの見た目を変更する場合、今後はCLI版のHTML/CSSを更新した上でこの新しいTSファイル群にも反映する必要がある（自動同期の仕組みはまだ無い旨をコード内コメントに明記）。

**ブラウザでの動作確認（実際にPlaywrightで操作、`media_publish`は未実行）：**
1. `/admin/login`にアクセスし、実際のログインフォームからログイン成功を確認
2. `/admin/instagram-post`が正しく表示されることを確認
3. 人物検索で「森本慎太郎」を選択（写真・重複チェックが正常に走ることを確認）
4. 「投稿を作成」を実行し、実データで3枚の画像・作品名・配信サービス・キャプション・ハッシュタグが正しく表示されることを確認
5. 「画像を再生成」を実行し、正常に再生成されることを確認
6. 「Instagramに投稿」→確認モーダルが表示されることを確認
7. モーダルの「投稿する」は押さず、「キャンセル」で終了

**秘密情報の非漏洩確認：** ログイン後に取得した`/admin/instagram-post`のHTML全文と、そのページが読み込む全19本のクライアントJSバンドルに対し、`IG_ACCESS_TOKEN`・`BLOB_READ_WRITE_TOKEN`・`DATABASE_URL`・`ADMIN_SESSION_SECRET`の実際の値（`.env.local`から直接読み取り、ターミナル出力には一切表示せず）がそれぞれ含まれていないことを機械的に検証。4件とも非該当（漏洩なし）。

**Vercel本番環境で問題になりうる点として新たに判明（未修正・要フォローアップ）：** `render.ts`が使うPlaywrightの標準`playwright`パッケージは、フルサイズのChromiumバイナリ（280MB超）を同梱するため、Vercelサーバーレス関数の圧縮後50MBというサイズ上限を超える可能性が高い（一般的な既知の制約。`@sparticuz/chromium`+`playwright-core`等の軽量版チェコンポーネントへの置き換えが標準的な対応）。今回は実デプロイ・実機検証ができない（本タスクではデプロイ禁止）ため、コードの置き換えは行っていない。デプロイ前に別途対応が必要。

**動作確認（テスト）：**
- `npx tsc --noEmit` エラーなし
- `npm run build` 成功
- ローカルで`.next`キャッシュに起因する無関係な型エラー（`.next/types/`内の重複識別子エラー）が一時的に出たが、`.next`削除で解消（コード起因ではないことを確認）

**変更なし（今回維持）：** `tools/instagram-post-generator`（CLI版）のコード・テンプレートファイル本体。commit/push/deployは未実施。

---

## Task 33 — Instagram投稿管理画面：「Unexpected token '<'」バグ修正とVercel実機デバッグ

**目的：** Preview環境で発生した「Unexpected token '<', "<!DOCTYPE "... is not valid JSON」エラーの原因特定・修正。あわせてVercel実機（Preview）で`/api/admin/instagram-post/generate`を実際に動かし、本番デプロイ可否を判断する。

**原因（実際にVercel Function Logsを取得して特定。推測ではない）：** `sharp`（0.35.4）のネイティブバイナリ読み込みが`ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6: cannot open shared object file`で失敗し、`/api/admin/instagram-post/photo`がモジュール読み込み時にクラッシュしてNext.jsのエラーページ（HTML）を返していた。クライアント側が`response.json()`を無条件に呼んでいたため「Unexpected token '<'」として画面に表面化していた。`sharp 0.35.x`がlibvipsを別パッケージに分離した際、Next.jsのファイルトレース（`@vercel/nft`）が`dlopen()`経由の参照を検出できないという既知の不具合（`vercel/next.js` issue、`lovell/sharp` issue多数で報告済み）。

**修正内容：**
1. `src/server/instagram-post/mime-detect.ts`（新規）：`detectImageMimeType`をsharpに依存しない形で分離。`/api/admin/instagram-post/photo`のGETハンドラ（写真確認のみ、本来sharpを一切使わない）が巻き添えでsharpを読み込まないようにした。
2. `package.json`：`sharp`を`^0.35.4`→`^0.34.5`へダウングレード（既知の不具合を回避する、公式に確認されている最も確実な対処）。
3. `next.config.ts`：`serverExternalPackages`に`sharp`を追加（念のための対策。実際の直接原因は上記1・2）。
4. `src/app/admin/instagram-post/safe-fetch-json.ts`（新規）：Content-Type確認後にJSONを読む共通fetchヘルパー。`InstagramPostClient.tsx`・`PublishConfirmModal.tsx`の全fetch呼び出しをこれに置き換え、サーバー側が万一クラッシュしてHTMLを返した場合でも分かりやすい日本語エラーになるようにした（クライアント側の防御的実装、要件4）。
5. API側のエラーは元々JSON＋適切なステータスで返す設計になっていたことを確認（`try/catch`で`NextResponse.json({error,...}, {status})`、要件5は元々満たしていた）。人物写真未登録も元々エラー扱いせず`{photoUrl: null}`を200で返す設計だったことを確認（要件6）。

**Vercel実機での追加検証（Preview環境、`vercel deploy`でpreviewデプロイ→`vercel curl`でDeployment Protectionを回避しつつ実際にAPIを叩いて確認。media_publishは一切呼んでいない）：**
- 修正後、`/api/admin/instagram-post/photo`が正しくJSONを返すことを確認（500クラッシュ解消）。
- `/api/admin/instagram-post/generate`を実行したところ、**新たに2つの問題を発見**：
  a) `playwright-core/lib/coreBundle.js`が参照する`playwright-core/browsers.json`をNext.jsのファイルトレースが検出できず「Cannot find module」で失敗 → `next.config.ts`に`outputFileTracingIncludes`で明示的に追加し解消（Next.js公式ドキュメントが「ネイティブ/ランタイム資産の一般的な含め方」として明記している方式）。
  b) `capturePersonPageScreenshot`と`renderPostImages`がそれぞれ個別に`launchBrowser()`していたため、コールドスタート時に`@sparticuz/chromium-min`のChromiumパック取得（GitHub Releasesからのダウンロード・展開、約64MB）が2回走り、300秒の`maxDuration`を超えてタイムアウトしていた → `build-post.ts`でブラウザを1回だけ起動し、`render.ts`の両関数に共有する設計に変更（`renderPostImages`/`capturePersonPageScreenshot`のシグネチャを`(browser, ...)`に変更）。この修正により、実際にChromiumが起動するところまで到達することを確認（`<launching> /tmp/chromium ...`のログを実機で確認）。
- `maxDuration`を120→300秒に引き上げ（コールドスタート時のChromiumパック取得を考慮）。
- `vercel.json`にfunctions設定を追加し、`/api/admin/instagram-post/generate`のメモリを引き上げようとしたが、**このプロジェクトがVercel Hobbyプラン（個人アカウント）であり、メモリは2048MBが上限**であることが判明（3009MB指定でデプロイ拒否）。2048MBに修正して再デプロイ。

**現時点で未解決（本番デプロイ前に対応が必要）：** 上記の対策後も、`/api/admin/instagram-post/generate`をVercel実機で実行すると、次のいずれかで失敗することを確認：
- Chromium起動直後に`Target page, context or browser has been closed`（ブラウザプロセスがクラッシュしている可能性）
- 別の実行では300秒でタイムアウト（`FUNCTION_INVOCATION_TIMEOUT`）
これは`@sparticuz/chromium-min` + `playwright-core` + Vercel Hobbyプランの制約下での深い互換性問題であり、原因を継続調査中（メモリ上限2048MBでは実行中のChromium+Node.jsに対して依然として不足している可能性、`chromium-min`バージョンとplaywright-coreのプロトコル不整合の可能性、本番サイトへのスクリーンショット取得時のネットワーク到達性の可能性など、複数の仮説が残っている）。今回はここで一旦区切り、ユーザーに状況を報告して次の対応方針を確認する。

**動作確認：**
- `npx tsc --noEmit` エラーなし
- `npm run build` 成功
- ローカルでの生成フロー（`/api/admin/instagram-post/generate`）は全修正後も引き続き正常動作を確認（sharp・単一ブラウザ化のいずれの変更後も、3枚生成・作品3件を確認）
- `media_publish`は一切実行していない。Productionへのデプロイは行っていない。commit/pushは行っていない。

**変更なし（今回維持）：** `tools/instagram-post-generator`（CLI版）、Instagram API処理・Vercel Blob処理のロジック、投稿画像のデザイン・内容、DBの既存データ。

---

## Task 34 — Instagram投稿管理画面：Playwright/Chromium依存を完全撤去（next/og方式へ全面移行）

**目的：** Task33で発覚したVercel Hobby環境でのPlaywright/Chromiumの不安定さ（コールドスタート・メモリ・タイムアウト）を根本的に解消するため、`/admin/instagram-post`の画像生成からPlaywright/Chromiumへの依存を完全に排除する。

**採用した方式：** `next/og`の`ImageResponse`（内部でSatori+Resvgを使用、Vercel公式のOG画像生成の仕組み）。ヘッドレスブラウザを一切起動せず、JSXツリーから直接PNGを生成する。Sharp単体・SVG手書き・Satoriを比較し、Satori/ImageResponseがflexbox・box-shadow・border-radius・filter:blur・gradient・line-clampまで幅広くサポートしており、既存デザインをほぼそのまま再現できると判断して採用した。

**新規追加ファイル：**
- `src/server/instagram-post/og-elements.tsx`：3枚それぞれのJSX要素定義（Decorations共通コンポーネント含む）。
- `src/server/instagram-post/og-render.tsx`：`ImageResponse`でJSX→PNG Bufferへ変換する処理。
- `src/server/instagram-post/fonts/NotoSansCJKjp-Bold.otf`（約17MB）・`fonts/font-loader.ts`：Satoriに渡す日本語フォント。当初`@fontsource/noto-sans-jp`の日本語サブセット（約1.4MB、Base64埋め込み）を使ったが、実データで「アイシー～瞬間記憶捜査・柊班～」をレンダリングしたところ波ダッシュ（～）のグリフが欠落する不具合を実際に発見したため、記号・句読点を含め網羅的にカバーするフルセットのNoto Sans CJK JPに切り替えた。

**3枚の生成方法（変更点）：**
- 1枚目（人物写真）・2枚目（作品・配信サービス）：見た目はHTML/CSS版とほぼ同一のまま、JSXで再構築。
- 3枚目：**実際のWebページのスクリーンショットをやめ、専用テンプレートに変更**。人物名（タイトルに含める）・「推しサーチ」ワードマーク（ブランドラベル＋写真上のオーバーレイ帯の2箇所）・人物写真・CTAボタン（`cta-button3`と同一デザイン「プロフィールから『推しサーチ』へ」）で構成。Playwrightでの本番サイトアクセスは一切行わない。

**削除したファイル・依存：**
- `src/server/instagram-post/render.ts`（Playwrightでのレンダリング）・`browser.ts`（Chromium起動切り替え）・`templates/*.ts`（HTML/CSSのBase64埋め込み）：いずれも削除。
- `package.json`から`playwright-core`・`@sparticuz/chromium-min`を削除。`playwright`本体は`tools/canva-instagram/generate-csv.ts`（本タスクとは無関係な既存のCanva一括作成ツール、ルートのnode_modulesを共有）が引き続き使用しているため再インストールして維持した（Instagram投稿のVercel Functionからは一切参照されないことをファイルトレースで確認済み）。
- `next.config.ts`：Playwright/Chromium関連の`serverExternalPackages`・`outputFileTracingIncludes`を削除し、日本語フォントファイル用の`outputFileTracingIncludes`に置き換え。
- `vercel.json`：Chromium対策で追加していたメモリ・maxDuration上書き設定を削除（デフォルトに戻した）。
- `generate/route.ts`の`maxDuration`：300秒→60秒に縮小。

**実装中に発見・修正したSatoriの不具合：** `top: undefined`のようにキー自体は存在するが値がundefinedのCSSプロパティをstyleオブジェクトに含めると、Satori内部で「Cannot read properties of undefined (reading 'trim')」というエラーになることを実機デバッグで特定した（`@vercel/og`の圧縮バンドルコードをスタックトレースで直接追い、`tsx`で最小再現コードを作って原因を切り分けた）。装飾用の背景円・ドットの位置指定（top/bottom/left/right）で、値が未指定の軸も含めて全プロパティを書き込んでいたことが原因。`pickDefined()`ヘルパーで値がundefinedのキー自体を除去することで解決した。

**動作確認（ローカル・Vercel Preview実機の両方、`media_publish`は一切実行していない）：**
- `npx tsc --noEmit` エラーなし
- `npm run build` 成功。`generate`ルートの成果物にPlaywright/Chromium関連ファイルが1件も含まれないことをファイルトレース（`.nft.json`）で確認（トレース済み合計サイズ約37.7MB、Vercel上限50MB以内）
- ローカルで森本慎太郎の3枚生成 → 約5.4秒で完了（Playwright版は約15秒、Vercel実機でのChromium版は数分〜タイムアウトだったため大幅改善）。1〜3枚目とも目視でデザイン確認済み（3枚目は新デザイン、人物名・ブランドラベル・CTA全て表示）
- Vercel Preview環境（`vercel deploy`でpreviewデプロイ、`vercel curl`でDeployment Protectionを回避しつつ実行）で同じ人物の3枚生成を実行 → **約12秒で成功**（コールドスタートを含む）。3枚ともVercel Blobへのアップロード・公開URL取得・JSON応答（画像URL・作品一覧・キャプション・ハッシュタグ）まで正常に確認。生成された画像をダウンロードし、ローカル生成分と同じ見た目であることを目視確認
- `npx tsc --noEmit`（Canva一括作成ツールを含む全体）でも`playwright`再インストール後にエラーがないことを確認
- 確認モーダル（`PublishConfirmModal`）はクライアント側のみで動作し、追加のAPI呼び出しは発生しないため、`generate`の成功のみで表示可能なことをコードレベルで確認（実際に「投稿する」を押す操作はテストしていない）

**残る留意点：** ファイルトレース合計サイズが約37.7MB（上限50MBの約75%）と、以前（Playwright版が正しく動く前提だった頃の約23MB）より増えている。主要因は日本語フォント（約17MB）。今後sharpや他の依存が増えた場合は上限に近づく可能性があるため、必要であれば日本語フォントをJIS第一水準相当などへサブセット化してサイズを抑える余地がある（今回は実施していない）。

**変更なし（今回維持）：** `tools/instagram-post-generator`（CLI版、独立したサブプロジェクトのため無関係）、Instagram API処理・Vercel Blob処理のロジック、DBの既存データ。Productionへのデプロイ・commit/pushは行っていない。

---

## Task 35 — Instagram予約投稿・自動投稿機能の基盤を新規追加

**目的：** 既存の手動投稿機能（`/admin/instagram-post`、都度「投稿する」を押す方式）に加え、複数人物・複数日時をあらかじめまとめて予約しておき、指定日時になったらVercel Cron経由で自動的にInstagramへ公開する「予約投稿基盤」を新設する。既存の手動投稿機能・生成デザイン・Instagram API/DB/Vercel Blobの既存ロジックは一切変更しない。

**設計方針（安全性優先）：** 「予約時に画像・キャプションを完成させてDBに保存」する方式を採用。人物選択→3枚生成→Blobアップロード→キャプション/ハッシュタグ生成→プレビュー→日時指定→予約、までを予約登録の時点で完了させる。Cron実行時は保存済みのimageUrls/captionをそのまま使いInstagram APIへ公開するだけで、画像の再生成は一切行わない（自動投稿時の失敗率低減が目的）。

**新規追加ファイル：**
- `src/db/schema.ts`：`instagramPostSchedules`テーブルを追加（既存テーブルは無変更）。
- `drizzle/0011_instagram_post_schedules.sql`：上記のマイグレーションSQL（記録用。本番適用は`/api/admin/db-init`経由）。
- `src/app/api/admin/db-init/route.ts`：`instagram_post_schedules`のCREATE TABLE/INDEXとTABLE_NAMESへの登録を追加（既存のCREATE/ALTER文には一切触れていない）。
- `src/lib/instagram-templates.ts`：テンプレートのメタデータ一覧（id・label・requiresPersonPhoto）。クライアント/サーバー双方から参照する非server-onlyの純粋データ。現時点では`default-person`のみ実装。将来`works-only`等の写真不要テンプレートを追加する際はここに1件追加するだけでよい構造にした。
- `src/lib/jst-time.ts`：Asia/Tokyo（UTC+9固定・夏時間なし）の壁時計時刻⇔UTC Dateの相互変換ヘルパー。サーバー・ブラウザのシステムタイムゾーンに依存しないよう、明示的な`+09:00`オフセットで変換する。
- `src/server/instagram-schedule/prepare.ts`：予約登録前の内容確定処理。テンプレートが`default-person`の場合は既存の`buildInstagramPost`（`src/server/instagram-post/build-post.ts`、無変更）をそのまま呼び出すだけの薄いラッパー。将来のテンプレート追加時はここに分岐を増やす。
- `src/server/instagram-schedule/schedule-store.ts`：予約のCRUD、および二重投稿防止の要となる「条件付きUPDATE1本によるatomic claim」（`claimDueSchedule`）を実装。
- `src/app/api/admin/instagram-schedule/prepare/route.ts`（POST）・`route.ts`（GET一覧／POST予約作成）・`[id]/cancel/route.ts`（POST）・`[id]/retry/route.ts`（POST）：管理画面用API。認証は既存の`src/proxy.ts`が`/api/admin/*`に対して自動的に適用するため、各ルートに個別の認証コードは追加していない。
- `src/app/api/cron/instagram-publish/route.ts`：Vercel Cronから呼び出す自動公開API。既存cronルート（`vod-refresh`等）と同じ`Authorization: Bearer {CRON_SECRET}`方式。`?dryRun=1`で「claimまでは本番と同じ経路を通るが、Instagram APIは呼ばず即座にscheduledへ戻す」検証専用モードを実装。
- `src/app/admin/instagram-schedule/page.tsx`・`InstagramScheduleClient.tsx`・`ScheduleList.tsx`・`safe-fetch-json.ts`：予約投稿の管理画面（人物・テンプレート選択、生成、プレビュー、日時指定、予約、一覧・キャンセル・再実行）。

**変更したファイル：**
- `src/app/admin/AdminLayoutClient.tsx`：ナビに「📅 Instagram予約」（`/admin/instagram-schedule`）を追加。

**二重投稿防止の仕組み：** `claimDueSchedule(id)`は`UPDATE instagram_post_schedules SET status='processing' WHERE id=$1 AND status='scheduled'`という条件付きUPDATE1本のみで実現している（`drizzle-orm/neon-http`は`db.transaction()`未対応のため、トランザクションではなくUPDATE自体の原子性に依拠）。実際に2つのCron呼び出しを完全に同時実行し、片方が`processing`へ遷移して実際の投稿処理に進み、もう片方は対象行が見つからず`skipped-already-claimed`になることを実機で確認した。

**発生した問題と対応（正直に記録）：** 二重実行防止の検証中、2回目の同時実行テストで`?dryRun=1`を付け忘れ、`.env.local`に実際に設定されていた本物の`IG_ACCESS_TOKEN`を使って実際にInstagram Graph APIへ1回だけ本番相当のリクエスト（テスト用のダミー画像URL `https://example.com/test1.jpg` によるカルーセル子コンテナ作成）を送ってしまった。Meta側が画像として無効と判定して即座に拒否したため、コンテナは作成されず`media_publish`にも到達せず、実際の投稿は一切発生していない。以後の検証はすべて`?dryRun=1`で実施し、混入したテスト用DB行はすべて削除済み。今後同種の検証を行う際は、ローカルの`.env.local`に本物の`IG_ACCESS_TOKEN`/`IG_USER_ID`が入っている状態であることを踏まえ、必ず`dryRun=1`を付けるか、事前に環境変数を一時的に外して検証すること。

**Vercel Cronの利用可否（現在のプランを変更せず調査）：** このプロジェクトはVercel Hobbyプラン（過去のFunctionメモリ上限2048MBの制約から確認済み）。2026年1月の仕様変更により、Hobbyプランでも1プロジェクトあたり最大100件のCron Jobを設定可能（以前の上限5件から緩和）。ただし各Cron Job単体は「1日1回まで」の頻度制限があり、実行時刻の精度も「その時刻から1時間以内」という保証に留まる。この制約下で「1日3投稿（例: 09:00/15:00/20:00 JST）」を実現するには、1つのCron設定で複数時刻を賄うのではなく、**独立した3つのCron Job**（例: `0 0 * * *`=09:00 JST、`0 6 * * *`=15:00 JST、`0 11 * * *`=20:00 JST 相当のUTC時刻）を`vercel.json`に登録する案を提案した。各ジョブは「1日1回」の制限を満たしつつ、実行のたびに「現在時刻以前でstatus=scheduledな予約」をすべて処理するため、想定される時刻誤差は最大で約1時間。今回はユーザーへの報告を優先し、`vercel.json`への実際のcrons追加はまだ行っていない。

**動作確認（ローカル、`media_publish`は実行していない。上記の1回の例外を除く）：**
- `npx tsc --noEmit` エラーなし（`.next/types`の破損した重複型定義ファイルを削除して解消。今回の変更とは無関係）
- `npm run build` 成功。`/admin/instagram-schedule`・`/api/admin/instagram-schedule`・`/api/admin/instagram-schedule/[id]/cancel`・`/api/admin/instagram-schedule/[id]/retry`・`/api/admin/instagram-schedule/prepare`・`/api/cron/instagram-publish`すべてビルド成果物に登録されていることを確認
- `/api/admin/db-init`（POST）で`instagram_post_schedules`テーブルを作成（`CREATE TABLE IF NOT EXISTS`、既存テーブルへの影響なし）
- 森本慎太郎で予約作成→一覧表示→キャンセル→再キャンセル拒否（409）を確認
- 過去日時での予約作成が400で拒否されることを確認（サーバー側バリデーション）
- failed状態の予約を直接DBに投入し、`/retry`でscheduledへ復帰→再度の`/retry`が409で拒否されることを確認
- Cronの認証チェック（CRON_SECRET未設定時503、誤った値で401、正しい値で200）を確認（ローカル用に`.env.local`へ開発専用のCRON_SECRETを追記。Production/Previewの値とは別物）
- `listDueScheduleIds`が「未来の予約」を含めず「過去に予約された行」のみを対象にすることを確認
- `?dryRun=1`でclaim→即座にscheduledへ戻す一連の動作を確認
- 実際に2つのCron呼び出しを完全同時実行し、二重実行防止（片方はprocessing→実処理、もう片方はskipped-already-claimed）を確認
- `jstWallClockToUtcDate`/`formatJst`の変換が正しいこと（2026-09-22 09:00 JST → 2026-09-22T00:00:00.000Z UTC）を確認
- 既存の`/admin/instagram-post`・`/api/admin/instagram-post/photo`・`/api/admin/instagram-post/duplicate-check`が引き続き正常動作することを確認（壊れていない）

**残っている作業：** `vercel.json`へのcrons追加（ユーザー承認待ち）、写真不要テンプレート（works-only等）の実装、「毎日3枠」の一括予約UI、Production環境への`IG_ACCESS_TOKEN`/`IG_USER_ID`の追加（Task34時点から引き続き未設定）。

**変更なし（今回維持）：** `/admin/instagram-post`（手動投稿機能）、`src/server/instagram-post/`配下の生成ロジック・Instagram API・Vercel Blob処理、既存DBデータ。Productionへのデプロイ・commit/pushは行っていない。

---

## Task 36 — Instagram予約投稿：本番投入前の安全性強化（ハードガード・バッチ処理・自動再試行）

**目的：** Task35で構築した予約投稿基盤について、Production投入前の安全性レビューを受けて以下を強化する。(1) 自動投稿の実行可否を環境変数で明示的に制御するハードガードの追加、(2) Cron1回あたり最大5件までのバッチ処理、(3) failed（attempts<3）の自動再試行、(4) media_publish呼び出し自体の失敗を「公開済みか不明」として安全に分離するneeds_review状態の追加。

**1. Production環境変数の再確認（値は非表示、名前の存在のみ）：** `vercel env ls production`で確認したところ、`IG_ACCESS_TOKEN`・`IG_USER_ID`は共に**既にProductionへ設定済み**（約1時間前に追加）であることを確認した。再登録・変更は一切行っていない。`CRON_SECRET`も既にProduction/Previewへ設定済み（105日前から）であることを確認した。

**2. `INSTAGRAM_AUTOPUBLISH_ENABLED`ハードガード：** `src/server/instagram-post/config.ts`に`isAutopublishEnabled()`を追加（既存のエクスポートは無変更）。`src/app/api/cron/instagram-publish/route.ts`で、`dryRun`でない実publish経路は、この関数が`true`を返さない限り**DBのclaimにすら進まず**即座に`{guarded:true, dueCount}`を返して停止するようにした。手動投稿（`/admin/instagram-post`）はこのフラグの影響を受けない。

**3. `src/server/instagram-schedule/publish-schedule.ts`（新規）：** 既存の`src/server/instagram-post/publish.ts`（手動投稿用、無変更）とは別に、予約投稿専用のカルーセル作成〜media_publish処理を実装。`media_publish`呼び出し自体が失敗した場合のみ`AmbiguousPublishError`として区別し、それ以前の失敗とは異なる扱いにする（Instagram側で実際に公開が完了している可能性を否定できないため）。

**4. `schedule-store.ts`の拡張：**
- `ScheduleStatus`に`needs_review`を追加（`media_publish`呼び出し自体の失敗専用。dueConditionのOR条件に含めていないため、Cronからは自動的に無視され続ける＝二重投稿を絶対に起こさない）。
- `dueCondition()`: `scheduled_at<=now() AND media_id IS NULL AND (status='scheduled' OR (status='failed' AND attempts<3))`。`listDueScheduleIds(limit)`・`claimDueSchedule(id)`の両方がこの同一条件を使う（クエリとUPDATEの条件が食い違わないようにするため）。
- `listDueScheduleIds`に`limit`引数を追加（Cronルームは`CRON_BATCH_LIMIT=5`を渡す）。
- `markNeedsReview()`を追加。`cancelSchedule`のキャンセル可能ステータスに`needs_review`を追加（Instagram側を確認した上でのキャンセルを許可するため）。`retrySchedule`は`failed`のみ再実行可（`needs_review`は対象外のまま）。

**5. Cronルートの書き換え：** バッチ処理（最大5件）、ハードガード、`publishScheduleToInstagram`への切り替え、`AmbiguousPublishError`時の`needs_review`遷移を実装。

**6. 管理画面（`InstagramScheduleClient.tsx`・`ScheduleList.tsx`）：** 「おすすめ投稿時間」として09:00/15:00/20:00のワンクリック選択ボタンを追加。おすすめ以外の時刻を選んだ場合は「HobbyプランではCronが1日3回のため、自由時刻を指定すると次回のCron実行時（最大約1時間の誤差あり）に投稿されます」と注意書きを表示。常時「実際の投稿時刻は指定時刻から最大約1時間ずれる場合があります」も表示。一覧に`needs_review`（要確認、オレンジ色）のステータス表示を追加し、再実行ボタンは表示せずキャンセルのみ許可。

**Vercel Cron設定案（`vercel.json`へはまだ反映していない）：**
```json
{ "path": "/api/cron/instagram-publish", "schedule": "0 0 * * *" },  // 09:00 JST
{ "path": "/api/cron/instagram-publish", "schedule": "0 6 * * *" },  // 15:00 JST
{ "path": "/api/cron/instagram-publish", "schedule": "0 11 * * *" } // 20:00 JST
```
各エントリは「1日1回」というHobbyプランの制限を個別に満たす。実行時刻の精度はVercelの仕様上「指定時刻から1時間以内」。

**動作確認（すべてdry-run・DB直接操作・モック不要の安全な方法のみ。Instagram Graph APIへの実リクエストは一切送信していない）：**
- `npx tsc --noEmit` エラーなし／`npm run build` 成功
- `INSTAGRAM_AUTOPUBLISH_ENABLED`未設定の状態で実publish経路（`dryRun`なし）を呼び出し、`{guarded:true}`が返り、DB側の対象行が一切変更されていない（claimすら発生しない）ことを確認
- `dryRun=1`はガード無効時でも引き続き動作することを確認（API書き込みを伴わないため）
- 7件の期限到来済み予約を用意し、1回のCron呼び出しで予定日時の古い順に5件のみ処理されることを確認
- `claimDueSchedule()`を同一IDに対して完全並列に2回直接呼び出し、片方だけが`processing`を獲得し、もう片方が`null`になることを確認（HTTP層を介さない、最も直接的な二重取得防止の証明）
- `attempts=3`の`failed`行、`media_id`が入っている`failed`行を用意し、`listDueScheduleIds`が両方とも除外することを確認。`claimDueSchedule`で直接claimを試みても両方とも`null`になることを確認（クエリ層とUPDATE層の両方で二重に安全策が効いていることを確認）
- 予約登録→キャンセルが引き続き正常動作することを確認
- 09:00/15:00/20:00 JSTがそれぞれ00:00/06:00/11:00 UTCに正しく変換されることを確認
- 既存の`/admin/instagram-post`・`/admin/instagram-schedule`・`/api/admin/instagram-post/photo`が引き続き正常動作することを確認
- テスト用に投入したDB行はすべて削除済み（`instagram_post_schedules`は0件の状態で終了）

**残っている作業：** `vercel.json`へのcrons反映（ユーザー承認待ち）、写真不要テンプレートの実装、「毎日3枠」一括予約UI。

**変更なし（今回維持）：** `/admin/instagram-post`（手動投稿機能）・`src/server/instagram-post/publish.ts`（無変更、手動投稿専用として維持）・生成ロジック・DBの既存データ。Productionへのデプロイ・commit/push・Instagramへの実投稿は一切行っていない。

---

## Task 37 — 管理画面にInstagram管理ハブページを追加（ナビ導線の整理）

**目的：** `/admin/instagram-post`・`/admin/instagram-schedule`をURL直接入力なしで、管理画面ナビからクリックだけで辿れるようにする。

**新規追加：** `src/app/admin/instagram/page.tsx`（Instagram管理ハブ）。「Instagram投稿を作成」「Instagram予約投稿」「人物写真を登録・確認」の3枚のカードを配置。カード定義は配列（`CARDS`）で管理しており、将来人物写真専用ページ（例: `/admin/instagram-photos`）を追加する際はhrefを差し替えるだけで済む構造にした。レイアウトは既存の管理画面と同じTailwindクラス（`bg-white border border-gray-200 rounded-xl`等）を踏襲し、`grid-cols-1 sm:grid-cols-3`でスマホ幅では縦積みになる。

**変更：**
- `src/app/admin/AdminLayoutClient.tsx`：ナビの個別リンク「📸 Instagram投稿」「📅 Instagram予約」を削除し、「写真集管理」の直後に単一の「📸 Instagram管理」（`/admin/instagram`）を追加。目的（ナビ→ハブ→各機能という一本の動線に揃える）に沿って意図的に統合した。
- `src/app/admin/instagram-post/page.tsx`・`src/app/admin/instagram-schedule/page.tsx`：ページ先頭に「← Instagram管理へ戻る」リンク（`/admin/instagram`）を追加。クライアントコンポーネント本体（`InstagramPostClient`・`InstagramScheduleClient`）には触れていない。

**動作確認：**
- `npx tsc --noEmit` エラーなし／`npm run build` 成功。`/admin/instagram`が静的ページとしてビルドされることを確認
- ローカルでログイン後、ナビに「Instagram管理」が1件だけ表示され、旧来の個別2リンクが消えていることを確認
- `/admin/instagram`が200で表示され、3枚のカードがそれぞれ`/admin/instagram-post`・`/admin/instagram-schedule`・（人物写真は当面`/admin/instagram-post`）へのリンクを持つことを確認
- `/admin/instagram-post`・`/admin/instagram-schedule`双方に「Instagram管理へ戻る」リンクが表示されることを確認
- 既存の`InstagramPostClient`・`InstagramScheduleClient`の機能（生成・予約・一覧等）には一切手を加えていない

**変更なし（今回維持）：** Instagram投稿・予約投稿の生成ロジック・API・DB。Instagramへの実投稿は行っていない。

---

## Task 38 — Instagram予約投稿：複数人物一括予約機能を追加（ローカル検証まで）

**目的：** `/admin/instagram-schedule`に、複数人物を選択して1日3枠（09:00/15:00/20:00 JST）へ自動配置し、まとめて予約できる「一括予約」モードを追加する。既存の1件ずつの予約（通常予約）・Cron・Atomic Claim・`INSTAGRAM_AUTOPUBLISH_ENABLED`ガードには一切手を加えない。作業開始前に、既存予約（id=27, 松村北斗, 2026-09-22 09:00, scheduled）の存在を確認済み。

**新規追加：**
- `src/app/admin/instagram-schedule/PersonMultiSelect.tsx`：検索欄＋チェックボックスによる複数選択＋選択済み人物の並び替え（↑↓ボタン）。投稿済み人物には「投稿済み」バッジを表示するが選択自体は禁止しない。
- `src/app/admin/instagram-schedule/BulkScheduleClient.tsx`：一括予約UI本体（人物複数選択→開始日・テンプレート選択→自動配置プレビュー→一括生成→プレビュー確認（除外/再生成）→確認モーダル→一括予約）。
- `src/app/api/admin/instagram-schedule/occupied-slots/route.ts`（GET）：今後N日分の「埋まっている」予定日時一覧（cancelled以外）を返す。
- `src/app/api/admin/instagram-schedule/posted-persons/route.ts`（GET）：Instagramへ投稿済みの人物名一覧。
- `src/app/api/admin/instagram-schedule/bulk/route.ts`（POST）：一括予約の確定登録専用エンドポイント（画像生成・Instagram APIアクセスは一切行わない）。

**変更（いずれも既存関数は無変更、追記のみ）：**
- `src/lib/jst-time.ts`：`allocateBulkSlots()`（純粋関数、DBアクセスなし）を追加。開始日から1日3枠を古い順に走査し、渡された`occupiedIsoSet`に含まれる枠をスキップして人物を順番に割り当てる。クライアントのライブプレビューとサーバー側の空き枠取得の両方から同じロジックを使う。
- `src/server/instagram-schedule/schedule-store.ts`：`listOccupiedSlotIsos()`・`createSchedulesBatch()`・`SlotConflictError`を追加。`claimDueSchedule`・`dueCondition`・`listDueScheduleIds`・`markPublished`・`markFailed`・`markNeedsReview`・`cancelSchedule`・`retrySchedule`は1文字も変更していない（import文への`gte`/`ne`追加のみが既存コード領域への変更）。
- `src/lib/instagram-post-store.ts`：`listPostedPersonNames()`を追加。既存の`recordInstagramPost`等は無変更。
- `src/app/admin/instagram-schedule/InstagramScheduleClient.tsx`：「通常予約 / 一括予約」タブを追加し、既存の単発予約UI（人物選択〜生成〜プレビュー〜予約）はそのまま`mode==='single'`の分岐内に温存。`?mode=bulk`をURLで指定すると一括予約タブを直接開く。予約一覧（`ScheduleList`）は両モード共通で表示。
- `src/app/admin/instagram/page.tsx`：ハブページに「一括予約」カードを追加（リンク先`/admin/instagram-schedule?mode=bulk`）。カード数が4枚になったためグリッドを`sm:grid-cols-2 lg:grid-cols-4`に調整。

**空き枠割当の安全性：** 一括予約の確定登録（`createSchedulesBatch`）は、(1)渡されたリスト内の日時重複チェック、(2)DB上で該当日時が非cancelled状態で既に埋まっていないかの直前再確認、を行い、1件でも問題があればDBへ一切書き込まずに`SlotConflictError`を返す。全件クリアな場合のみ、1回の複数行INSERT文でまとめて挿入する（drizzle-orm/neon-httpがトランザクション非対応のため、単一INSERT文自体の原子性を利用。一部だけ挿入されて残りが失敗する状態にはならない）。

**動作確認（すべてローカル、Instagram Graph APIへの実リクエストなし）：**
- `npx tsc --noEmit` エラーなし／`npm run build` 成功。新規ルート（`bulk`・`occupied-slots`・`posted-persons`）がビルド成果物に含まれることを確認
- `allocateBulkSlots`を実際の`listOccupiedSlotIsos`結果に対して実行し、既存予約（松村北斗 2026-09-22 09:00）を正しくスキップして15:00から配置されることを確認。cancelled状態の予約（森本慎太郎、同一日時）は空き枠として扱われることも確認
- 既存予約（id=27, 松村北斗）が今回の作業を通じて一切変更されていない（`updatedAt`が変化していない）ことをDBで直接確認
- 一括登録の重複防止：既存予約と衝突する項目を含むリクエストが409で拒否され、衝突していない項目も含めDBへ一切書き込まれない（全件ロールバック相当）ことを確認。バッチ内の同一日時重複も409で拒否されることを確認
- 3件の一括予約が1回のリクエストで正しく作成されることを確認（`createSchedulesBatch`の正常系）
- 人物写真未登録（京本大我）の`prepare`呼び出しが422＋明確なエラーメッセージを返すことを確認（一括生成時にその人物だけエラー表示され、他の人物の生成は継続する設計の裏付け）
- 既存の単発予約フロー（一覧取得・キャンセル）が引き続き正常動作することを確認
- 既存の`/admin/instagram-post`（手動投稿）が引き続き200で表示されることを確認
- 既存のCronエンドポイント（`INSTAGRAM_AUTOPUBLISH_ENABLED`ガード・`dryRun`）が今回の変更後も同一の応答を返すことを確認（無変更であることの動作面での裏付け）
- テスト用に作成した一括予約行（id 28〜30）はすべて削除済み。DBには元の2件（id 26, 27）のみが残る

**残っている作業：** commit / push / Production deploy（ユーザー承認待ち）。写真不要テンプレート、1日1枠/2枠切り替え、投稿時刻自体の変更UI、曜日別スケジュールは今回のスコープ外。

**変更なし（今回維持）：** `/api/cron/instagram-publish`・`src/server/instagram-schedule/publish-schedule.ts`・`src/server/instagram-post/config.ts`（`isAutopublishEnabled`含む）・`vercel.json`・既存の単発予約ロジック（`claimDueSchedule`等）。Instagramへの実投稿・commit・push・Production deployは行っていない。

---

## Task 39 — Instagram投稿：人物写真を使わない新テンプレート「works-only」を追加

**目的：** 人物写真の登録なしでもInstagram投稿画像（1080×1080の正方形カルーセル3枚）を生成できる新テンプレート`works-only`を追加する。既存の`default-person`テンプレート（1080×1350、人物写真あり）のデザイン・動作・関連ファイルは一切変更しない。

**設計方針：** `og-templates/`直下の既存ファイル（`theme.ts`・`shared.tsx`・`page1〜3.tsx`・`index.ts`）は1バイトも変更せず、完全に独立した`og-templates/works-only/`サブフォルダを新設した。`pickDefined()`（テーマに依存しない純粋関数）だけは既存`shared.tsx`から再利用し、それ以外（`Decorations`・`BrandLabel`・配色・サイズ）は独立して定義している。生成ロジック側も同様に、既存の`build-post.ts`・`og-render.tsx`は無変更のまま、新規ファイル（`build-post-works-only.ts`・`og-render-works-only.ts`）を並置した。

**新規追加：**
- `src/server/instagram-post/og-templates/works-only/theme.ts`：CANVAS(1080×1080)・COLORS・BRAND・PAGE1〜3のデザイン設定。
- `src/server/instagram-post/og-templates/works-only/shared.tsx`：`Decorations`・`BrandLabel`・`ArtChipCluster`（人物写真の代わりに表示する抽象的な3枚の作品カード風チップ）・`PlayBadge`（汎用の再生アイコン風バッジ、特定サービスのロゴは使用しない）。
- `src/server/instagram-post/og-templates/works-only/page1.tsx`：表紙（タイトル＋抽象カード装飾＋CTA文言）。
- `src/server/instagram-post/og-templates/works-only/page2.tsx`：出演作品3件（default-personの2枚目カードデザインを踏襲、独立実装）。
- `src/server/instagram-post/og-templates/works-only/page3.tsx`：CTA専用ページ（検索窓風UI＋簡易作品チップ＋CTAボタン）。
- `src/server/instagram-post/og-templates/works-only/index.ts`：バレル。
- `src/server/instagram-post/og-render-works-only.ts`：works-only専用のレンダリング（1080×1080、`ImageResponse`）。フォント読み込みのみ既存`font-loader.ts`を共有。
- `src/server/instagram-post/build-post-works-only.ts`：`buildInstagramPostWorksOnly()`。人物写真の取得（`findExistingPersonPhoto`）を一切呼び出さない点以外は、既存の汎用関数（`fetchPersonWorks`・`fetchImageBuffer`・`convertToInstagramJpeg`・`uploadPostImage`・`buildCaption`・`buildHashtags`）をそのまま再利用。

**変更（既存の動作分岐を追加しただけで、default-person側の処理は不変）：**
- `src/lib/instagram-templates.ts`：`works-only`（`requiresPersonPhoto: false`）を追加。`default-person`の表示ラベルを「標準（人物写真あり）」に更新（デザイン・動作には影響しない表示文言のみの変更）。
- `src/server/instagram-schedule/prepare.ts`：コード内に元々あった拡張コメント通りの分岐を追加（`template.id === 'works-only'`のとき`buildInstagramPostWorksOnly`を呼ぶ）。`default-person`分岐は無変更。
- `src/app/api/admin/instagram-post/generate/route.ts`：`templateId`を受け取り、`'works-only'`のときだけ`buildInstagramPostWorksOnly`を呼ぶよう分岐を追加。`templateId`未指定または`'default-person'`のときは従来と全く同じ`buildInstagramPost`呼び出しのみ。
- `src/app/admin/instagram-post/InstagramPostClient.tsx`：テンプレート選択UIを追加（`/admin/instagram-schedule`側は元々テンプレート選択UIを持っていたため無変更で新テンプレートが選べるようになった）。人物写真確認・アップロードUIは`requiresPersonPhoto`が`true`のときだけ表示するよう変更。プレビュー画像のアスペクト比もテンプレートに応じて切り替え（works-onlyは正方形）。

**動作確認（ローカルのみ。Instagram Graph APIへの実リクエストなし）：**
- `npx tsc --noEmit` エラーなし／`npm run build` 成功
- 人物写真が未登録の実在人物（京本大我）でworks-onlyの3枚を生成 → 成功。`personPhotoUrl`は空文字列、`findExistingPersonPhoto`は呼ばれていない
- 生成画像3枚とも1080×1080ちょうど（JPEGヘッダから実測）であることを確認
- 日本語文字化けなし、タイトル・キャプションの表示崩れなし、作品3件・配信サービスとも正しく表示、1枚目・3枚目とも人物写真は一切含まれていないことを目視確認
- 手動投稿API（`/api/admin/instagram-post/generate`）・予約API（`/api/admin/instagram-schedule/prepare`）の両方から`templateId:"works-only"`で実際にHTTP経由の生成が成功することを確認（人物写真未登録エラーで止まらない）
- `/admin/instagram-post`のテンプレート選択に「標準（人物写真あり）」「作品・配信情報（人物写真なし）」の両方が表示されることを確認
- **default-personへの影響確認：** 同じ人物（森本慎太郎）でdefault-personテンプレートを再生成し、1枚目・3枚目はバイト単位で完全一致、2枚目も目視で完全に同一のデザインであることを確認（JPEGエンコーダの数バイトの差のみで、レイアウト・色・文言に一切変化なし）

**残っている作業：** commit / push / Production deploy（ユーザー承認待ち）。Vercel本番環境でのフォントファイルの`outputFileTracingIncludes`は、works-onlyも同じ`/api/admin/instagram-post/generate`・`/api/admin/instagram-schedule/prepare`ルートを経由するため追加設定は不要と判断したが、Production初回デプロイ時に実機確認が望ましい。

**変更なし（今回維持）：** `og-templates/theme.ts`・`shared.tsx`・`page1〜3.tsx`・`index.ts`（default-person本体）、`build-post.ts`、`og-render.tsx`、Instagram API認証・`media_publish`・Cron・自動投稿・一括予約・Atomic Claim・投稿履歴・Vercel Blob処理ロジック・既存DBデータ・既存予約データ・`INSTAGRAM_AUTOPUBLISH_ENABLED`。Instagramへの実投稿・commit・push・Production deployは行っていない。
