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

---

## Task 40 — トップページを「推し発見型」から「自分の推しを探す型」へ変更

**目的：** すでに推し・気になる人物がいるユーザーが、トップページから自分の推しをすぐ探せる情報設計に変える（人物名・グループ名検索／グループから探す／ジャンルから探す を中心に）。色・カード・フォント等のデザインは維持。

**新しい表示順：** ヘッダー → Hero（メインコピー＋検索） → グループで探す → ジャンルで探す → スタッツバー → 配信サービスから探す → 人気検索 → 人気商品 → 写真集を探す → フッター

**変更ファイル：**
- `src/app/page.tsx`
  - Heroコピーを「推しの出演作・配信先・商品をまとめてチェック」、サブ文言を「推しの名前・グループ名から探す」に変更。スマホで検索欄がファーストビューに入るよう上余白を `clamp(48px,8vw,96px)` → `clamp(28px,7vw,80px)` に縮小
  - 「グループで探す」「ジャンルで探す」をHero直下へ移動（JSX・リンク・クラスは無変更）
  - スタッツバー（登録タレント数等）はHero直下からジャンルの下へ移動（上に境界線を追加）
  - 「今人気の人物」「急上昇」「人気作品」「注目の人物」をレンダリングしないよう削除し、ランキング取得を `getRankingData()` → `getHomeRankingData()`（軽量版）に変更。キャッシュキーは `home-ranking-lite-data`（返却形が異なるため旧キーと分離）、タグ `RANKING_DATA_CACHE_TAG` は維持
- `src/components/site/HomeDiscoverySections.tsx`（新規）：上記4セクションの旧JSXをそのまま移設して保持（`PopularPersonsSection` / `RisingPersonsSection` / `PopularWorksSection` / `FeaturedPersonsSection`）。現在はどこからもimportしていない。`RankingPersonCard`・`HomePersonCard` も削除せず残している
- `src/lib/ranking.ts`
  - 「人気検索」「人気商品」の計算を `computePopularSearches()` / `computePopularProducts()` に切り出し（処理内容は無変更、`getRankingData()` もこれを呼ぶだけで挙動同一。既存 `ranking.test.ts` 全件通過）
  - `getHomeRankingData()` を追加：人気検索・人気商品のみ計算。全人物の閲覧数パイプライン、TOP8人物の作品/商品全件取得、`getInactiveProviderSlugs()`、`work:click:*` SCAN＋公開作品マップ/エイリアスマップ取得＋作品DB照合は行わない

**設計上の判断・注意点：**
- 「人気検索」「人気商品」「配信サービスから探す」「写真集」は非表示指定の4セクションに含まれないため「その他のコンテンツ」として残した
- `HeroSearchForm`（検索サジェスト・検索履歴・「人気:」チップ・placeholder）は無変更
- 4セクションを復活させる場合は、`HomeDiscoverySections.tsx` のコンポーネントを page.tsx に戻し、取得を `getRankingData()` に戻す（ファイル冒頭コメント参照）
- ESLintはプロジェクトに `eslint.config.*` が存在せず実行不可（既存状態）。`tsc --noEmit` のエラーは `.next/types/* 2.ts`（重複ファイル）由来のみで `src` 配下は0件

---

## Task 41 — トップページ：ヘッダー検索の非表示・グループ絞り込み・ジャンルのコンパクト化

**目的：** Task 40の方向性を維持しつつ、「自分の推しを探しやすいUI」に整理する（大規模デザイン変更なし）。

**新しい表示順：** ヘッダー（トップのみ検索欄なし） → Hero（メインコピー＋検索） → グループで探す（絞り込み付き） → ジャンルで探す（主要9ジャンル＋展開） → 配信サービスから探す → 人気検索 → 人気商品 → 写真集を探す → スタッツバー → フッター

**変更ファイル：**
- `src/components/HeaderSearchSlot.tsx`（新規・client）：`usePathname()` が `/` のときだけヘッダー検索枠を描画しない。他ページは従来どおり
- `src/components/Header.tsx`：検索フォームのラッパー div を `HeaderSearchSlot` に置き換えただけ（サジェスト生成等は無変更）
- `src/components/site/HomeGroupSection.tsx`（新規・client）：「グループで探す」本体。説明文と絞り込みボタン（すべて／女性グループ／男性グループ／その他）を追加。グループリンクのURL・`theme-group-chip` の見た目は旧実装と同一。初期表示は「すべて」で全リンクをSSR
- `src/app/page.tsx`
  - グループ一覧を `HomeGroupSection` に置き換え（`group_meta.gender` を付与して渡す）
  - ジャンル：主要ジャンル `HOME_PRIMARY_GENRES`（アイドル・俳優・女優・タレント・歌手・アーティスト・声優・モデル・芸人）のみ初期表示。残りは既存のカテゴリカード形式のまま `<details>`「すべてのジャンルを見る」内へ。ピルは `GenrePill` に共通化（スタイル同一）
  - スタッツバーをページ最下部（写真集の下）へ移動（削除はしない）
- `src/app/globals.css`：`.home-genre-more`（`<details>` の summary 表示・開閉ラベル切り替え）を追加のみ

**設計上の判断・注意点：**
- 性別分類は既存の `group_meta.gender`（写真集機能用、管理画面で手動設定）のみ使用し推測しない。未設定のグループは「その他」に入る。2026-09-27時点で未設定：バナナマン（group_meta自体なし）・嵐・モナキ・timelesz・Travis Japan・なにわ男子。管理画面で gender を設定すれば自動で正しい絞り込みに入る
- 「女性アイドル／男性アイドル」表記は採用しなかった：男性側に芸人（オードリー）・バンド（UVERworld・SPYAIR等）が含まれ、メンバーのジャンルも「テレビ」等でアイドル判定できないため
- ジャンル展開は `<details>` のためJS不要。閉じていても全ジャンルリンク（計49件）がサーバーHTMLに含まれる
- トップでもヘッダーのサジェストデータはサーバー側で生成されRSCペイロードに含まれる（ルートレイアウトのHeaderはパスを知らないため。描画のみ抑止）

---

## Task 42 — トップページ「グループで探す」の分類を表示用マッピングに変更

**目的：** Task 41 の `group_meta.gender` ベースの絞り込みでは gender 未設定の嵐・timelesz・Travis Japan・なにわ男子等が「その他」に入りUXとして不自然だったため、トップページ表示専用の明示的な分類（女性アイドル／男性アイドル／その他）に変更する。DB・管理画面・人物データ・グループURLは変更しない。

**変更ファイル：**
- `src/components/site/HomeGroupSection.tsx`：`HOME_GROUP_CATEGORY`（グループ名→分類）を追加し、絞り込みボタンを「すべて／女性アイドル／男性アイドル／その他」に変更。`HomeGroupItem` から `gender` を削除。マッピングに無いグループは「その他」にフォールバック。照合は NFKC 正規化後（データ上の「＝LOVE」は全角＝のため）。絞り込みUI・リンクURL・見た目は維持
- `src/app/page.tsx`：`homeGroups` 生成から `gender` 付与を削除のみ

**分類（全22グループ、2026-09-27時点）：**
- 女性アイドル：乃木坂46・日向坂46・櫻坂46・欅坂46・＝LOVE・FRUITS ZIPPER
- 男性アイドル：Snow Man・SixTONES・嵐・M!LK・timelesz・Travis Japan・なにわ男子
- その他：オードリー・モナキ・バナナマン・DISH//・D-BOYS・THE ORAL CIGARETTES・BLUE ENCOUNT・SPYAIR・UVERworld

**注意点：** モナキは既存データ（メンバーのジャンルは全員「テレビ」・gender未設定）から男性アイドルと判断できる根拠がないため「その他」。指示にないグループを名称・メンバー構成から独自に推測して分類しないこと。グループ追加時はトップの分類を `HOME_GROUP_CATEGORY` に追記すること（未追記なら「その他」）。`group_meta.gender`（写真集機能用）はトップの絞り込みでは使わなくなった。

---

## Task 43 — トップページ：ヒーロー見出しの改行位置を調整

**目的：** PCで見出しが「…まとめ／てチェック」と語の途中で折れていたため、自然な位置（「…商品を／まとめてチェック」）で改行させる。文言は変更しない。

**変更ファイル：**
- `src/app/page.tsx`：h1 の `<wbr />` をやめ、「推しの出演作・配信先・商品を」「まとめてチェック」をそれぞれ `display: inline-block` の span で囲んだ。幅が足りない狭い画面では span 内でも通常どおり折り返す

**確認：** 「グループで探す」の初期状態はもともと `useState('all')`（「すべて」選択）のため変更なし。SSR HTMLで「すべて」が aria-pressed="true" であることを確認。

---

## Task 44 — トップページ：スマホのStatsを2列×2行に／🎨ボタンの確認

**目的：** スマホ幅でStatsが「3項目＋VODだけ次の行」に崩れていたのを 2列×2行 にする。右下の🎨ボタンの用途を確認する。

**変更ファイル：**
- `src/app/globals.css`：`@media (max-width: 639px)` を追加（既存 479px ブロックの後ろ）。`.hero-stats-bar` を `display: grid; grid-template-columns: repeat(2, 1fr); row-gap: 8px`、`.hero-stat-divider` を非表示。640px以上（PC）は従来の flex 4列＋区切り線のまま。`.hero-stat*` はトップページでしか使っていない

**🎨ボタン（`src/components/site/DesignPreviewToggle.tsx`）：** デザインテーマ（data-design）切り替えの開発・デザイン確認用。Task 4 で production 非表示済み（`NEXT_PUBLIC_VERCEL_ENV === 'production'` または VERCEL_ENV 未設定かつ `NODE_ENV === 'production'`）。localhost（dev）・Vercel preview では表示される。強制表示用の `NEXT_PUBLIC_ENABLE_DESIGN_PREVIEW` は .env.local・.env.preview・Vercel production 環境変数のいずれにも未設定（2026-09-27確認）のため、コード変更なし。

**確認：** ヘッドレスChromeで幅375px（iframe）と1280pxのスクリーンショットを撮り、スマホ2×2・PC4列を目視確認。

---

## Task 45 — トップページ：検索欄下の「人気:」キーワードチップを非表示

**目的：** トップページのヒーロー検索欄の下にある「人気: 乃木坂46 / 櫻坂46 / 日向坂46 / オードリー / バナナマン / あの」のチップ一式を表示しない。

**変更ファイル：**
- `src/components/site/HeroSearchForm.tsx`：任意prop `showPopularKeywords`（デフォルト true）を追加し、false のときチップ部分を描画しない。`SmartSearchInput`（検索・サジェスト・履歴）への props は無変更。`POPULAR_ITEMS` は復活用に残している
- `src/app/page.tsx`：`<HeroSearchForm showPopularKeywords={false} />` を渡すのみ

**データ取得：** チップは `HeroSearchForm` 内の固定配列（`POPULAR_ITEMS`）で、API・DB・Redisからの取得は元々無いため停止すべき処理は無し。`HeroSearchForm` はトップページ専用（他ページ未使用）。`.hero-keyword-chip` のCSSは残置。

---

## Task 46 — トップページ：ヒーロー下側の余白を調整（PC中心）

**目的：** PCで検索欄〜「グループで探す」の間（ヒーロー下80px＋グループ上48px）が広かったため、ヒーロー下側のみ少し詰めて「グループで探す」を早く見せる。

**変更ファイル：**
- `src/app/page.tsx`：Hero の padding 下側を `clamp(32px, 7vw, 80px)` → `clamp(32px, 5vw, 56px)`。上側・左右・見出し・検索欄・グループセクションは無変更。PC(1280px)で 80→56px、スマホ(375px)は 32px のまま（変化なし）

**確認：** ヘッドレスChromeで 1280×800 と 375×812（iframe）のファーストビューを撮影し崩れがないことを確認。

---

## Task 47 — 写真集取得の other side closed 対策（同時実行の重複排除＋接続切断時のみ1回再試行）

**背景（調査結果）：** `fetchAutoCandidateRows()` の自動候補SQLが 約38,000行・約23MB・12〜15秒 を返し（最終的に使うのは約374件）、ホーム（女性/男性）や `/photobooks`（一覧/ファセット）がこれを同時に2本流していたため、Neon HTTP 経由の転送途中で `SocketError: other side closed` が発生していた（build外の単体実行でも再現）。

**変更ファイル：**
- `src/lib/photobook-store.ts`
  - `fetchCandidatesRaw()`：実行中の Promise を共有する in-flight 重複排除。完了・失敗時に `finally` で必ず解除（キャッシュではない。次の呼び出しは常に新規実行）。公開側（`getAllPhotobookItems`）・管理側（`fetchAllCandidatesForAdmin`）の両方がここを通る
  - `isTransientDbConnectionError()`：cause チェーン（最大5段）をたどり、`name === 'SocketError'`／`code` が `UND_ERR_SOCKET`・`ECONNRESET`・`EPIPE`／message に `other side closed` を含む場合のみ true
  - `withTransientDbRetry()`：上記に該当する場合のみ 300ms 待って1回だけ再試行。再試行も失敗したらそのまま throw。`fetchAutoCandidateRows()`・`fetchManualIncludeCrossCategoryRows()` に適用
- `src/lib/__tests__/photobook-store-inflight.test.ts`（新規・9件）：同時2回で重いSQL1回／ホーム女性+男性で1回／結果が単独呼び出しと同一／完了後は再実行（非キャッシュ）／失敗後に in-flight 解除／other side closed で1回再試行し成功／再試行も失敗なら2回で終了／通常エラーは再試行しない／判定関数の真偽

**実施しなかったこと：** SQLの書き換え（取得量削減）、写真集の選定・判定ロジック、DBスキーマ、UI、管理画面。

**確認結果（2026-09-27）：**
- 本番DBに対しホームと同条件（女性+男性同時）を5回：5回とも成功（約16〜22秒、修正前は30〜38秒）。1回は接続切断が発生したが再試行で回復（66秒）
- build 3回：いずれも成功。1回目は接続切断→再試行で回復。2・3回目は再試行も接続切断で失敗したが、unstable_cache の既存エントリが保持され、プリレンダーされたホームに写真集は表示されている
- build中はページ生成が並列でCPU負荷が高く、大きな応答の受信が遅れて切断されやすいとみられる。根本対策は取得量の削減（2段階取得等、別タスク）

---

## Task 48 — 写真集取得の2段階化（根本対策）

**目的：** 約38,000行・約23MBを一括取得してからアプリ側で約374件に絞っていた処理を、選定結果を変えずに軽量化し、Neon HTTP の転送途中切断（other side closed）を防ぐ。Task 47 の in-flight 共有・1回再試行・60秒キャッシュ仕様は維持。

**変更ファイル：**
- `src/lib/photobook-store.ts`
  - `fetchAutoCandidateLightRows()`（第1段階）：`WITH ORDINALITY` で配列内位置を付け、person_name・category・ord・id・title・isUsed・status のみ取得
  - `fetchAutoCandidateRows()`：第1段階の順序で「人物::id」最初の1件に重複排除（従来の toCandidateItems と同じ）→ `isAutoDetectedPhotobook()`（従来と同じ関数）で事前判定。残すのは「status≠auto（手動設定あり）or 自動判定合格」＝公開側・管理側フィルタの和集合
  - `fetchAutoCandidateFullRows()`（第2段階）：選定キーを JSON パラメータ1個（`jsonb_to_recordset`）で渡し 1000件ずつ取得。`products` 主キー (person_name, category) と位置で要素を特定し、位置の id が不一致なら同配列内を id で探す。商品JSON全体＋photobook_settings を取得し、第1段階の順序に戻す
  - `toCandidateItems()`：manual_include 行の重複判定に第1段階の全キー（`autoKeys`）を使用（従来は全自動候補が seen に入っていたのと同じ結果）
  - `isTransientDbConnectionError()`：`cause` に加え Neon の `sourceError` もたどるよう修正（応答ヘッダ受信前の切断は NeonDbError.sourceError に入るため、従来の判定では再試行されなかった）
- `src/lib/__tests__/photobook-store-inflight.test.ts`：2段階用にモック更新＋テスト追加（計14件）

**変更していないもの：** `src/lib/photobook.ts`（判定・統合・男女・並び順ロジック、差分0行）、UI、DBスキーマ、管理画面。

**計測（2026-09-27、ローカル→Neon、新方式のみ）：**
- 第1段階: 37,985行・約3.6MB（旧 約23MB）・4.4〜20秒（回線状況で変動。この日は旧SQLが連続切断されるほど不安定）
- 第2段階: 882キー → 882行・約0.54MB・約2.7秒（882行は「人物×商品」単位。人物またぎ統合後が374件）
- 最終: 374件（公開300件：女性266・男性32・性別なし2）
- 直列3回：すべて成功、切断・再試行なし（約11〜30秒）

**旧結果との比較：** 旧ロジックの全374件のID一覧は保存されていなかったため全件の実データ比較は未実施（比較のため旧SQLを再実行すると切断が連発したため中止）。旧ロジックで生成された `.next/cache/fetch-cache` のホーム写真集（女性8・男性8、全項目・順序）を baseline とし、新方式の結果と3回とも完全一致。件数（374件／公開300件）も旧実測値と一致。

**本番前最終 build（2026-09-27 22:09）：** 1回実行し成功（43秒、静的ページ117/117生成）。other side closed・SocketError・再試行・Failed query いずれも0件。build中にホーム写真集の unstable_cache エントリが新方式で再取得・更新され（女性8・男性8）、旧ロジック時のキャッシュと ID・順序・全項目が一致。プリレンダーされたホームに写真集カード8件（初期タブ分）を確認。TypeScript（src）エラー0、テスト 65ファイル／1460件 通過。

---

## Task 49 — トップページ デザイン比較用プロトタイプ3案（開発・プレビュー専用）

**目的：** 本番トップページを変えずに、まったく異なるビジュアル方向3案を切り替えて比較できるようにする。情報設計・データ取得・リンク・検索・SEOは変更しない（CSSのみで見た目を上書き）。

**確認URL（開発サーバー）：** `/?design=editorial`（A）・`/?design=aurora`（B）・`/?design=graphic`（C）。画面下中央の「PROTO A/B/C/現行」で切り替え。

**変更ファイル：**
- `src/components/site/DesignPrototypeLab.tsx`（新規・client）：production（`NEXT_PUBLIC_VERCEL_ENV==='production'` または VERCEL_ENV 未設定かつ NODE_ENV=production）では null を返し何もしない。それ以外でパスが `/` かつ `?design=` が3案のいずれかのとき `<html data-proto>` を付与し、Google Fonts の `<link>` と CSS チャンクを読み込み、切り替えバーを表示
- `src/components/site/DesignPrototypeStyles.tsx`（新規）：`design-prototypes.css` を import するだけ。Lab から `next/dynamic` で遅延読み込み
- `src/components/site/design-prototypes.css`（新規）：3案のCSS。すべて `html[data-proto=...]` 配下に限定。page.tsx のマークアップは変えず、構造セレクタと既存クラスで上書き（インラインstyleの箇所のみ `!important`）
- `src/app/layout.tsx`：`<Suspense><DesignPrototypeLab /></Suspense>` を追加のみ

**設計上の判断：**
- 既存の `?design=trust|oshi|dark`（DesignPreviewToggle）は本番でもURLパラメータが有効なため、`DESIGN_THEMES` には追加せず別経路にした（本番で `?design=aurora` を付けても無効）。DesignPreviewToggle は未知の値を無視するため共存可能
- 本番ビルドでプロトタイプCSSは別チャンク（約20KB）になり、ホームのHTMLが参照するCSS（約87KB）には含まれないことを確認

**確認結果（2026-09-27）：** 375/390/430/1280px × 現行＋3案で横スクロール0・コンソールエラー0（Playwright）。PC見出しは3案とも2行。`next start` で `?design=editorial|aurora|graphic` を付けても data-proto なし・切り替えバー非表示・プロトタイプCSS未読込。TypeScript（src）0件、テスト 65ファイル／1460件 通過、build 成功。

---

## Task 50 — デザイン比較用プロトタイプに D案「Editorial Pop」を追加

**目的：** A（Editorial Minimal）の上品さ・余白をベースに、C（Graphic Pop）の番号つき英字ラベル・ブランド記号を控えめに取り入れた4案目を比較用に追加する（A 70% ＋ C 30%）。A/B/C・現行・本番は変更しない。

**確認URL：** `/?design=editorial-pop`（切り替えバー: A B C D 現行）

**変更ファイル：**
- `src/components/site/DesignPrototypeLab.tsx`：`PROTOTYPES` に `editorial-pop`（D）、`FONT_HREF` に Noto Sans JP＋DM Mono を追加のみ
- `src/components/site/design-prototypes.css`：末尾に `html[data-proto="editorial-pop"]` の D ブロックを追記のみ（既存 A/B/C 部分はファイル先頭から完全一致で無変更）

**D案の要点：** 生成り #F7F6F2＋極薄ドット（C の約4割の濃さ）／ゴシック見出し（最大52px）＋「FIND YOUR OSHI.」ラベルと「まとめてチェック」の細いオレンジ下線／白・薄い境界線・角丸6pxの検索欄＋落ち着いたオレンジ #E26A2C のボタン／「01 — GROUP」等の小さな番号ラベル／グループは小さなグレー番号つきリスト（hover で番号・矢印・下線がオレンジ）／絞り込みは選択中のみ薄オレンジ背景／配信サービスは罫線リスト／写真集は白カード＋楽天CTAをアウトライン化（色・リンクは同じ）

**確認結果（2026-09-28）：** A・C はフルページのスクリーンショット（1280/375px）が追加前とピクセル完全一致。D は 375/390/430/1280px で横スクロール0・コンソールエラー0、PC見出し2行。`next start` で `?design=editorial-pop` を付けても無効（data-proto なし・切り替えバー非表示・プロトタイプCSS未読込）。本番ホームのCSSはハッシュ不変。TypeScript（src）0件、テスト 65ファイル／1460件 通過、build 成功。

---

## Task 51 — C「Graphic Pop」を通常トップへ適用／人物ページ C プロトタイプ（1人）

**目的：** C案を正式デザイン候補として、①通常トップページへ適用（ローカル）、②人物ページの見た目だけの比較用プロトタイプを1人分作成。情報構成・データ取得・検索・リンク・SEO・JSON-LD は変更しない。

**STEP 1 — 通常トップへ適用**
- `src/app/home-graphic.css`（新規）：design-prototypes.css の C ブロックを、スコープ `html:not([data-proto]):has(.oshi-home-graphic)` に置き換えて移植（構造セレクタ `main > div >` → `.oshi-home-graphic >`）。サーバー描画時点で適用（ちらつきなし）。`:has()` 非対応ブラウザは従来デザイン
- `src/app/page.tsx`：ルート div に `className="oshi-home-graphic"`、`home-graphic.css` の import、next/font（Space Grotesk・Space Mono・Noto Sans JP 700/900）と `--pc-*` フォント変数を設定する `<style>` を追加のみ。マークアップ・データ取得・リンクは無変更
- 比較プロトタイプ（?design=...）表示中は data-proto が付くため home-graphic.css は外れ、A/B/C/D の比較は従来どおり。切り替えバーに「旧」（`?design=classic`＝C適用前の見た目）を追加。「現行」は C 適用後の通常トップ

**STEP 2 — 人物ページ C プロトタイプ（通常人物ページは無変更）**
- 対象: 梅澤美波（`/person/梅澤美波?design=graphic`）。読み取り専用の集計で、出演作品101・今すぐ見られる76・楽天商品687（6カテゴリ）・公開写真集9・関連メンバー96・プロフィール項目17 と全要素が揃い、候補中で最もバランスが良かったため
- `src/components/site/DesignPrototypeLab.tsx`：対象人物のパスで `?design=graphic` のとき `data-proto="person-graphic"`。切り替えバー（C／現行）を表示。production では従来どおり何もしない
- `src/components/site/design-prototypes.css`：末尾に `person-graphic` ブロックを追記（既存 A/B/C/D 部分は無変更）。Graphic Pop 40%／読みやすさ60%。セクション番号は CSS カウンターで実在セクションのみ（01 WATCH NOW／02 STREAMING／03 PICK UP／04 ITEMS／05 WORKS／06 PROFILE／07 RELATED／08 FAQ）。人物ページには独立した写真集セクションが無く、写真集は関連商品の「写真集・書籍」カテゴリとして表示される
- 注意: 当初ヒーロー用セレクタ `nav.breadcrumb-bar + div` がクイックナビ（同クラス）直後の本文にも一致し、楽天CTAの白文字を上書きしていたため `nav:first-of-type + div` に修正済み

**確認結果（2026-09-28）：** 通常トップと `?design=graphic` のスクショは「→」記号のフォント描画差のみ（Google Fonts と next/font の配信差）。C プロトタイプは追加前とピクセル一致。人物プロトタイプ・通常人物ページとも 375/390/430/1280px で横スクロール0・コンソールエラー0。通常人物ページにはプロトタイプ／トップ用CSSが一切読み込まれない。`next start` で通常トップ＝C、`?design=aurora|classic` は無効、人物ページ（`?design=graphic` 付きでも）従来表示、切り替えバー・🎨非表示。トップ→グループページのクライアント遷移でも C のスタイルは漏れない。TypeScript（src）0件、テスト 65ファイル／1460件、build 成功。

**未解決の判断事項：** next/font の Noto Sans JP（700/900）によりトップで読み込むCSSが +189KB（gzip 約67KB、@font-face 249件、描画ブロッキング）。本番前に「システムフォントへ切替」または「900のみ」等で軽量化するか要判断。

---

## Task 52 — Cトップの日本語Webフォント軽量化（Noto Sans JP は 900 のみ）

**目的：** 本番公開前の軽量化。C の極太見出しの見た目は維持しつつ、本文用の日本語Webフォントを読み込まない。

**変更ファイル：**
- `src/app/page.tsx`：next/font の Noto Sans JP を `['700','900']` → `['900']`、Space Grotesk を `['500','700']` → `['700']`（500は未使用）。`--pc-display` のフォールバックから Noto を外し system-ui に
- `src/app/home-graphic.css`：body への `font-family: var(--pc-jp)` を削除（本文は既存のフォントスタック）。ヘッダーロゴ（900）に `font-family: var(--pc-jp)` を明示。`--pc-jp` は 900 の見出し（ヒーロー h1・.section-heading）とロゴ専用

**計測（next start、トップ、1280/375px 同値）：**
- CSS: 4ファイル 83.5KB（展開283KB）→ 2ファイル 50.6KB（展開190KB）
- Webフォント: 34ファイル 635KB → 12ファイル 138KB
- 修正前は Noto の 700/900 しか無いのに本文（400）まで Noto 指定だったため、通常文字も太字で描画され、ページ内の文字に応じて多数の分割フォントが読み込まれていた

**見た目：** ヒーロー（見出し・ロゴ・ラベル・検索欄・ボタン）は変化なし。通常文字（説明文・グループ名・絞り込み等）は既存のシステムフォントになり、説明文は本来の通常太さに（390pxで1行に収まりリストが約20px上がる）。人物ページCプロトタイプ（375/390/430/1280）はピクセル完全一致、A/C プロトタイプも基準と一致。全幅で横スクロール0。

**さらに削減する場合の案（未実施）：** 900 を使う文字は固定文言（ヒーロー見出し・セクション見出し・ロゴ）のみのため、使用文字だけにサブセット化したフォントを next/font/local で自己配信すれば、@font-face の CSS（約33KB gzip）とフォント転送をさらに大幅に減らせる。ただし見出し文言を変更した際にサブセットの作り直しが必要。

---

## Task 53 — 人物ページCプロトタイプ：アイコン・配信情報の視認性改善

**目的：** 人物ページ Graphic Pop プロトタイプ（梅澤美波 `?design=graphic`、開発専用）で、黒く重い／つぶれて読みにくい箇所を改善。通常人物ページ・他ページ・トップは変更しない。

**変更ファイル：** `src/components/site/design-prototypes.css`（`person-graphic` ブロックのみ。A/B/C/D 部分は無変更）

**変更内容：**
- イニシャルアイコン：黒ベタ → オフホワイト（#FFF7F1）＋1.5pxオレンジ枠＋オレンジ文字（#E85400）
- 配信状態バッジ（今すぐ見られる作品の 見放題／無料／広告付き無料。元はグレー地に濃グレー10px）：薄グリーン地（#EAF7EF）＋濃グリーン文字（#146C3A）＋薄枠、11px・太字。このセクションには視聴可能な種別のみ表示されるため一律グリーン
- 配信サービス一覧：ロゴ自体が黒地のサービス（ABEMA・Netflix・FOD等）が黒い塊に見えないよう、薄グレーのタイルに余白をとって配置（ロゴ画像は無変更）。サービス名・作品名は純黒ではなく濃グレー（#2B2B28）、件数バッジ・見出し横の件数もグリーン＋薄枠に統一
- 補足テキスト（◯◯で視聴可能・確認日）は #55554F に
- 黒い強調を削減：開いたパネルの枠を黒→グレー（左端のオレンジ線で強調）、「作品詳細を見る」は hover で黒塗り → 薄オレンジ＋オレンジ文字
- 「追加チャンネル」バッジが途中で折れないよう nowrap

**確認：** 375/390/430/1280px で横スクロール0・エラー0。通常人物ページは従来のまま（バッジ・アイコンとも変化なし）。

---

## Task 54 — 人物ページCプロトタイプ：出演作品カード内の配信サービスバッジの視認性改善

**目的：** 出演作品カード内の配信サービスバッジで、ロゴ自体の黒地・濃色（FOD・ABEMA・Netflix・Hulu 等）が余白なしで塊に見える／データ取得元ごとの色分け（オレンジ・黄・紫）で配色がばらつく問題を、C案のルール（白・黒・オレンジ＋配信状態の緑）に揃える。対象は人物ページCプロトタイプの出演作品カードのみ。

**変更ファイル：** `src/components/site/design-prototypes.css`（`person-graphic` ブロック末尾へ追記のみ）

**変更内容：**
- バッジ：白地＋細いグレー枠（#D9D8D1）＋濃グレー文字（#2B2B28）、11px・太さ600、角2〜3px。source 別の色分けは揃える
- ロゴ：22px の白いタイル（余白3px＋細枠）に収め、黒地ロゴが塊に見えないようにする（ロゴ画像は無加工）
- ブランドカラーは細い枠のみ（title 先頭のサービス名で判定）：Hulu・Netflix・Prime Video・Lemino・YouTube・TVer。Prime Video内チャンネルは淡い黄色の枠
- サービス名の省略（max-w 5rem＋truncate）を解除し、長い名前はバッジ内で折り返す
- 「+N」「購入・レンタルあり」補助チップの文字を読める濃さに。「配信情報を確認済み」等の補足文は現状維持

**確認：** 1280/430/390/375px で全101カード・90バッジについて、横スクロール0・文字切れ0・バッジ重なり0・カード外はみ出し0・濃色ロゴ背景0。「失恋カルタ」「あの坂道をのぼって話そう」「九龍ジェネリックロマンス」を目視確認。通常人物ページのバッジは従来のまま。

**スコープ外で気づいた点（未対応）：** 375px で作品カードの「2026年」が「2026／年」と折れる（役名と同じ行のため）、画像左上の種別ラベル（ドラマ・映画）が濃いグレー地、「確認日」が非常に薄いグレー（gray-300）。

---

## Task 55 — 人物ページCプロトタイプ：作品種別ラベルと確認日の調整

**目的：** 出演作品カードの画像上の作品種別ラベル（ドラマ・映画・アイドル番組等、元は bg-black/60 の黒半透明）が重いのを C の明るい表現に揃え、極端に薄い「確認日」（gray-300）を読める濃さにする。対象は人物ページCプロトタイプの出演作品部分のみ。

**変更ファイル：** `src/components/site/design-prototypes.css`（`person-graphic` ブロック末尾へ追記のみ）

**変更内容：**
- 種別ラベル：オフホワイト（ほぼ不透明）＋薄グレー枠＋濃グレー文字（#3A3A35）＋左端2pxオレンジ線、11px・weight 500。「配信中」（緑ベタ・太字）より弱い階層。画像なしカードの種別ラベルも同じ表現
- 種別ラベルの位置を画像の左上 → 左下へ。375〜390px の2列表示で「アイドル番組」「ライブ・コンサート」等の長いラベルが右上の「配信中」と重なっていたため（通常人物ページでも同条件で約22カード重なっている既存事象）。サイズ・リンクは不変
- 確認日：gray-300 → 中間グレー #7A7973（作品名・配信情報より弱く、黒にはしない）

**確認：** 1280/430/390/375px で全101カード：横スクロール0、種別ラベルと配信中の重なり0、ラベルの画像外はみ出し0、文字切れ0。配信サービスバッジの検査（文字切れ・重なり・濃色ロゴ背景）も引き続き0。通常人物ページは従来のまま。

---

## Task 56 — 人物ページCプロトタイプ：最終仕上げ（濃色背景・低コントラストの解消）

**目的：** 最終確認で見つかった4点を修正し、人物ページC案を確定可能な状態にする。対象は人物ページCプロトタイプのみ。

**変更ファイル：** `src/components/site/design-prototypes.css`（`person-graphic` ブロック内のみ。A/B/C/D 部分・トップ・通常人物ページは無変更）

**変更内容：**
1. 出演作品の横長サムネイル枠（`.relative.aspect-video`、元 bg-gray-800 #1F2937）の余白を #EFEEE8 に。画像は object-contain のまま（C と通常ページで作品画像の表示サイズ・object-fit が全101カードで一致）
2. 関連メンバーのアバター：黒丸＋白文字 → オフホワイト（#FFF7F1）＋1.5pxオレンジ枠＋オレンジ文字（#E85400）、丸形維持（「梅」アイコンと同仕様）
3. 画像右上の「配信中」：green-500 → #15803D（白文字、コントラスト比 約5）
4. 補足文字：「配信サービス情報は現在確認できません」「PR」→ #6B6A64、「▶ 配信中を見る」→ #15803D、「配信情報を確認済み」→ #C2410C・10px

**確認（1280/430/390/375px）：** 横スクロール0、要素の重なり0（種別ラベル×配信中、配信バッジ同士）、文字切れ0、コンソールエラー0。濃色ベタとして残るのは意図したもの（ヘッダー検索ボタン、選択中タブの黒、楽天の赤CTA、配信中の濃緑）のみ。低コントラスト検出は★評価アイコン・FAQの装飾「Q」・確認日（意図した中間グレー、比4.37）のみ。YouTube 等のサムネイル画像そのものに含まれる黒帯は画像の一部のため対象外（トリミングしない方針）。

---

## Task 57 — 人物ページC「Graphic Pop」を通常人物ページへ正式適用

**目的：** 梅澤美波で最終確定した人物ページCプロトタイプ（`?design=graphic`）を、通常URL `/person/[slug]` に適用する。見た目の仕様は確定状態のまま。データ取得・リンク・並び順・絞り込み・SEO・metadata・JSON-LD・canonical・楽天/VODリンクは無変更。トップページC・比較プロトタイプ機能は無変更で維持。

**変更ファイル：**
- `src/app/person/[slug]/person-graphic.css`（新規）：design-prototypes.css の `person-graphic` ブロックを、スコープ `html:not([data-proto]):has(.oshi-person-graphic)` に置き換えて移植（108ルール）。フォント方針のみトップと同じ軽量化（日本語Webフォントは900の人物名・セクション見出し・ロゴのみ、本文は既存フォントスタック、`--pp-display` のフォールバックから Noto を除外）
- `src/app/person/[slug]/page.tsx`：`person-graphic.css` の import、next/font（Space Grotesk 700・Space Mono 400/700・Noto Sans JP 900）と `--pp-*` を設定する `<style>`、`.page-bg` に `oshi-person-graphic` クラスを追加のみ

**確認（梅澤美波・松田里奈〔現役/櫻坂46〕・齊藤京子〔卒業/商品0件〕・成田凌〔男性/グループなし/少データ〕・阿部寛〔男性/作品212件〕 × 1280/430/390/375px）：** 全て HTTP200・C適用・横スクロール0・種別ラベル×配信中の重なり0・配信バッジ重なり0・バッジ/作品詳細ボタンの文字切れ0・JSON-LD（Person/BreadcrumbList/FAQPage）・canonical・title 維持。クイックナビのアンカー、作品フィルタタブ、商品カテゴリタブ、FAQ開閉が動作。内部リンク（各人物最大25件）と作品詳細リンク（各5件）で4xx/5xx 0。楽天リンクは全て hb.afl.rakuten.co.jp、target=_blank・rel=sponsored。コンソールエラーは齊藤京子の外部画像404（データ側の画像URL）のみ。`next start` で人物ページ（`?design=graphic` 付きでも）C表示、プロトタイプ属性・切替バー・🎨なし。トップは従来どおり C。npm test 65ファイル/1460件、tsc 0件、production build 成功。

**既存の不具合（C適用前から存在、未修正）：** 「今すぐ見られる作品」のVOD CTAボタンのうち「Prime Video内 FODチャンネルで今すぐ見る」（齊藤京子）が 375〜430px でカード右端から 37px/28px はみ出し、カードの overflow で途切れる。C 適用後は見放題バッジが大きくなった分 +5px（42px/33px）。
**確定仕様の対象外だった要素：** 同セクションのVOD CTAボタンは配信サービスのブランド色の塗り（U-NEXT・Netflix は黒系）。梅澤美波のページには CTA ボタンが無く（全て「◯◯で視聴可能」表示）、プロトタイプ確定時の確認対象に入っていなかった。現状維持。

---

## Task 58 — 人物ページC：「今すぐ見られる作品」の長い配信ボタンのはみ出し修正

**目的：** 375〜430px で「Prime Video内 FODチャンネルで今すぐ見る」等の長い配信ボタンがカード右端から 33〜42px はみ出していた問題（C適用前から存在した既存不具合）を修正。C案のデザイン・カード幅・バッジサイズ・リンク・VODデータは変更しない。

**原因：** ボタン（`.vod-cta-btn`、`w-full`）が「見放題」バッジと同じ行にあり、サービス名が `truncate`（nowrap）のため、ボタンの最小幅が文字列全体の幅になり縮めなかった。

**変更ファイル：** `src/app/person/[slug]/person-graphic.css`（正式版）と `src/components/site/design-prototypes.css`（`person-graphic` プロトタイプ、同一ルール）へ追記のみ。スコープは人物ページの `section#streaming-now .vod-cta-btn`
- ボタン：`min-width: 0`（行内で縮める）、左右 padding 8px → 7px（ちょうど1行に収まる長さの名前が1px未満の差で末尾1文字だけ折り返すのを防ぐ。中身は中央寄せのため短いボタンは不変）
- サービス名：省略せず折り返し（`white-space: normal`、中央揃え、`word-break: auto-phrase` で文節単位、`text-wrap: balance` で行長を揃える）。文字サイズは不変

**確認：** 齊藤京子・梅澤美波・松田里奈・成田凌・阿部寛 × 375/390/430/1280px で横スクロール0、ボタンのカード内側（padding境界）外へのはみ出し0、文字切れ0、ボタン同士・バッジとの重なり0、カード幅不変、ボタンのリンク件数・href 不変、コンソールエラー0。「今すぐ見られる作品」先頭3カードの修正前後スクショ比較（36枚）：長いボタンのカード以外は同一（齊藤京子の2・3枚目のみアンチエイリアス程度の差、閾値超え画素0）。長いボタンは 375px で「Prime Video内／FODチャンネルで／今すぐ見る」、390/430px で「Prime Video内／FODチャンネルで今すぐ見る」。tsc 0件、npm test 65/1460、production build 成功。

---

## Task 59 — トップページC・人物ページCの本番反映（コミット範囲）

**コミット対象：** `src/app/page.tsx`・`src/app/home-graphic.css`・`src/app/person/[slug]/page.tsx`・`src/app/person/[slug]/person-graphic.css`・本ログ。

**コミットしないもの：** デザイン比較用プロトタイプ（`src/components/site/DesignPrototypeLab.tsx`・`DesignPrototypeStyles.tsx`・`design-prototypes.css`、およびそれを読み込む `src/app/layout.tsx` の変更）は開発専用のためローカルにのみ残す（Task 49〜56 の記述はこのローカル機能を指す）。本番用CSSはプロトタイプに依存せず単独で動作する（`:not([data-proto])` は属性が無ければ常に成立）。

---

## Task 60 — トップページC・人物ページCの本番反映（commit 3ce001f）

**目的：** 確定したデザイン「C. Graphic Pop」をトップページと人物ページの通常表示として本番反映する。

**内容：** Task 59 のコミット範囲（`src/app/page.tsx`・`src/app/home-graphic.css`・`src/app/person/[slug]/page.tsx`・`src/app/person/[slug]/person-graphic.css`・本ログ）を commit `3ce001f` として main へ push し、Vercel Production へ反映。比較用プロトタイプ（DesignPrototypeLab 等・`layout.tsx` の変更）は開発専用のためコミットしていない。コミット内容だけを取り出したコピーで production build が成功することを事前確認済み。

---

## Task 61 — React hydration error #418 の原因特定と修正（commit cf182e8）

**症状：** 本番（oshi-search.jp）のトップページでほぼ毎回、阿部寛などの人物ページで条件により React error #418（サーバー生成HTMLとブラウザ初回描画の不一致）。表示・検索・リンクは正常。

**原因1（トップ）：** `src/components/HeaderSearchSlot.tsx` は `usePathname() === '/'` のときヘッダー検索を描画しない。Vercel 上でトップ（ISR, revalidate=60）を再生成する際はサーバー側の pathname が `/index` になるため、再生成後のHTMLにはヘッダー検索が入り、ブラウザ側（`/`）では消える → 不一致。証拠：本番HTMLの RSC ペイロードが `"c":["","index"]` でヘッダー検索入り、ビルド直後のHTMLは `"c":["",""]` で検索なし。ローカルの再生成では `/index` にならないため再現しなかった。27b7378 で入った処理で、C案の変更が原因ではない（当初「1つ前の本番では発生しない」と判断したのは、デプロイ固有URLが Vercel 認証ページへリダイレクトされていたための誤り）。

**原因2（人物ページ）：** `src/components/WorkCard.tsx` の「確認日」が `toLocaleDateString('ja-JP', …)` をタイムゾーン指定なしで使用。サーバー（UTC）とブラウザ（JST）で日付境界がずれる（開発モードの差分：server「2026年8月14日」／client「2026年8月15日」）。以前からの不具合。

**修正（2ファイル・見た目の変更なし）：**
- `HeaderSearchSlot.tsx`：`pathname === '/' || pathname === '/index'` のときトップとして扱う
- `WorkCard.tsx`：確認日の整形に `timeZone: 'Asia/Tokyo'` を指定（利用者に見える日付は従来のブラウザ表示＝日本時間と同じ）

**検証：** ブランチ `fix/hydration-418` の Vercel Preview で ISR 再生成（`"c":["","index"]`）を実際に発生させ、サーバーHTML・hydration 後ともヘッダー検索0で一致、#418 = 0 を確認してから main へ fast-forward で取り込み。阿部寛は出演作品212件すべてでサーバーHTMLと hydration 後の確認日が一致。

---

## Task 62 — スマホ表示の4点修正（commit 3d98275）

**変更ファイル：**
- `src/components/affiliate/OshiAdBanner.tsx`：推しアド（AccessTrade）のバナー画像の読み込み失敗時（error イベント、または hydration 前に失敗済み＝complete かつ naturalWidth=0）に広告枠全体を非表示。AccessTrade のリンクコード・計測・リンク先は無変更。画像取得成功時は従来どおり表示
- `src/app/person/[slug]/person-graphic.css`（639px以下のみ）：「関連商品ピックアップ」見出しの右の「関連商品をもっと見る（N件）→」を見出しの下の行へ（最後の1文字だけ改行する問題の解消）。固定クイックナビの上下余白を縮小（高さ 約59px → 約51px、文字サイズ・横スクロール・リンクは不変）
- `src/app/home-graphic.css`（639px以下のみ）：「ジャンルで探す」〜「03 — STREAMING 配信サービスから探す」の余白を縮小（約96px → 約64px、ジャンル欄の下マージン 48px → 16px）。他のセクション間隔は不変

PC表示は変更なし（CSSはすべて `max-width: 639px` 内）。

---

## 最終確認（2026-09-28・本番 https://oshi-search.jp）

- **現在の本番：** commit `3d982750648a371abd16660383efc17c43d2b53f`（main）、Production デプロイ `https://oshi-search-tjju-fceuxai8s-yuujinn-stacks-projects.vercel.app`（Ready、oshi-search.jp のエイリアス先）
- **確認幅：** 375 / 390 / 430 / 1280px
- **対象：** トップページ（各幅5回リロード、ISR 再生成後の状態を含む）、人物ページ（梅澤美波・阿部寛・齊藤京子・松田里奈・成田凌）
- **結果：** React error #418 = 0、横スクロール = 0、文字切れ = 0、要素重なり = 0、配信ボタンのカード外はみ出し = 0。検索（サジェスト→ /search?q=）、人物ページ内リンク（クイックナビのアンカー）、出演作品リンク・内部リンク（4xx/5xx 0）、楽天リンク（全て hb.afl.rakuten.co.jp、target=_blank）、配信リンク、FAQ はいずれも正常。関連商品ピックアップはスマホで1行、クイックナビはスマホ51px／PC59px、トップのジャンル→配信サービス間はスマホ64px／PC120px（PCは従来どおり）
- **推しアド：** 画像取得成功時は表示（300×250）、画像取得失敗時は壊れた画像を出さず枠ごと非表示（前後の間隔は通常の40px）
- **既知（対象外）：** 齊藤京子ページの外部画像1件が404（データ側の画像URLの問題）

---

## Task 63 — C案「Graphic Pop」を全公開ページへ適用

**目的：** トップ・人物ページ（C案済み・今回は無変更）を基準に、残りの公開ページの見た目を C案へ統一する。表示のみの変更で、DB・API・データ取得・検索ロジック・リンク先・アフィリエイトURL・JSON-LD・canonical・metadata・SEO文言・件数・並び順・管理画面は変更しない。

**対象（旧デザイン → C案）：** `/vod/[provider]`・`/groups/[groupSlug]`・`/work/[workId]`・`/search`・`/genre/[genre]`・`/photobooks`・`/about`・`/contact`・`/disclaimer`・`/editorial-policy`・`/privacy`・404。C案済みは `/` と `/person/[slug]`（無変更）。`/group/[groupSlug]`・`/person/[slug]/work/[workId]` はリダイレクトのみ。

**変更ファイル：**
- 新規 `src/app/graphic-site.css`：共通トークン `--graphic-*`（色・角丸・フォント）と、`html:not([data-proto]):has(.oshi-graphic-page)` にスコープした C案スタイル一式。既存 `--ds-*` を C案の配色へ差し替え、ドット背景、ヘッダー（●ロゴ・OSHI SEARCH・黒い検索ボタン）／黒フッター、H1 上のラベル（`h1::before`：`03 — STREAMING`・`02 — GENRE`・`04 — PHOTOBOOK` 等。H1 の文言は不変）、H2 の番号付きラベル（CSS カウンター＋`:has()` で内容に応じ WORKS / FAQ / PERSONS / NOTE / GUIDE 等）、Tailwind の gray/indigo/blue 系の色を C案へ置換、カードの角丸2px・影なし、VOD の統計ボックス（白地・黒枠）、注記（オレンジ左線）、作品カード（人物ページC案と同じ表現）、グループヒーロー、検索フォーム、塗りのインディゴボタン → 黒CTA
- 新規 `src/components/site/GraphicPageStyles.tsx`：上記 CSS と `next/font`（Space Grotesk 700・Space Mono 400/700・Noto Sans JP 900 のみ／preload:false）を読み込み、フォント名を CSS 変数へ渡すサーバーコンポーネント
- 12ページ（上記対象の page.tsx と `not-found.tsx`）：import 1行、既存ルート要素の className に `oshi-graphic-page oshi-graphic-page--{vod|group|work|search|genre|photobooks|info|notfound}` を追加、ルート先頭に `<GraphicPageStyles />` を追加のみ

**設計上の判断・注意点：**
- マーカークラス方式のため管理画面（同じ root layout 配下）・トップ・人物ページには一切影響しない。SSR 時点で適用されるので切り替わりのちらつきなし。`:has()` 非対応ブラウザは従来デザインのまま
- `home-graphic.css`・`person-graphic.css` はリファクタリングせず、そのまま基準として残した（トークンは新 CSS 側に定義）
- Tailwind の `[class*="text-indigo-"]` は `group-hover:` クラスにも一致するため、色置換は `:is(.text-indigo-500, …)` の完全一致＋ホバー専用ルールで行う
- 404 ページはルート先頭が `<style>` のため `p:first-of-type` で指定
- `/photobooks` は DB 接続の一時エラー（other side closed）でリトライも失敗すると 500 になりうる（既存の挙動・今回は対象外）

**最終確認（ローカル：開発サーバー＋`next start`）：** 17ページ（VOD 4サービス含む）× 375/390/430/1280px で横スクロール 0・文字切れ 0・はみ出し 0・React #418 = 0。検索・人物→作品・作品→人物・人物→配信・VOD→人物/作品・楽天リンク（72件）・内部リンク（60件）・アンカー（10件）正常。`tsc --noEmit` エラー0、test 65ファイル/1460件合格、`next build` 成功。ページ側の差分は import・className 追加・`<GraphicPageStyles />` のみで、metadata・canonical・JSON-LD・href への差分なし。

---

## Task 64 — Instagram投稿：検索体験型テンプレート「search-flow」をPreview専用で追加（未commit・Production未反映）

**目的：** 推しサーチを知らない人にも「人物名を検索 → 出演作品 → 配信先」という使い方が1枚目から伝わる、1080×1080・3枚構成・人物写真なしの新テンプレートを、まず手動投稿画面（`/admin/instagram-post`）のPreviewだけで確認できるようにする。既存4テンプレート（default-person / works-only / works-picks / vod-compare）と、予約投稿・一括予約・自動選択・ローテーション・Cron・DBには追加しない。

**新規ファイル：**
- `src/server/instagram-post/og-templates/search-flow/`（`theme.ts`・`shared.tsx`・`page1〜3.tsx`・`index.ts`）：1枚目＝ロゴ＋「{人物名}の出演作、どこで見れる？」＋STEP 1＋実際の人物名入りの検索窓＋「人物名から出演作品・配信先をチェック」。2枚目＝STEP 2 出演作品（作品カード1〜3件：作品画像・タイトル・配信先バッジ）→矢印→STEP 3 配信先＋「※配信情報は確認時点の情報です」。3枚目＝大きなロゴ＋「推しの名前を入れるだけ」＋「推しの名前を入力」の検索窓＋「出演作品・配信先をまとめてチェック」＋「プロフィールのリンクから推しサーチへ」。`pickDefined()`のみ既存`og-templates/shared.tsx`から流用。
- `src/server/instagram-post/og-render-search-flow.ts`：1080×1080のレンダリング（`font-loader.ts`のみ共有）。
- `src/server/instagram-post/build-post-search-flow.ts`：`buildInstagramPostSearchFlow()`。`fetchPersonWorks`・`fetchImageBufferSafe`・`convertToInstagramJpeg`・`uploadPostImage`・`buildCaption`/`buildHashtags`を再利用。人物写真は取得しない。

**既存ファイルへの追記：**
- `src/lib/instagram-templates.ts`：`PREVIEW_ONLY_INSTAGRAM_TEMPLATES`（search-flow）、`MANUAL_POST_TEMPLATE_OPTIONS`、`getManualPostTemplateMeta()`、`isPreviewOnlyTemplate()`を末尾に追加。`INSTAGRAM_TEMPLATES`・`SCHEDULE_TEMPLATE_OPTIONS`・`getInstagramTemplateMeta()`は無変更。
- `src/app/api/admin/instagram-post/generate/route.ts`：`templateId === 'search-flow'`の分岐を1つ追加（既存分岐は無変更）。
- `src/app/admin/instagram-post/InstagramPostClient.tsx`：テンプレート選択肢を`MANUAL_POST_TEMPLATE_OPTIONS`に変更。search-flowのプレビューを正方形で表示。Preview専用テンプレートで生成した投稿では「Instagramに投稿」ボタンと確認モーダルを出さない。

**設計上の判断・注意点：**
- **予約・自動選択からの隔離：** `INSTAGRAM_TEMPLATES`に入れず、`template-builders.ts`（`TEMPLATE_BUILDERS`）にも登録していない。そのため予約・一括予約の選択肢、自動選択の候補、ローテーションには出ない。予約APIに直接`search-flow`を送っても`UNKNOWN_TEMPLATE`（400）で拒否される（実機確認済み）。正式採用時は`INSTAGRAM_TEMPLATES`へ移し、`TEMPLATE_BUILDERS`へ登録する。
- **VODなし作品の除外：** `selectTopWorks()`はVODあり作品を優先するが必須にはしないため、新しい生成関数の中で配信先が空の作品を除外する（`filterWorksWithVod`、選定ロジック自体は無変更）。配信先ありの作品が2件未満なら`InsufficientWorksError`にする。2枚目は1〜3件に対応し、本文ブロックを縦方向の中央に配置する。
- **作品画像が取れない場合：** 画像URLがない、または取得に失敗した場合は、淡い水色のグラデーション＋タイトル頭文字（先頭の括弧・記号は飛ばす）のカードで代用する。投稿全体は失敗させない。
- **長い文字列：** 人物名は文字幅の目安（全角1・半角0.58）から、タイトル74〜50px・検索窓56〜36pxの範囲で自動縮小する。検索窓内は1行で「…」省略する。作品タイトルは2行で省略し、英単語の途中では改行しない（`wordBreak: 'break-word'`）。
- **表現：** 「無料・登録なし」は使わない。3枚目のCTAは、押せるボタンに見えないよう影なしの淡い帯にした。「ここをタップ」のような表現は使わない。絵文字は使わず、アイコンはSVGで描く。
- **キャプション：** 既存の`buildCaption`をそのまま使うため、既存テンプレートと同じ文面になる。
- **フォント：** `next.config.ts`の`outputFileTracingIncludes`は既に`/api/admin/instagram-post/generate`を対象にしているため、追加設定は不要。

**動作確認（ローカルのみ。Instagram Graph APIへのリクエストなし）：**
- 登録済みの360人からランダムに40人を走査し、配信先ありの作品が3件そろう人物を自動選択した（今回は村山美羽、人物写真は未登録）。配信先なしの作品を含む人物（大和里菜）も同様に抽出した。
- 開発サーバーで`/api/admin/instagram-post/generate`（`templateId: "search-flow"`）を2人分実行し、どちらも200。Blobに保存されたJPEG 6枚がすべて1080×1080・RGBであることを確認した。大和里菜は配信先なしの作品が除外され、2件で生成された。
- ローカルで次の描画を目視確認：全件の画像取得失敗、一部の画像取得失敗、62文字の英語タイトル、3行を超える日本語タイトル（2行で省略）、長い人物名（10文字の日本語名、英字混在の長い名前）。
- 既存のworks-picksの生成が引き続き200であることを確認した。
- `/admin/instagram-post`にだけ「【Preview】検索体験」が表示され、`/admin/instagram-schedule`（通常予約・一括予約）には表示されないことを確認した。
- `npx tsc --noEmit` エラー0。

**変更なし：** 既存4テンプレートの`og-templates`・`build-post*.ts`・`og-render*.ts`、`template-builders.ts`、`auto-template.ts`、`prepare.ts`、予約・Cron・DB schema・`vercel.json`・`next.config.ts`。commit・push・Production deployは行っていない。

---

## Task 65 — search-flow：YouTube系除外・黒帯サムネ対策・専用キャプション・デザイン改善（未commit・Production未反映）

**目的：** Task 64 で追加した Preview 専用テンプレート `search-flow` の実画像を確認した結果を受けて、スクロール停止力と分かりやすさを改善する。あわせて、YouTube系作品の除外、黒帯サムネの対策、専用キャプションを追加する。既存4テンプレート・Canvaツールの挙動は変えない。

**変更ファイル：**
- `tools/canva-instagram/work-selection.ts`：`selectTopWorks(personName, options?)` に省略可能な `SelectTopWorksOptions.excludeProvider` を追加。指定時のみ、その配信サービスを「確認済みの配信先」から除外する（配信先が0件になった作品は、既存の並び順どおりVODなし扱いで後ろに回る）。省略時の処理は従来と同一。
- `src/server/instagram-post/person-data.ts`：`fetchPersonWorks(personName, options?)` が options をそのまま `selectTopWorks` に渡すよう変更（省略時は従来どおり）。
- `src/server/instagram-post/build-post-search-flow.ts`：
  - `isYouTubeProvider`（providerName・表示名に「youtube」を含むか）で YouTube系を除外。
  - `removeLetterbox`：sharp の `trim` で黒帯を除去。条件は、横長画像のみ、左右は削られず上下だけ削られる、上下の削られた量がほぼ同じ、除去後の比率が1.6〜1.9。すべて満たす場合だけ採用し、それ以外・失敗時は元画像を使う。
  - 専用キャプション `buildSearchFlowCaption`（確認時点の注記入り。ハッシュタグは既存の `buildHashtags`）。
- `src/server/instagram-post/og-templates/search-flow/*`・`og-render-search-flow.ts`：
  - 3枚とも水色系の背景に、白いカード・検索窓・ロゴ用の白いピルを重ねる構成に変更。1枚目が最も濃い水色。
  - 1枚目：検索窓の下に作品サムネを最大3枚、少し傾けて並べる。画像がない作品は頭文字カードで代用。重複していたステップ表示の並びは削除。
  - 2枚目：「STEP 2 出演作品 → STEP 3 配信先」の列見出しと、1行ずつ「サムネ＋タイトル → 配信先バッジ（縦に並べる）」の2列表示に変更。タイトル36px、バッジは最大30px（サービス名が長い場合は幅に収まるよう縮小）。横長画像は横長の枠で表示。
  - 3枚目：CTAを白い帯に変更。ロゴ・コピーを拡大。

**設計上の判断・注意点：**
- **YouTube系除外の影響（全360人を集計）：** search-flow で投稿できる人物（配信先ありの作品が2件以上）は311人→278人に減る。減るのは主にアイドルグループのメンバーで、生成時に `InsufficientWorksError`（422）として分かりやすく止める。
- **既存の選定結果が変わっていないことの確認：** `selectTopWorks`（条件省略時）の360人分の結果（選定作品・配信先・除外候補・画像不適合）を変更前後で書き出し、バイト単位で完全一致することを確認した。
- **残っている課題：** 既存の作品分類（`getDisplayWorkType`）が、ゲーム配信・MV・シリーズ動画を映画・ドラマとして扱うケースがある（例：林瑠奈で「良質で文化的な最大限度の乃木坂46を営む。#5/#7/#8」の3件が並ぶ）。既存ロジックの問題のため今回は対象外。

**動作確認（ローカルの開発サーバー。Instagram APIへのリクエストなし）：** `/api/admin/instagram-post/generate`（`templateId: "search-flow"`）で4人分を生成した。
- 村山美羽：YouTube Vlogが除外され2件で生成。
- 濱岸ひより：3件で生成。
- 林瑠奈：YouTubeサムネの黒帯が除去されて横長の枠で表示。
- 大和里菜：配信先ありの作品が1件のため422で停止。

生成された画像はすべて1080×1080。`npx tsc --noEmit` エラー0。確認用の画像は `tools/canva-instagram/output/search-flow-preview/v2/`（commit対象外）。

---

## Task 66 — search-flow：Vercel Preview デプロイと実ブラウザ確認（Production未反映・未commit）

**目的：** Task 64・65 の search-flow を Vercel Preview 環境で確認する。

**手順：**
- worktree（`../oshi-search-searchflow-preview`、ローカルブランチ `preview/search-flow`、未commit・未push）に search-flow 関係の9ファイルだけを反映。
- worktree から `vercel deploy` すると、HEAD のコミット作者（ローカルPCのメールアドレス）がVercelチームの権限と一致せず、`BLOCKED` になった。
- そのため、worktree から `.git`・`node_modules`・`.next` を除いたコピー（`../oshi-search-searchflow-preview-copy`）を作り、そこから `vercel deploy`（`--prod` なし）を実行した。
- Preview URL：`https://oshi-search-tjju-jqvwe0qwu-yuujinn-stacks-projects.vercel.app`（target=preview、Deployment Protectionあり）。
- ブロックされた・中断したPreviewデプロイが2件残っている（`dpl_C9t5…`、`dpl_5qFk…`）。

**確認方法：**
- Playwright（Chromium）で、開発用OIDCトークンを `x-vercel-trusted-oidc-idp-token` ヘッダーに付けてアクセス。ヘッダーはPreviewのドメイン宛てのリクエストにだけ付与した。
- Previewでの新規生成は1回（村山美羽の search-flow、3枚）のみ。スマホ表示の確認では生成APIを呼ばず、PCで生成した結果をブラウザ内で差し込んで表示した。
- Instagram投稿・予約・DB書き込みの操作は一切行っていない。
- ローカルの `.env.preview` の `ADMIN_PASSWORD` は、Vercel上のPreview環境の値と一致していなかった（`.env.local` の値でログインできた）。

**結果：**
- 手動投稿画面の選択肢は既存4テンプレート＋「【Preview】検索体験」。予約・一括予約画面には出ない。
- 予約API（prepare）に `search-flow` を送ると `UNKNOWN_TEMPLATE`（400）。
- 生成は200で、3枚とも1080×1080。「Instagramに投稿」ボタンは表示されない。
- PC（1280px）・スマホ（390px）とも、ページ全体の横スクロールなし。
- 画面キャプチャと生成画像は `tools/canva-instagram/output/search-flow-preview/vercel-preview/`（commit対象外）。

---

## Task 67 — Instagram投稿テンプレート候補5種類をPreview専用で追加（未commit・Production未反映）

**目的：** 「出演作品まとめ」ではない切り口で、スクロールを止めてプロフィール → 推しサーチへ流入させるテンプレートを比較する。5種類とも手動投稿画面（`/admin/instagram-post`）でのみ選べるPreview専用とする。

**新規ファイル：**
- `src/server/instagram-post/candidates/data.ts`：人物データの集計（読み取り専用）。
  - 公開画面と同じ `filterPublicVodProviders` を通した確認済みの配信先だけを使い、表示名でまとめる。
  - YouTube系は search-flow と同じ `isYouTubeProvider` で除外。
  - 集計対象：「見られる」＝flatrate/free/ads、「サブスク」＝flatrateのみ。レンタル・購入は数えない。
  - 同じタイトルは1件にまとめる。所属グループと、同じグループの人物（最大3名）も取得。
- `src/server/instagram-post/og-templates/candidates/`
  - `theme.ts`・`shared.tsx`：共通部品。Page は「上部ロゴ＋残りの領域で中央寄せの本文＋overlay」の構造。
  - `curious-person.tsx`・`service-only.tsx`・`subscription-count.tsx`・`oshi-status.tsx`・`search-pain.tsx`：各テンプレートの3枚。
- `src/server/instagram-post/candidates/builders.ts`
  - `prepare*`（ページとキャプションを準備）と `finalize`（描画 → JPEG → Blob）に分けた。
  - `PREVIEW_CANDIDATE_BUILDERS`（ID→生成関数）。
  - 専用キャプション。
  - 作品画像は JPEG/PNG 以外を JPEG に変換（`toSatoriCompatible`）してから使う。

**既存ファイルへの追記：**
- `src/lib/instagram-templates.ts`：`PREVIEW_ONLY_INSTAGRAM_TEMPLATES` に5件追加（search-flow の定義は無変更）。
- `src/app/api/admin/instagram-post/generate/route.ts`：`Object.hasOwn(PREVIEW_CANDIDATE_BUILDERS, templateId)` の分岐を1つ追加。
- `src/app/admin/instagram-post/InstagramPostClient.tsx`：プレビューの正方形表示の判定を `isPreviewOnlyTemplate` に変更（works-only の判定は従来どおり）。

**設計上の判断・注意点：**
- データ不足時は生成しない（`InsufficientWorksError`）。
  - A・D：見放題・無料で配信確認できる作品0件（全360人中9人）。
  - B・C：見放題で配信確認できるサービス0件（全360人中12人）。
- A：グループ未設定の人物は「まず知りたい2つ」に切り替え、関連人物の項目は表示しない。
- B：作品数が最も多い見放題サービスを対象にする（同数ならサービス名順）。
- D：関連商品数は使わない。人物ページ側で AI 判定（verdicts）等を経て表示件数が決まり、同じ数を再現できないため。
- E：人物データを使わない。Blob のファイル名にも人物名を入れない。
- **既存の不具合（今回は修正していない）：** `detectImageMimeType` が WebP を JPEG として扱うため、WebP の作品画像（例：TVer）が選ばれると、既存の works-only・search-flow 等の描画が `RangeError: Offset is outside the bounds of the DataView` で失敗する。例として、松本若菜の既存テンプレートの選定1件目がこれに該当し、ローカル描画で失敗を再現した。新テンプレートでは `toSatoriCompatible` で回避している。

**検証：**
- 既存4テンプレート関連ファイルは HEAD から差分なし。
- search-flow 関連ファイルは Task 65 の worktree と同一。
- 予約・Cron・Instagram API・DB関連ファイルは差分なし。
- ブラウザ確認（ローカルの開発サーバー、Playwright）：
  - 手動投稿画面のみ5件表示。予約・一括予約画面には出ない。
  - 予約の prepare API は5件とも `UNKNOWN_TEMPLATE`（400）。
  - 5件とも生成は200で3枚・1080×1080（人物写真未登録の松村沙友理で実行、Blobに15枚）。
  - 「Instagramに投稿」ボタンは0件。PC・スマホとも横スクロールなし。
- ローカル描画（アップロードなし）：松本若菜・大和里菜・浅井恋乃未で、1〜3件、2〜20サービス、3桁の数字を確認。
- `npx tsc --noEmit` 成功、`npm run build` 成功。
- 画像は `tools/canva-instagram/output/template-candidates/`（commit対象外）。

---

## Task 68 — Instagram投稿テンプレート F〜I（人物ページUIベース）をPreview専用で追加（未commit・Production未反映）

**目的：** 「人物名を入口に、出演作品・配信先・関連商品までまとめて探せるサイト」であることを伝えるテンプレート4種類（F name-to-everything / G search-too-much / H watch-and-buy / I oshi-products）を、手動投稿画面でのみ選べるPreview専用として追加する。

**新規ファイル：**
- `src/server/instagram-post/site-ui/data.ts`：人物ページ（`src/app/person/[slug]/page.tsx`）と同じ手順で集計（読み取り専用）。
  - 出演作品・配信中・配信サービス・関連商品を算出する。
  - 配信は `getStreamingProviders`（見放題・無料・広告付き）。
  - 商品は verdict が `related` のものだけを使い、`classifyProduct`・`DISPLAY_SECTIONS` で振り分け、`applyDisplayOrder`・`sortUsedProducts` で並べる（新品＋中古）。
  - 人物ページ側の関数は export されておらず、page.tsx を変更しない方針のため、同じ処理を写した。人物ページのロジックを変える場合はここも更新すること。
  - 梅澤美波・江口雄也・克哉・松村沙友理の4人で、画像に載せる数字が人物ページの統計ボックスの表示と一致することを確認した。
- `src/server/instagram-post/og-templates/site-ui/`（`theme.ts`・`shared.tsx`・`types.ts`・`name-to-everything.tsx`・`search-too-much.tsx`・`watch-and-buy.tsx`・`oshi-products.tsx`）
  - 人物ページ「Graphic Pop」の配色・部品を再現：生成り＋ドット、黒罫線、オレンジ、「01 — WORKS」ラベル、統計ボックス、`getVodServiceStyle` のサービス色、検索窓。
  - 商品カテゴリはSVGアイコンで表す。
- `src/server/instagram-post/site-ui/builders.ts`
  - 準備（prepare）と確定（描画→Blob）に分けた。`SITE_UI_BUILDERS` を定義。
  - 描画は候補A〜Eの `renderPages` を再利用。
  - WebPの作品画像はJPEGへ変換して使う。

**既存ファイルへの追記：**
- `src/lib/instagram-templates.ts`：`PREVIEW_ONLY_INSTAGRAM_TEMPLATES` に4件追加。
- `src/app/api/admin/instagram-post/generate/route.ts`：`Object.hasOwn(SITE_UI_BUILDERS, templateId)` の分岐を1つ追加。

**設計上の判断・注意点：**
- **商品画像は一切使わない。** 楽天の商品画像をInstagram投稿に使ってよいか確認できないため、カテゴリのSVGアイコン＋実際の商品名で表す。商品名は、先頭の【…】の宣伝タグだけ表示時に除く。
- **生成しない条件：**
  - F・G：出演作品0件（該当者なし）。
  - H：配信中0件、または関連商品0件。
  - I：関連商品0件（全360人中10人）。
- F・Gは、商品0件なら関連商品のセクション・分岐を、配信0件なら配信先のセクション・分岐を表示しない。
- 表示する作品は「配信中の作品のうち映画・ドラマ優先 → 新しい順」。配信中の作品が無い人物は出演作品から選ぶ。

**検証：**
- ローカル描画（アップロードなし）：
  - 実データ6人：梅澤美波・江口雄也・克哉・齊藤京子（商品0件）・梶山朝日（作品1件）・吉田綾乃クリスティー（長い名前）。
  - 合成1件：商品1件・作品1件・VOD1サービス・長い作品名。
- 管理画面：梅澤美波（人物写真未登録）で4件とも生成は200・3枚・1080×1080（Blobに12枚）。
  - 「Instagramに投稿」ボタンは0件。PC・スマホとも横スクロールなし。
  - 予約・一括予約画面には表示されない。予約の prepare API は4件とも `UNKNOWN_TEMPLATE`（400）。
- 差分：既存4テンプレート・人物ページ・商品関連lib・予約・Cron・DBは差分なし。search-flow は確定版と同一。候補A〜Eは変更なし。
- `npx tsc --noEmit` 成功、`npm run build` 成功。
- 比較画像：`~/Downloads/oshi-instagram-template-v2/`。

---

## Task 69 — G・H・F最終調整と、実画面型 J（real-screen-demo）の追加（Preview専用・未commit・Production未反映）

**目的：** 最終候補 G（search-too-much）・H（watch-and-buy）・F（name-to-everything）を調整し、推しサーチの実際の画面を使う第4系統 J を追加して比較する。

**G・H・Fの調整（`src/server/instagram-post/og-templates/site-ui/` のみ）：**
- 3枚目の締め（`ClosingBrand`）：「気になる人を名前から検索 →」を主に、「プロフィールのリンクから推しサーチへ」を小さな補足にした。
- G：1枚目の検索窓に「1回目〜4回目」。2枚目に「~~検索4回~~ → 1回」の対比。
- H：1枚目の「観る」「買う」を200pxに拡大（サムネ・アイコンは外した）。買う側の説明は実データにあるカテゴリだけを「写真集・CD・Blu-ray/DVD・グッズ」の形で表示。2枚目の配信中・配信サービスのラベルを折り返さないようにした。
- F：1枚目の「名前を1回」を黒ベタで強調。統計ボックスにアイコン（`FilmIcon`・`PlayIcon`・商品）を追加。

**J 実画面型（新規・ローカル生成専用）：**
- `tools/canva-instagram/real-screen-demo/template.tsx`：3枚のページ構成。画面部分はすべて撮影画像で、架空のUIは描かない。
- `tools/canva-instagram/real-screen-demo/run.ts`：処理の流れは次のとおり。
  1. 人物を自動選択する（商品4カテゴリすべて・配信中20件以上・配信サービス5以上のうち、配信中＋商品数/4 が最大の人物）。
  2. 公開サイト（既定 https://oshi-search.jp）の人物ページをスマホ幅（390px・3倍解像度）で開き、遅延読み込みの画像を読み込ませる。
  3. 統計ボックスの数字を `site-ui/data.ts` の集計値と照合し、不一致なら中止する。
  4. ヘッダーの検索欄に人物名を入力する。
  5. ヒーロー／出演作品の見出し〜タブ／作品画像が正常に表示されている配信カード1件／関連商品の見出し〜カテゴリタブ（商品画像は含めない）を切り出して撮影する。
  6. 3枚を描画し、`tools/canva-instagram/output/real-screen-demo/<人物名>/` に保存する。
- 閲覧計測（`/api/track`）は `page.route` で遮断する（本番の閲覧数を増やさないため）。
- ヘッドレスブラウザが必要なため、管理画面の生成API（Vercel）には組み込まず、手動投稿画面の選択肢にも追加していない。
- 実行方法：`NODE_OPTIONS="--conditions=react-server" npx dotenv -e .env.local -- npx tsx tools/canva-instagram/real-screen-demo/run.ts [人物名]`

**注意点：**
- **本番の閲覧数を増やしてしまった：** 遮断を入れる前の確認作業で、本番の人物ページ閲覧数（Redis `/api/track`）を梅澤美波 +1・松本若菜 +4 増やした。元に戻す作業（本番Redisへの書き込み）は行っていない。
- **本番サイトの画像不具合：** 本番サイトの松本若菜の「今すぐ見られる作品」の先頭カード（6SixTONES）の画像が表示できていない（Jでは画像が正常なカードを選んで回避）。
- **撮影するカードの内容：** 自動で選ばれた配信カードが災害ドキュメンタリー（3.11〜東日本大震災15年…）だった。投稿前に人の目で確認が必要。

**検証：**
- 比較用の人物は、Jが自動選択した松本若菜（出演196／配信中149／商品76／配信16）で4案を統一した。
- 撮影した画面の数字と集計値は一致した。
- 既存4テンプレート・search-flow・予約・Cron・DB・package.json・人物ページは差分なし。
- `npx tsc --noEmit` 成功、`npm run build` 成功。
- Blob・DB・Instagram APIへの書き込みなし（上記の閲覧数を除く）。
- 比較画像：`~/Downloads/oshi-instagram-template-v3/`。

---

## Task 70 — H「観るもの・買うもの、まとめて」の人物選び画面と3枚Preview生成（Preview専用・未commit・Production未反映）

**目的：** Hを投稿できる人物を登録人物の中からおすすめ順に選び、選んだ人物のHの3枚をPreview生成できるようにする。Instagram投稿・予約・一括予約・自動選択・Cron・DBスキーマには触れない。

**Hの確定デザインを正式反映：** `src/server/instagram-post/og-templates/site-ui/watch-and-buy.tsx` を、比較で確定した3枚に置き換えた。
- 1枚目：「○○を追うなら」＋大きな「観る」「買う」＋「名前を入れるだけで、作品も、配信先も、推し活商品も。」＋「続きで一覧を見る →」
- 2枚目：「名前ひとつで、観るものも。買うものも。」＋観る（配信中・配信サービス・作品2件）／買う（関連商品・カテゴリ別件数、商品画像なし）
- 3枚目：公開サイトの人物ページ上部の撮影画像をスマホの枠に入れ、「推しの名前から、まとめて探せます。」＋「プロフィールのリンクから『推しサーチ』へ」。枠の高さは520pxを上限とし、人物ページ上部が長い人物でも見出し・案内文と重ならないようにした。

**新規ファイル：**
- `src/server/instagram-post/site-ui/person-screen.ts`：3枚目の撮影画像を取得する。
  - 撮影済みで、撮影時の統計ボックスの数字が現在の集計と一致すれば再利用する。
  - なければ、ローカル環境でだけ `tools/canva-instagram/h-screen/capture.ts` を `execFile`（シェルなし、人物名は引数）で実行する。Vercel上では撮影しない（`PersonScreenUnavailableError`）。
- `tools/canva-instagram/h-screen/capture.ts`：公開サイトの人物ページ上部をスマホ幅で撮影する。
  - 統計ボックスの数字が集計と一致しなければ中止する。
  - `/api/track` は遮断する（本番の閲覧数を増やさない）。
  - 出力は `tools/canva-instagram/output/h-screens/<人物名>/` のみ。
- `src/server/instagram-post/site-ui/h-candidates.ts`：全人物のH候補一覧（生成可否・おすすめ度）。10分間メモリにキャッシュする。
  - おすすめ度（100点）＝配信中（YouTube系のみの作品を除く）30点（ln、150件で満点）＋配信サービス（YouTube系除く）20点（16社で満点）＋関連商品 30点（ln、400件で満点）＋前回Instagram投稿からの経過 20点（未投稿・60日以上で満点）。
  - 人気度・検索需要などDBにない値は使わない。
- `src/app/api/admin/instagram-h/candidates/route.ts`（GET）、`src/app/api/admin/instagram-h/preview/route.ts`（POST）：Preview生成はJPEGのdata URLを返すだけ（Blob・DB・Instagram APIへの書き込みなし）。
- `src/app/admin/instagram-h/page.tsx`・`InstagramHClient.tsx`：候補一覧（順位・人物名・グループ・配信中・サービス・商品・登録作品・前回投稿・生成可否・おすすめ度）と「Hを生成」→3枚のPreview表示。
  - 「Instagramに投稿」ボタンはない。
  - ナビ・ハブページにはリンクを追加していない（URL直接：`/admin/instagram-h`）。

**既存のPreview用ファイルへの追記：**
- `site-ui/data.ts`：`SiteUiWork.youtubeOnly`、`streamingWorkCountExcludingYouTubeOnly`、`serviceCountExcludingYouTube` を追加（`isYouTubeProvider` で判定）。
- `site-ui/builders.ts`：
  - `checkWatchAndBuyEligibility` を追加（YouTube系のみの作品を除く配信中1件以上・YouTube系を除くサービス1以上・関連商品1件以上）。
  - `prepareWatchAndBuy` は、2枚目の作品をYouTube系のみの作品を除いて選び、3枚目に撮影画像を使う。
- `site-ui/types.ts`：`screen` を追加。

**注意点：**
- 画像内の「配信中」「配信サービス」の数字は、3枚目の撮影画面と一致させるため、人物ページと同じ（YouTube系も含む）。候補判定と2枚目の作品選びだけYouTube系のみを除外する。一覧には両方の数字を表示している。
- 手動投稿画面の「【Preview】H」も同じ生成処理になり、ローカルでは撮影が走る。Vercel上ではHは生成できない。
- `h-screens` はビルド時のファイル追跡で関数の同梱対象に入るが、Git管理外のためGitからのデプロイには含まれない。

**検証：**
- 候補：全360人中、生成可能342人。不可18人（関連商品0件：9人、YouTube系以外の配信中作品0件：9人）。
- 管理画面で久保史緒里（1位、初回撮影を含め約12秒）と松本若菜を生成した。3枚とも1080×1080で、撮影画面の数字と集計値が一致。閲覧計測の遮断は1件ずつ。「Instagramに投稿」ボタンは0件、スマホ幅でページの横スクロールなし。
- 既存4テンプレート・search-flow・予約・自動選択・Cron・DB・IG API・package.json・next.config.ts・vercel.json・Instagram管理ハブは差分なし。
- 新しいAPIの関数にPlaywrightは含まれない。
- `npx tsc --noEmit` 成功、`npm run build` 成功。

**追記（Task 70）：** 「おすすめ度」はInstagramでの人気度・検索需要・話題性を含まず、DB内の配信中作品数・配信サービス数・関連商品数・前回投稿からの経過日数だけで算出しているため、表示名を「H適性度」（並び順の表記は「H適性度順」）に変更した。対象は `src/app/admin/instagram-h/` の画面文言と、関連コードのコメントのみ。計算ロジック・変数名（`score` 等）は変更していない。

---

## Task 71：H「観るもの・買うもの、まとめて」を予約投稿・自動投稿に接続

**目的：** 管理画面で人が選んだ人物について、Hの3枚を生成・確認し、キャプションを確認・編集したうえで日時を指定して予約する。予約後は既存のCronが保存済みの3枚でカルーセル投稿する。人物の自動選択・自動ローテーションは行わない（H適性度は参考値）。

**設計：**
- Cron（`/api/cron/instagram-publish`）と `publishScheduleToInstagram` は、予約行に保存された `image_urls`（3枚）と `caption` だけで投稿し、テンプレートに依存しない。そのため、H予約は既存の `createSchedule` で `instagram_post_schedules` に1行保存するだけで投稿の流れに乗る。**Cron・投稿処理・二重投稿防止（`claimDueSchedule`）・failed／needs_review・通知は無変更。DBスキーマ変更なし。**
- 画像はPreview生成時にVercel Blob（`ig-posts/`）へ保存し、予約にはその同じURLを保存する（投稿時に再生成しない＝Previewと投稿画像が一致）。
- 3枚目はTask 69の撮影画像をやめ、人物ページ上部（ヘッダー・パンくず・PROFILE / PERSON・頭文字・人物名・統計ボックス4つ）を、人物ページと同じ集計の実データからサーバー側で描画する（案A）。ブラウザ撮影（案C：Vercel HobbyでChromiumが不安定、Task 34で撤去済み）と、サイトのCSSをそのまま描く案B（Satoriが対応しない）は不採用。これによりVercel上でも3枚とも生成できる。
- H（`watch-and-buy`）は `INSTAGRAM_TEMPLATES`／`SCHEDULE_TEMPLATE_OPTIONS` に入れない。既存の予約・一括予約画面の選択肢、既存予約APIの検証（`getInstagramTemplateMeta`）、自動（おすすめ）選択・ローテーションには現れない。

**変更ファイル：**
- 新規 `src/server/instagram-post/og-templates/site-ui/person-page-screen.tsx`：3枚目のスマホ画面内の人物ページ上部を描画する。
- `og-templates/site-ui/watch-and-buy.tsx`：3枚目を `PersonPageScreen` に置き換え。`types.ts`：`screen` を削除し `genre` を追加。
- `site-ui/data.ts`：`genre` を追加。`site-ui/builders.ts`：`toTemplateData` で `genre` を設定。撮影画像の取得を削除。キャプション・ハッシュタグ生成は `h-schedule.ts` から読み込む。
- 新規 `src/server/instagram-post/site-ui/h-schedule.ts`（純粋関数）：
  - `buildWatchAndBuyCaption`（指定の文面、人物名を差し込む）、`buildWatchAndBuyHashtags`。
  - `validateHScheduleInput`：画像は自サイトのBlob `ig-posts/` のhttps URLちょうど3枚、未来日時、キャプション空・2200字超・ハッシュタグ30個超を拒否。
- `src/app/api/admin/instagram-h/preview/route.ts`：`SITE_UI_BUILDERS` で生成し、Blob URLを返す（DB・Instagram APIへの書き込みなし）。
- 新規 `src/app/api/admin/instagram-h/schedule/route.ts`（POST）：入力チェック後、既存の `createSchedule` で予約を保存（`template_id='watch-and-buy'`）。
- `src/lib/instagram-templates.ts`：
  - `H_TEMPLATE_ID` と表示専用の `H_SCHEDULE_TEMPLATE_META` を追加。
  - `getScheduleTemplateMeta` がH予約の表示名「H 観るもの・買うもの、まとめて」を返すようにした（予約一覧・通知・ハブの表示用）。
- `src/app/admin/instagram-h/page.tsx`・`InstagramHClient.tsx`：生成→3枚確認→キャプション編集（文字数、生成時に戻す）→日時（おすすめ 09:00/15:00/20:00）→確認ダイアログ→予約。予約後は予約一覧・Instagram管理へのリンクを表示。既投稿の人物と、同じ日時の既存予約には警告を出す。
- 削除：`src/server/instagram-post/site-ui/person-screen.ts`、`tools/canva-instagram/h-screen/`（撮影処理）。
- 新規テスト `src/lib/__tests__/instagram-h-schedule.test.ts`（11件）：
  - キャプション・入力チェック、Hが既存の選択肢・検証に含まれないこと。
  - Graph APIをモックした投稿処理：子コンテナが1→2→3の順、CAROUSELのchildren／caption、`media_publish` の失敗が `AmbiguousPublishError`（needs_review）、公開済みは再投稿しない。

**注意点：**
- 既存の自動（おすすめ）は `getMostRecentTemplateId`（直近の予約のテンプレート）を回転の起点に使う。H予約が直近にあると、その次の自動選択の起点がHになる（Hは候補外なので先頭の既存テンプレートから回る想定だが、未検証）。
- `/admin/instagram-h` へのリンクはナビ・ハブに未追加（URL直接）。
- 3枚目は撮影画像ではなく、人物ページ上部の再構成。プロフィールのタグ・紹介文は描いていない。

**検証（実投稿なし）：**
- ローカル：
  - 管理画面から松本若菜のHを生成し、キャプションを編集して2027/12/31 20:00で予約した（ID 38）。保存された画像URLはPreviewと同一で、編集後のキャプションも保存された。予約一覧に「H 観るもの・買うもの、まとめて」と表示された。
  - ID 38だけを対象に、Cronと同じ関数で検証した：
    - 予定日時を一時的に過去へ変更すると、処理対象一覧に入った。
    - 同時に2回claimすると成功は1回だけ。処理中の3回目はnull。
    - release後はscheduledに戻った。
    - failedでは再試行対象に残った。needs_reviewでは対象外になった。
    - 通知は重複作成されず、Instagram管理の要対応欄に表示された。
  - 検証の最後に予定日時を未来へ戻し、テスト予約・通知2件・テスト画像6枚は削除した。ほかの予約（処理対象0件）には触れていない。
- Vercel Preview（git外コピーからデプロイ、Productionへの反映なし）：久保史緒里の3枚が7.7秒で生成された（3枚目も含む）。予約はしていない（本番DB共有のため）。確認後、画像3枚を削除した。
- `npx tsc --noEmit` 成功、`npx vitest run` 66ファイル1472件成功、`npm run build` 成功。

---

## Task 72：Production反映前の確認（API access blocked の調査・Hの自動選択からの除外・導線追加）

**1. API access blocked の調査結果（コードの問題ではない。Meta側の制限）**
- 失敗3件（ID 31〜33、2026/9/23の3枠）はすべて `failed`（attempts 3）で、`media_publish` より前の段階で拒否されていた（needs_review ではない＝未公開と断定できる）。9/21・9/22は同じ仕組みで投稿に成功している。
- ローカルの `IG_ACCESS_TOKEN`（`tools/instagram-post-generator/.env.local` と同一）で、読み取り専用のAPIを確認した。
  - `GET /me`、`GET /{IG_USER_ID}`、`content_publishing_limit`、`/media` の一覧が、すべて `API access blocked.`（HTTP 400 / code 200 / OAuthException）。
  - 投稿系のAPIだけでなく、プロフィール取得も拒否されている。
- 無効なトークンでは code 190（`Failed to decrypt`）、トークンなしでは code 190（`Invalid OAuth 2.0 Access Token`）になる。今回は code 200 のため、トークン自体は有効（期限切れ・形式不正ではない）で、Meta側がこのアプリ／アカウントのAPI利用を止めている状態。
- Productionの環境変数はSensitive設定のため値を取得できず、直接の比較はできない。ただし、Productionでも9/23から同じ応答になっている。
- コード（エンドポイント・パラメータ）の変更で直る問題ではない。Meta for Developers／Instagramアカウント側の確認が必要。

**コード変更：**
- `src/server/instagram-post/graph-client.ts`：Graph APIのエラーメッセージに「（HTTP 400 / code 200 / OAuthException / fbtrace_id …）」を付けるようにした（`formatGraphErrorDetail`）。
  - 予約一覧・通知・手動投稿画面のエラー表示から、原因の切り分けとMetaサポートへの問い合わせ（fbtrace_id）ができる。
  - Metaが返すエラー情報のみで、トークンは含まない。
- `src/server/instagram-schedule/schedule-store.ts`：`getMostRecentTemplateId` の対象を、自動選択の候補テンプレート（`INSTAGRAM_TEMPLATES`）の予約だけにした。
  - 修正前は直近の予約がHだと基準が `watch-and-buy` になり、ローテーションが先頭（works-only）に戻っていた。
  - 既存の予約はすべて4テンプレートのいずれかなので、既存データでの結果は変わらない。
- `src/app/admin/instagram/page.tsx`：Instagram管理のカードに「H投稿を作成（観るもの・買うもの）」（→ `/admin/instagram-h`）を追加。カードが5枚になったため、PCの列数を4→3にした。
- `src/app/admin/instagram-h/InstagramHClient.tsx`：前回投稿日・集計日時をAsia/Tokyo固定で表示（集計日時に「JST」を付記）。
- 新規テスト `src/lib/__tests__/instagram-h-auto-exclusion.test.ts`（4件）：
  - 自動の候補にHが含まれない。
  - どの「直前テンプレート」からでもHが選ばれない。
  - 既存のローテーション順は変わらない。
  - エラー詳細の書式。

**検証（Instagramへの送信なし）：**
- 自動選択（読み取り専用で確認）：H予約の前後で、基準テンプレート（works-only）と、3人（久保史緒里・松村北斗・田中樹）の自動解決結果（works-picks）が同じだった。修正前のクエリでは、H予約後に基準が `watch-and-buy` になることも確認した。
- Instagram管理のカード → `/admin/instagram-h` → 生成 → キャプション編集 → 2027/12/31 20:00で予約（ID 39）。保存された画像URLはPreviewと同じで、編集後のキャプションも保存された。一覧の表示名もHになっていた。
- 本物のCronハンドラ（`GET /api/cron/instagram-publish`）をローカルのプロセス内で直接呼んだ。Instagramへのfetchはすべてプロセス内の偽応答に差し替え、外部には送っていない。処理対象がID 39以外にもある場合は中止する設定で実行した。
  - dryRunを同時に2回実行：`dry-run-ok` は1件だけで、APIの呼び出しは0回。
  - 子コンテナ作成で `API access blocked` を返す：`failed`（attempts 1）。エラーに code 200 等が付いた。
  - 再試行で `media_publish` が通信失敗：`needs_review`。処理対象から外れた。
  - 正常系：保存済みの3URLが1→2→3の順で子コンテナになり、CAROUSEL（children 3件・保存済みキャプション）→ `media_publish` → `published`。
  - 再度Cronを実行すると対象0件。直接呼んでも `AlreadyPublishedError`。
  - 後片付けとして、通知2件・投稿履歴（偽media_id）1件・予約ID 39・テスト画像3枚を削除した。
- Cron：`vercel.json` は UTC 0:00／6:00／11:00（JST 9:00／15:00／20:00）。管理画面の日時は `jst-time`（Asia/Tokyo固定）で入力・表示している。
- `npx tsc --noEmit` 成功、`npx vitest run` 67ファイル1476件成功、`npm run build` 成功。PC・スマホ幅で横スクロールなし。

---

## Task 73：H「観るもの・買うもの、まとめて」のProduction反映

**目的：** Hを本番1件テストできる状態にする（この段階では予約・実投稿は行わない）。

**事前対応：**
- 9/23の失敗予約（ID 31 京本大我・32 ジェシー・33 田中樹。いずれも「API access blocked」で failed、試行3回、media_id なし＝未投稿）を、既存の `cancelSchedule`（管理画面の「キャンセル」と同じ処理）で cancelled にした。
  - 再実行はしていない。Instagram APIは呼んでいない。他の予約は変更していない。
  - 未読通知（ID 7〜15）は残っている（「確認済みにする」で消せる）。
- Instagram APIの接続：新しい `IG_ACCESS_TOKEN`（Production・ローカル共通）で、読み取り専用のAPIがすべて成功した（@oshisearch_jp、IG_USER_ID一致、投稿上限の取得可）。

**commit対象：**
- H本体（`/admin/instagram-h`、`/api/admin/instagram-h/*`、`site-ui/`、`og-templates/site-ui/`）
- Hがimportする共通処理（search-flow・候補A〜Eの描画／データ関数。画面から呼ばれる経路はない）
- 既存ファイルの変更：`instagram-templates.ts`・`schedule-store.ts`・`graph-client.ts`・`admin/instagram/page.tsx`・`person-data.ts`・`work-selection.ts`
- テスト2件と本ログ

**除外したもの：**
- 公開サイトのデザイン試作（`layout.tsx`、`DesignPrototype*`）
- `drizzle/0005` の変更
- 「 2」付きの重複ファイル
- 手動投稿画面へのPreview専用テンプレート追加（`InstagramPostClient.tsx`・`generate/route.ts`）
- 検証スクリプト・出力物
- `tools/instagram-post-generator/`、`.env*`

commit前に、除外したものを含まない状態（HEAD＋commit対象のみ）で、tsc・全テスト・buildが成功することを確認した。

---

## Task 74：H を既存のInstagram予約画面（/admin/instagram-schedule）へ統合

**目的：** Hを別システムにせず、既存の予約画面のテンプレートの1つとして使えるようにする。人物選択・通常予約・一括予約・1週間分・枠割当・予約一覧・予約API・Cronは既存のものを共用する。

**変更：**
- `src/lib/instagram-templates.ts`：
  - `SCHEDULABLE_TEMPLATES`（既存4テンプレート＋H）と `getSchedulableTemplateMeta` を追加。
  - `SCHEDULE_TEMPLATE_OPTIONS` の末尾に「H 観るもの・買うもの、まとめて」を追加。`getScheduleTemplateMeta` は選択肢から引くだけにした。
  - `INSTAGRAM_TEMPLATES` は変更していない。自動（おすすめ）の候補・ローテーション（`getEligibleTemplates`／`getMostRecentTemplateId`）と手動投稿画面にHは入らない。
- `src/server/instagram-post/template-builders.ts`：`TEMPLATE_BUILDERS` に H（`SITE_UI_BUILDERS['watch-and-buy']`）を登録。Hの生成処理自体は変更なし。
- `src/server/instagram-schedule/prepare.ts`、`api/admin/instagram-schedule/route.ts`・`bulk/route.ts`：テンプレートの検証を `getSchedulableTemplateMeta` にした。
- 新規 `src/lib/instagram-caption-rules.ts`：`validateCaption`（空・2200文字超・ハッシュタグ30個超を拒否）。予約API（通常・一括）と編集欄で共用する。
- 新規 `src/app/admin/instagram-schedule/CaptionEditor.tsx`：キャプション編集欄（文字数表示・生成時に戻す）。通常予約・一括予約の両方で、全テンプレート共通で使う。
- `InstagramScheduleClient.tsx`：
  - `?template=` で予約できるテンプレートを初期選択し、一括予約タブにも渡す。
  - キャプションを編集できるようにした。上限を超えると予約ボタンが無効になる。
  - Preview画像を切り抜かずに元の比率で表示する（Hは正方形）。
- `BulkScheduleClient.tsx`：
  - `initialTemplateId` を受け取るようにした。
  - 「1週間分を作成」に切り替えるとテンプレートは従来どおり「自動」に戻るが、Hを選んでいる場合はHのままにする（Hは自動では選ばれないため）。
  - 行ごとにキャプションを編集できる。上限を超えた行があると一括予約できない。
  - サムネイルは元の比率で、行の半分の幅に広げた。クリックすると原寸で開く。
- `src/app/admin/instagram/page.tsx`：「H投稿を作成」カードの移動先を `/admin/instagram-schedule?template=watch-and-buy` にした。
- `/admin/instagram-h`：上記URLへのリダイレクトだけを残した。
- 削除：H専用の画面・API（`InstagramHClient.tsx`、`/api/admin/instagram-h/{candidates,preview,schedule}`）、`site-ui/h-candidates.ts`（H適性度）、`h-schedule.ts` 内の検証関数（`validateCaption` へ統合）。
- テスト（`instagram-h-schedule.test.ts`）：
  - 選択肢の並び。
  - H は予約できるが、自動の候補・手動投稿には入らない。
  - Preview専用テンプレートと「自動」は予約APIで拒否される。
  - 通常予約・一括予約のAPIで template_id=watch-and-buy が保存される（DBはモック）。
  - 長すぎる・空のキャプションは拒否される。

**注意点：**
- 既存の一括予約の枠割当は、過去の枠（開始日が今日のときの経過済みの時刻）も割り当てる。予約APIが過去日時を拒否するので登録はされないが、画面上は並ぶ（従来からの挙動で、今回は変更していない）。
- 1週間分でも、既存予約の枠をスキップした分だけ8日目にかかる（例：9/30開始で9/30 20:00が予約済みなら、21人目は10/7 09:00）。これも従来の `allocateBulkSlots` の挙動。
- 通常予約の日時の初期値は、従来どおり「今日 09:00」。それを過ぎた時刻に開くと、「過去の日時」の表示が出て予約ボタンが無効になる。

**確認（ローカル。予約の登録POSTはネットワーク層で遮断し、0件）：**
- 導線：カード → `/admin/instagram-schedule?template=watch-and-buy` で「H」が選択済み。`/admin/instagram-h` もここへ転送される。
- 通常予約：
  - 松本若菜をHで生成した（1080×1080×3）。キャプションの編集と「生成時に戻す」も動作した。人物写真の必須表示は出ない。
  - 「自動（おすすめ）」で久保史緒里を生成すると works-only に解決された（Hにならない）。
- 一括予約：
  - Hが初期選択されていた。「乃木坂46」の検索で絞り込めた。
  - 3人を選び、選択順（梅澤美波→山下美月→久保史緒里）が保持された。
  - 開始日9/30では、予約済みの9/30 20:00（ID 40）がスキップされた。
  - 2人の一括生成で、各1080×1080×3と、行ごとのキャプション編集欄が出た。
- 1週間分：
  - Hのまま切り替わった。21人で上限表示になり、22人目は選べない。
  - 21件の枠に配置された。
- PC・スマホ幅で横スクロールなし。
- テスト用に生成した画像12枚は削除した（予約・投稿が参照している画像は除外して削除）。
- 予約テーブル全体・ID 40・instagram_posts はハッシュが一致し、変更なし。Instagramの最新投稿は9/22のまま。
- `npx tsc --noEmit` 成功、`npx vitest run` 67ファイル1479件成功、`npm run build` 成功。

---

## Task 75：一括予約に「人物固定・テンプレを変える」を追加（自動ローテーション／手動で選択）

**前提：** 依頼時点で「人物固定・テンプレを変える」は未実装だった（main・全ブランチ・worktree・stash・未commitのどこにもない）。依頼の仕様に沿って新規に作った。

**目的：** 一括予約で、1人の人物について枠ごとにテンプレートを変えて予約できるようにする。テンプレートは自動ローテーション（複数選択・選択順）と手動選択の両方に対応する。従来の配置（人物を変える・テンプレ固定）はそのまま残す。

**変更：**
- 新規 `src/lib/instagram-template-plan.ts`（純粋関数）：
  - `assignTemplatesToSlots`：rotation／manual-slot／manual-sequence。
  - `pastSlotIsos`：開始日〜今日の、過去になった枠。
  - 枠の割り当て自体は既存の `allocateBulkSlots` をそのまま使う（予約済み枠のスキップも含む）。
- 新規 `src/app/admin/instagram-schedule/TemplatePlanSettings.tsx`：テンプレート設定方法（自動ローテーション／手動で選択）のUI。
  - 自動ローテーション：予約できる全テンプレート（既存4＋H）のチェックリスト。選んだ順番を番号で表示する。
  - 手動（通常＝1日分）：投稿時刻ごとにテンプレートを選ぶ。
  - 手動（1週間分）：テンプレート列を並べる（追加・並べ替え・削除。同じテンプレートの重複も可）。その列を空き枠順に繰り返す。
- `BulkScheduleClient.tsx`：
  - 「配置方法」（人物を変える・テンプレ固定／人物固定・テンプレを変える）を追加した。既定は従来の方。
  - 人物固定では、次のようにした。
    - 人物は1人まで（既存の PersonMultiSelect の `maxSelected=1`）。
    - 1日あたり投稿数（1〜3件）を「通常」でも選べる。
    - 件数は、通常＝開始日の1日分、1週間分＝7日分。
    - 予約済みの枠に加えて、現在時刻を過ぎた枠もスキップする。
    - 配置プレビューにテンプレート列を出す。
    - 入力が不足していると、エラー表示を出して生成ボタンを無効にする。
    - 生成は枠ごとに割り当てたテンプレートIDで既存の prepare API を呼ぶ。予約は既存の一括予約APIで行う（行ごとの templateId をそのまま保存）。
    - Preview・確認ダイアログにもテンプレート名を表示する。
  - 従来モードの処理（配置・自動テンプレートのローテーション・テンプレート選択）は、分岐で残しており変更していない。
- テスト：新規 `instagram-template-plan.test.ts`（10件）。
  - A,B,C × 1日3件。
  - A,B × 1日3件（A,B,A…と続く）。
  - 1週間分21枠。
  - 予約済み枠のスキップ後も順番を保つこと。
  - 手動（時刻ごと・列の繰り返し・未指定）。
  - 過去枠の除外。

**注意点：**
- 投稿時刻は既存の「1日あたり投稿数」と同じ定義（1件＝09:00、2件＝09:00/15:00、3件＝09:00/15:00/20:00）。
- 過去枠のスキップは人物固定モードだけ。従来モードの配置（開始日が今日だと過去の時刻も並ぶ）は変更していない。
- 予約済み枠をスキップした分は、従来どおり後ろの日へずれる。
- DBスキーマ・予約API・Cron・投稿処理は変更なし。各枠が既存どおり personName＋templateId＋scheduledAt の1行として保存される。

**確認（ローカル。予約POSTは遮断して0件、Meta通信0件）：**
- 従来モード：2人・作品・配信情報で配置どおりに生成された（templateId は works-only のまま）。
- 人物固定：
  - 1人で上限表示になり、2人目は選べない。テンプレート未選択ではエラーが出て、生成ボタンが無効になる。
- 自動ローテーション：
  - H→作品・配信情報→サブスク比較（1日3件、開始9/30）：9/30の過去枠と予約済み20:00（ID 40）をスキップし、10/01 09:00 H、15:00 作品、20:00 サブスク。
  - 1日2件（A,B）でA,B。1日3件（A,B）でA,B,A。
  - 1週間分（A,B,C）で21件、10/01〜10/07まで毎日 H／作品／サブスクの順。
- 手動：
  - 1週間分で列（作品,H,サブスク,出演作3選）が空き枠順に繰り返された。列が空のときはエラー。
  - 1日1件（09:00→H）。1日3件で未指定の枠があるとエラー。全部指定すると時刻ごとに配置された。
- 生成：目黒蓮×3枠（H／works-only／vod-compare）。すべて1080×1080×3。行ごとのテンプレート名、キャプション編集・「生成時に戻す」も動作した。
- PC・スマホ幅で横スクロールなし。
- テスト用に生成した画像15枚は削除した。予約テーブル全体・ID 40・instagram_posts は変更なし（ハッシュ一致）。
- `npx tsc --noEmit` 成功、`npx vitest run` 68ファイル1490件成功、`npm run build` 成功。
- 同期で復活していた旧H API（`src/app/api/admin/instagram-h/schedule/route.ts`。0851041 と同一内容・未追跡）が型チェックを壊していたため、ローカルから削除した。

---

## Task 76：一括予約を1日1〜10件・投稿時刻指定（1時間単位）に対応し、自動投稿Cronを毎時24本に変更

**目的：** 1日最大10件（1週間で最大70件）を、自分で選んだ時刻（1時間単位・JST）に予約・自動投稿できるようにする。

**Cronの判断：**
- Vercel Hobby は、1本のCronが1日1回まで（それ以上の頻度はデプロイ時にエラー）で、実行は指定時刻から最大59分遅れる（公式ドキュメント 2026-07-15 時点。プランはAPIで hobby と確認）。
- 利用者の選択によりA案を採用：Hobbyのまま、`/api/cron/instagram-publish` を毎時0分の24本（`0 0 * * *`〜`0 23 * * *`、各1日1回）にした。
- 他のCron（refresh・vod-refresh・vod-recheck）は変更なし。合計27本（上限100本）。
- Cronの処理（期限を迎えた予約の取得・条件付きclaimによる二重投稿防止・status・1回最大5件）は変更なし。

**Instagramの上限：** `content_publishing_limit`（読み取り）で24時間に100件。カルーセルは1件と数えるので、1日10件は収まる。

**変更：**
- `vercel.json`：Instagram自動投稿のCronを3本→24本（毎時0分・各1日1回）。
- 新規 `src/lib/instagram-post-times.ts`（純粋関数）：
  - 最大10件、時刻の選択肢（00:00〜23:00）。
  - 件数ごとのプリセット。1〜3件は従来の 09:00/15:00/20:00 の先頭n件と同じ。
  - `validatePostTimes`：件数との一致・空欄・重複・1時間単位でない時刻を拒否。
  - `sortPostTimes`（昇順）。
  - `evaluatePublishingQuota`：直近24時間の投稿済み数＋今後24時間の予約、または任意の24時間に入る件数が上限の80%以上なら警告する。
- 新規 `src/app/api/admin/instagram-schedule/publishing-quota/route.ts`：
  - 既存コードにquota確認がなかったため追加した。読み取り専用で、`GET /{ig-user-id}/content_publishing_limit` を呼ぶ。
  - エラー文は `maskSecrets` で秘密情報を伏せる。
- 新規 `src/app/admin/instagram-schedule/PostTimesEditor.tsx`：
  - 1日あたり投稿数（1〜10件）と、件数ぶんの時刻欄（1時間単位のプルダウン）。
  - 重複・未入力は色で表示し、「初期時刻に戻す」がある。
  - Hobbyの仕様で最大約1時間遅れることを明記した。
- `BulkScheduleClient.tsx`：
  - すべてのモード（人物を変える／人物固定、通常／1週間分）で、設定した時刻を1日の投稿枠として使う。既定は従来どおり3件（09:00/15:00/20:00）。
  - 1週間分の上限は、従来モードが7日×件数人（最大70人）、人物固定モードが7日×件数枠（最大70件）。
  - 両モードとも、予約済みの枠に加えて過去の時刻の枠をスキップする。開始日が過去の場合はエラーにする。
  - 配置プレビューに日付・投稿予定時刻・人物・テンプレートの列を出す。従来モードは選んだテンプレート名、自動なら「自動（生成時に決定）」。
  - 投稿上限の警告を、配置プレビューと一括予約の確認ダイアログ（除外後の件数で再計算）に出す。
  - 従来モードは選んだ人数ぶんだけ配置し、同じ人物を繰り返さない（画面に明記した）。
- `InstagramScheduleClient.tsx`（通常予約）：
  - 「Cronは1日3回」の注意書きを更新した。
  - 分を指定した時刻（例 10:30）は次の時間帯に投稿されることを表示する。
- テスト：
  - 新規 `instagram-post-times.test.ts`：
    - プリセット・入力チェック・昇順。
    - 1/2/3/5/10件 × 人物固定（自動・手動）／人物を変える。
    - 日をまたぐローテーション継続（H,作品,サブスク,出演作3選 × 5件）。
    - 1週間×1/3/10件（70件）と、途中の予約済み枠のスキップ。
    - 過去枠の除外、上限警告。
    - vercel.json（24本・各1日1回・他のCronは不変・100本以内）。
  - 新規 `instagram-cron-hourly.test.ts`：本物のCronハンドラを、メモリ上の予約ストア（実物と同じdue条件・条件付きclaim）で実行した。
    - 1日10件が各時間帯で1件ずつ投稿される。
    - 既存の 09:00/15:00/20:00 の予約もその時間帯に処理される。
    - 3本同時に実行しても二重投稿しない。
    - 1回最大5件で、残りは次のCronで処理される。
  - `instagram-h-schedule.test.ts` に、一括予約APIで70件を保存できるテストを追加。

**注意点：**
- 1時間単位のため、同じ時間帯に予約を複数入れることはできない（重複時刻は不可）。時刻どおりに1件ずつ投稿される。
- 実際の投稿は、指定時刻〜その時間の59分まで（Hobbyの仕様）。
- 通常予約の時刻入力は分まで選べるままにした。毎時0分以外は次の時間帯に投稿される旨を表示する。
- 変更していないもの：DBスキーマ・予約API・Cronハンドラ・投稿処理・`allocateBulkSlots`。

**確認（ローカル。画像生成はブラウザ側の偽応答でBlobに書き込まない。予約・キャンセル等のPOSTは内容を記録して遮断。Instagramへの通信0件）：**
- 初期値は3件（09:00/15:00/20:00）。選択肢は1〜10件、時刻は24個。
- 従来モード（H・5人・1日5件）：09:00 目黒蓮／12:00 梅澤美波／15:00 久保史緒里／18:00 松本若菜／20:00 松村沙友理。予約APIへの送信内容も同じ。
  - 1日10件・5人でも5件だけ（人物を繰り返さない）。
  - 1/2/3件は日をまたいで割り当てられる。
- 入力エラー：同一時刻・未入力・過去の開始日で、エラーが表示され生成ボタンが無効になる。
- 人物固定：
  - 自動ローテーション（4テンプレ）×1日5件で H→作品→サブスク→出演作3選→H。2日目は作品から始まる（日をまたいでも継続）。
  - 1週間×5件＝35件、×1件＝7件、×3件＝21件。
  - 1週間×10件＝70件：予約APIへの送信70件、日時の重複0、4テンプレの順が70件通して継続。
  - 手動：1週間の列（H,作品）、1日5件の時刻ごと（未指定はエラー）。
  - 自動：1日1/2/3/10件はプリセットの時刻どおり。
- 開始日を今日（9/30 20:28時点）にすると、9/30の過去の時刻と予約済み20:00を飛ばして21:00から配置された。
- 上限警告：偽の上限（直近95件/100件）で警告が出た。実際のAPIは quota_usage 1／100。
- PC・スマホ幅（1日10件・1週間70件）で横スクロールなし。
- 予約テーブル・ID 40・instagram_posts はハッシュ一致で変更なし。
- `npx tsc --noEmit` 成功、`npx vitest run` 70ファイル1517件成功、`npm run build` 成功。
- 確認中の9/30 20:24、本番の既存Cronで予約ID 40（目黒蓮・H）が投稿された（published、media_id 18129657334761103）。この確認とは無関係。

---

## Task 77：Instagramテンプレート G・J のデザイン比較用Preview（未実装・ローカルのみ）

**目的：** G「推し活、検索しすぎ問題」とJ「実際の画面で見せる」の新しい3枚構成を、H（変更なし）と並べて比較する。本番テンプレートとしてはまだ実装しない。

**新規（`tools/canva-instagram/gj-preview/`。src は変更なし）：**
- `templates.tsx`：G・Jの3枚ずつ（1080×1080）。
  - H の部品（配色 `theme.ts`、ロゴ・検索欄・アイコン等の `shared.tsx`、人物ページ上部の再構成 `PersonPageScreen`）をそのまま使う。
  - 見分け方：H＝生成りのドット背景＋黒枠ブロック、G＝黒背景が主役（悩み→解決）、J＝白背景に実際のサイト画面（検索欄・人物ページ）を大きく見せる。
  - 数字（出演作品・配信サービス・関連商品・配信中）は人物ページと同じ集計（`fetchSiteUiPersonData`）の値をそのまま使う。
  - J2の配信サービス欄だけは、配信中の作品数が多い上位4社を出す（実データ）。作品は自動では選ばない。
- `run.ts`：読み取り専用。人物データを読み、G・Jと比較用のH（既存の `prepareWatchAndBuy` のページをそのまま描画。Blobへはアップロードしない）を描画する。
  - 出力は `tools/canva-instagram/output/gj-preview/<人物名>/` の9枚と `compare_HGJ.jpg` のみ。
  - 実行：`NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local tools/canva-instagram/gj-preview/run.ts 久保史緒里`

**注意点：**
- 以前のJ（`real-screen-demo/`、本番の人物ページを撮影する方式）は変更していない（保留中の修正2点も未着手）。
- 新しいJは画面をサーバー側で描画するため、本番の人物ページへアクセスしない（閲覧数も増えない）。作品カードの自動選択もしない。
- G3の見出し「推しの名前から、まとめて探せます。」は指定どおりで、H3と同じ文言。
- DB・Blob・Instagram・予約・Cron には触れていない。

**追記（Task 77 v2・ユーザーの確認後の修正。引き続きPreviewのみ）：**
- 前回版は `output/gj-preview/<人物名>/v1/` に残した。`compare_G_v1_v2.jpg`・`compare_J_v1_v2.jpg` で前回版と並べて見られる。
- 役割の分担：H＝機能を一瞬で理解させる、G＝「検索しすぎ」の共感から入る、J＝実際のサイトを使う体験を見せる。
- G1：
  - 広告バナーに見えやすかった「傾けた白い吹き出し」と「全面オレンジの帯」をやめた。
  - 代わりにスマホの「最近の検索」（時計アイコンの検索履歴）で3つの疑問を見せる。
  - 下部は「これ、1か所で探せます。」の「1か所」だけオレンジ＋下線。
- G3：H3と同じ見出し・スマホ画面だったので作り直した。
  - 「その検索、1回でよくない？」
  - →「作品を探す／配信先を探す／商品を探す」の3つの検索
  - ↓「推しサーチなら、まとめて検索。」＋人物名入りの検索欄
  - CTA「気になる推しができたら プロフィールから『推しサーチ』へ」
- J1：「（人物名）、検索してみた。」を大きく出した。
  - サイトのヘッダー（ロゴ＋人物名入りの検索欄＋検索ボタン）の下に、検索結果として人物ページ上部（頭文字・PROFILE / PERSON・人物名・グループ）を置いた。
  - 出演作品・配信サービス・関連商品の件数（実データ）を出す。
- J2：見出しを2行（「検索すると、」「こんな感じ。」）にした。右の数字（スマホ画面と重複）は削除した。
  - スマホ画面を大きくした（幅540→610）。
  - 右に「作品を見る → 配信先を確認 → 気になる商品も」の流れを置いた。
- J3：見出し「気になる作品、どこで見れる？」。
  - 人物ページの「配信中の作品」欄を大きく再構成した：人物名・配信中の件数と、作品3件（画像・作品名・配信サービス）。
  - 作品は H 2枚目と同じ選び方（配信中・映画/ドラマ優先、配信先がYouTube系だけの作品を除く、先頭3件）。画像の読み込みも H と同じ手順。
  - 下部は「出演作品から見られるサブスクまでそのまま確認。」とCTA「プロフィールから『推しサーチ』へ」。

---

## Task 78：G「推し活、検索しすぎ問題」・J「実際の画面で見せる」を予約テンプレートとして本実装

**目的：** Task 77 で確定したG・Jのデザインを、Hと同じく予約画面（通常予約・一括予約・人物固定のローテーション／手動）で使えるようにする。H は変更しない。

**変更：**
- 新規 `og-templates/site-ui/gj-parts.tsx`：G・J共通の部品（Canvas・虫めがねアイコン・スマホ枠・配信サービス行）。
- `og-templates/site-ui/search-too-much.tsx`：旧Preview版のGを、確定したデザイン（検索履歴・今までは…／人物名ひとつ・その検索、1回でよくない？）に置き換えた。IDは `search-too-much` のまま。
- 新規 `og-templates/site-ui/real-screen.tsx`：J（ID `real-screen`）。
  - 3枚目の長い作品名は、文字サイズを下げても入らなければ途中で切って「…」を付ける。
  - 見出しの人物名は幅に合わせて縮める。
- 新規 `site-ui/gj-rules.ts`（純粋関数）：生成条件・判定・キャプション。
  - G：出演作品・配信サービス（YouTube系除く）・関連商品がどれも1件以上。
  - J：配信サービス（YouTube系除く）と関連商品が1件以上、配信中の作品（YouTube系のみ除く）が3件以上。そのうえで画像のある作品が3件そろうこと。
  - J が作れない場合の切り替え先は H → G。どれも無理なら生成しない。
  - G・J のキャプション（人物名・件数を差し込む。予約画面で編集可）。
- `site-ui/builders.ts`：
  - `prepareSearchTooMuch` を新しい条件・キャプションにした。
  - `prepareRealScreen` を追加した。作品は H 2枚目と同じ並びの先頭8件から、画像を読み込めた3件を使う。条件を満たさなければ H・G の結果に `templateId`・`fallbackReason` を付けて返す。
  - `toTemplateData` は、読み込み済みの作品を渡せるようにした。
- `build-post.ts`：`BuildPostResult` に任意の `templateId`・`fallbackReason` を追加した。
- `instagram-schedule/prepare.ts`：生成結果に予約できる `templateId` があればそれで保存する（J→Hに切り替えた場合、予約・一覧は H になる）。
- `lib/instagram-templates.ts`：`G_TEMPLATE_ID`・`J_TEMPLATE_ID` と表示名（「G 推し活、検索しすぎ問題」「J 実際の画面で見せる」）を追加し、`SCHEDULABLE_TEMPLATES` に入れた。`INSTAGRAM_TEMPLATES`（自動選択の候補）には入れない。
- `template-builders.ts`：G・J を登録。
- 予約画面：
  - 通常予約は、J が H・G に切り替わった場合に理由と保存されるテンプレート名を表示する。
  - 一括予約は、行のテンプレート名を実際に作成したものにし、理由を表示する。
- ツール `tools/canva-instagram/gj-preview/run.ts`：本番と同じ生成処理（`SITE_UI_PREPARERS`）のページを描画するだけに変更（重複していた `templates.tsx` は削除）。複数人を指定できる。

**確認（予約・投稿なし）：**
- ローカル描画：
  - 長い人物名（吉田綾乃クリスティー）：6枚とも収まった。
  - 長い作品名（山﨑怜奈、69文字）：「…」付きで1行に収まった。
  - データ少なめ（岩瀬佑美子：配信中1件）：Gは可、Jは H に切り替わった。
  - 配信中3件だが画像が2件（大田美月）：J は H に切り替わった。
  - 関連商品0件（齊藤京子）：G・J・H すべて生成不可と表示される。
- ローカルの生成API（prepare）：
  - 久保史緒里のG・Jがそれぞれ templateId=search-too-much／real-screen、画像3枚。
  - 大田美月のJは templateId=watch-and-buy と切り替えの理由を返した。
  - 齊藤京子のJはエラー（J・H・Gいずれも不可）。
  - テスト用に生成した画像9枚はBlobから削除した。予約APIは呼んでいない。
- 予約画面の選択肢（通常予約）と、人物固定の自動ローテーション候補に G・J が出る。
- 自動（おすすめ）の候補には G・J が入らない（テストで確認）。
- `npx tsc --noEmit` 成功、`npx vitest run` 71ファイル1524件成功、`npm run build` 成功。予約テーブル・ID 40・instagram_posts は変更なし。

**注意点：**
- 作品の配信サービス名は人物ページと同じ表示名をそのまま使う。「TVer / テレビ朝日系」「のぎ動画 / Blu-ray/DVD」のように、1つのチップに「/」で並ぶ場合がある（Hの2枚目と同じ）。

**追記（Task 78・利用者の指示で仕様変更）：H・G・J を「自動（おすすめ）」の候補に含める**
- `lib/instagram-templates.ts`：H・G・J の `autoRotation` を true にした。コメントも「自動の候補にも入る（その人物で生成できる場合だけ）」に更新した。
- `server/instagram-schedule/auto-template.ts`：
  - 候補を `SCHEDULABLE_TEMPLATES`（既存4＋H・G・J）にした。
  - H・G・J は `evaluateSiteUiAvailability`（生成時と同じ条件。J は画像を読み込んで3件そろうかまで確認）で判定する。既存4テンプレートの条件は従来どおり。
  - 並び順は works-only → works-picks → vod-compare → default-person → H → G → J → 先頭。
  - 次の候補は「全体の並びで直前より後ろにある、この人物で生成できる最初のテンプレート」にした。直前がその人物では作れないテンプレートでも先頭へ戻さない（人物・日付が変わってもリセットしない）。
  - 候補が2種類以上あれば、同じテンプレートは連続しない。
- `site-ui/builders.ts`：J の作品選び（`pickRealScreenWorks`）を切り出し、`evaluateSiteUiAvailability` を追加した。
- `schedule-store.ts`：`getMostRecentTemplateId` の対象を `SCHEDULABLE_TEMPLATES` にした。直近の予約が H・G・J でもローテーションの続きになる（以前の「H を無視する」処理は、この仕様変更で不要になった）。
- テスト：`instagram-h-auto-exclusion.test.ts` を `instagram-auto-template.test.ts` に置き換えた。
  - 既存4だけの従来の順番。
  - ①全可（既存4→H→G→J→…）、既存4不可（H→G→J→H…）。
  - ② J不可（H→G→H→G…）、③ Hのみ（毎回H）、すべて不可（候補なし）。
  - 直前が作れないテンプレートでも続きから選ぶこと、30回連続で同じテンプレートが並ばないこと。
- 実データ（読み取りのみ）：
  - 久保史緒里（写真なし・H/G/J可）：作品・配信情報 → 出演作3選 → サブスク比較 → H → G → J → 作品・配信情報…
  - 大田美月・岩瀬佑美子（J不可）：作品・配信情報 → 出演作3選 → H → G → 作品・配信情報…
  - 「Hのみ可（G/J不可）」の人物は実データに0人。H の条件（配信中の作品・配信サービス・関連商品）を満たせば G の条件（出演作品・配信サービス・関連商品）も必ず満たすため。
- 人物固定・テンプレを変えるの「自動ローテーション」は、従来どおり管理者が選んだテンプレートを選んだ順に回す（H・G・J も選べる）。
- `npx tsc --noEmit` 成功、`npx vitest run` 71ファイル1530件成功、`npm run build` 成功。予約テーブル・ID 40・instagram_posts は変更なし。

---

## Task 79：J「実際の画面で見せる」を4枚構成に（関連商品も探せる）＋投稿画像3〜10枚に対応

**目的：** J を「作品がすぐ探せる」だけでなく「作品・配信先・関連商品をまとめて探せる」ことが伝わる4枚構成にする。

**J の4枚（`og-templates/site-ui/real-screen.tsx`）：**
- 全ページ共通で、上部に「推しサーチの実際の画面」ラベルと「作品・配信先・関連商品」のタブを出す。そのページで見せている要素を黒で強調する。
- 1枚目「（人物名）、検索してみた。」：サイトのヘッダーと人物名入りの検索欄、検索結果（人物ページ上部）、3つの件数（アイコン付き）。
- 2枚目「気になる作品、どこで見れる？」：人物ページの配信中の作品欄（作品3件：画像・作品名・配信サービス）と、「出演作品○件・配信サービス○社から、見られるサブスクをそのまま確認。」。
- 3枚目「関連商品も、一緒に探せる。」：人物ページの関連商品欄を見ている実画面風。
  - 「SHOP」見出しと件数、カテゴリのタブ（件数付き）、商品カード（カテゴリごとに1件）。
  - 商品画像は使わず、カテゴリのアイコンを置く。
  - 商品名は先頭3件のうち記号の少ないものを選び、表示用に【】・[ ]・★…★を外す。2行に収め、英数字の単語の途中では改行しない。
- 4枚目「作品も、配信先も、関連商品も、まとめて。」：1〜3枚目と同じ枠で、検索欄と3つの件数カード。
  - その下に一定の間隔で「気になる推しができたら、まず推しサーチへ。」と「プロフィールのリンクから『推しサーチ』へ」。
- 以前の2枚目（スマホ画面＋流れ）はやめた。それだけで使っていた `Phone`・`ServicesRow` も削除した。

**生成条件・キャプション（`site-ui/gj-rules.ts`）：**
- J は関連商品が3件以上（`REAL_SCREEN_MIN_PRODUCTS`）必要にした。以前は1件以上。
- そのほかの条件（配信サービス1社以上、画像のある配信中の作品3件）と、切り替え先（J → H → G）は変更なし。
- キャプションに実際の商品カテゴリを入れた（例：「写真集・CD・Blu-ray/DVD・グッズなどの関連商品も、まとめて探せます。」）。

**投稿画像を3〜10枚に対応（J の4枚を予約・自動投稿に渡すため）：**
- `lib/instagram-templates.ts`：`SCHEDULE_IMAGE_MIN = 3`・`SCHEDULE_IMAGE_MAX = 10`（Instagramのカルーセル上限）と `scheduleImageCountError` を追加した。
- 予約API（通常・一括）：「ちょうど3枚」から「3〜10枚」に変更した。
- `instagram-schedule/publish-schedule.ts`：保存済みの画像を全部、保存順にカルーセルへ入れる（以前は先頭3枚だけ）。
  - 枚数が範囲外、または空のURLがある場合は Instagram API を呼ばずにエラーにする。
  - 二重投稿防止・failed／needs_review の扱いは変更なし。
- `build-post.ts`（画像は配列・並び順は数値）、`site-ui/builders.ts`（何枚でもアップロード）。
- 予約画面：通常予約・一括予約の Preview を枚数に合わせて表示する。
- 変更していないもの：手動投稿（`/admin/instagram-post`）は従来どおり3枚のみ（J は選べない）。既存4テンプレート・H・G は3枚のままで、投稿の動きも従来どおり。

**確認（予約・投稿なし）：**
- 久保史緒里で4枚：1080×1080・順番どおり。比較画像あり（`~/Downloads/oshi-instagram-J-final-preview/`）。
- 長い人物名（吉田綾乃クリスティー）・長い作品名（山﨑怜奈）・長い商品名（髙地優吾、159文字）：収まる（「…」で省略）。
- 商品カテゴリが1つだけ（山里亮太）：カード1枚で表示し、崩れない。
- 関連商品2件（阿部顕嵐）・画像のある作品が2件（大田美月）：H に切り替わる。
- ローカルの生成API：久保史緒里の J は4枚（順番1〜4）、阿部顕嵐は H の3枚と理由が返った。テスト用の画像7枚は削除した。
- テストを追加した：
  - 予約API（通常・一括）が4枚を保存する。2枚・11枚は拒否する。
  - 自動投稿が4枚を1→4の順でカルーセルに入れる。3枚未満は投稿しない。
  - J の関連商品の条件（2件不可・3件可）と、キャプションの商品カテゴリ。
- `npx tsc --noEmit` 成功、`npx vitest run` 71ファイル1534件成功、`npm run build` 成功。予約テーブル・ID 40・instagram_posts は変更なし。

---

## Task 80：Instagram予約画面の人物選択に「グループで絞り込み」と「一括選択」を追加

**目的：** 予約画面（`/admin/instagram-schedule`）で、グループ単位で人物を選びやすくする。人物一覧に出す人物の条件・予約ロジックは変えない。

**変更：**
- 新規 `src/lib/person-group-filter.ts`（純粋関数）：
  - `groupKeyOf`：改名後の現グループ名 `currentGroupName` を優先し、無ければ `group`。
  - `buildGroupOptions`：人物データから重複なしで作る（ハードコードしない）。人数の多い順で、グループ名が空の人物がいれば最後に「グループなし」。
  - `filterPersons`：グループ条件＋検索条件。検索は従来どおり人物名・グループ名・別名で、現グループ名でも一致する。
  - `selectAllMatching`：条件に一致する未選択の人物だけを一覧の並び順で末尾に追加する。選択済みの人物は条件外でも解除しない。上限があればそこで止め、追加できなかった人数を返す。
- 新規 `src/app/admin/instagram-schedule/GroupFilterSelect.tsx`：「グループ：すべて（360人）▼／乃木坂46（97人）…」の選択欄（通常予約・一括予約で共通）。
- `PersonMultiSelect.tsx`（一括予約）：
  - 検索欄の下にグループ絞り込みを追加した。
  - その下に「（グループ名）を全員選択（N人）」または「表示中をすべて選択（N人）」と「選択をすべて解除」を追加した。
  - 絞り込み中は、一致した人物を全員一覧に出す。絞り込みなしのときは従来どおり先頭60人。
  - 絞り込みなし（全員）では誤って全員を選ばないよう、一括選択は無効にした（「グループか検索で絞り込むと一括選択できます」と表示）。
  - 一覧の下に「乃木坂46　条件に一致：97人」を出し、一括選択の結果（追加人数・上限で追加しなかった人数）も表示する。
  - 右側の「選択中（N人）」には、絞り込み外の人物も含めて選択中の全員を出す（従来どおり）。
- `BulkScheduleClient.tsx`：人物固定・テンプレを変えるモードでは一括選択ボタンを出さない（`allowBulkSelect={!fixedPerson}`）。グループ絞り込みと検索は使える。1人まで（従来どおり）。
- `InstagramScheduleClient.tsx`（通常予約）：人物欄の上にグループ絞り込みを追加し、選んだグループの人物だけを PersonCombobox に渡す。PersonCombobox 自体は変更していない。選択済みの人物は、絞り込みを変えても解除しない。
- テスト：新規 `person-group-filter.test.ts`（12件）。
  - 候補の作り方（現グループ名優先・重複なし・グループなし）。
  - 絞り込み（すべて／グループ／グループ＋検索／グループなし）。
  - 一括選択（既存の選択を残す、別グループで追加、重複しない、上限）。

**確認（ローカル。POSTはすべて遮断し、生成・予約はしていない）：**
- グループの候補は24個＋すべて。例：乃木坂46（97人）・日向坂46（46人）・櫻坂46（44人）・＝LOVE（12人）・欅坂46（11人）・Snow Man（9人）…・グループなし（69人）。
  - 欅坂46のまま改名していない人物（現グループ名なし）は「欅坂46」になる（データどおり）。
- 乃木坂46だけ：97人で全員乃木坂46。
- 乃木坂46＋「久保」：久保史緒里・矢久保美緒（名前に「久保」を含むため。部分一致は従来どおり）。
- 一括選択：
  - 検索結果だけを一括選択すると2人。
  - 乃木坂46を全員選択すると97人（重複なし）。
  - 櫻坂46へ移って3人追加すると100人。乃木坂46の選択は維持された。
  - 選択をすべて解除すると0人。
- 配置：選択順に枠へ割り当て（従来どおり）。
- 1週間分（上限21人）で乃木坂46を全員選択すると21人で止まり、「上限のため76人は追加していません」と表示された。
- 人物固定：一括ボタンは出ず、グループ絞り込み・検索は使える。1人選ぶと2人目は選べない。
- 通常予約：櫻坂46で絞り込むと候補44人。櫻坂46＋「森田」で森田ひかる。選んだ人物はグループを「すべて」に戻しても維持された。
- PC・スマホ（通常予約・一括予約）で横スクロールなし。
- `npx tsc --noEmit` 成功、`npx vitest run` 72ファイル1547件成功、`npm run build` 成功。予約テーブル・instagram_posts は変更なし。

**追記（Task 80）：グループ絞り込みを「現役のみ（既定）／卒業・元メンバーも含む」に対応**
- 判定には person_meta の所属データだけを使う（`src/lib/person-group-filter.ts`。人物名・グループ名の決め打ち・新しいステータス値は使わない）。
  - 卒業・元メンバー（グループG）：`formerGroupNames` に G がある。または、登録グループ（`persons.group`）が G で、`activityStatus` が graduated / withdrawn / retired。
  - 現役（グループG）：元メンバーに当たらず、`currentGroupName` が G。`currentGroupName` が空なら登録グループが G。
  - hiatus・unknown は卒業扱いにしない。
  - 含むON：`group`・`currentGroupName`・`formerGroupNames` のどれかに G がある人物。
  - `group_meta.activityStatus` は欅坂46も含め全グループが active で実態と合わないため、判定には使っていない。
- グループの候補は、`group`・`currentGroupName`・`formerGroupNames` に出てくるグループ名から作る（32個。改名前の 欅坂46・けやき坂46 なども含む）。現役の人数が多い順で、件数は OFF時「現役○人」、ON時「○人」。
- UI（`GroupFilterSelect.tsx`）：グループの下に「□ 卒業・元メンバーも含む」（初期値OFF。「すべて」「グループなし」では無効）。
  - 「現役 33人」／「対象 97人（現役33人＋卒業・元メンバー64人）」を表示する。
  - 一覧では、元メンバーに「卒業・元」バッジを付ける。一括選択ボタンは「乃木坂46を全員選択（現役33人）」になる。
- 検索は、過去の所属グループ名でも一致するようにした。予約画面のページ（`page.tsx`）から `formerGroupNames` を渡す。
- 通常予約（PersonCombobox に渡す候補）も、同じ現役のみ／含む の切り替えにした。
- 実データ：
  - 乃木坂46 現役33／全体97、櫻坂46 30／45、日向坂46 26／46、＝LOVE 10／12、Snow Man 9／9、SPYAIR 3／5。
  - 欅坂46 0／36、グループなし 69、すべて 360。
- データの不整合：`currentGroupName` が残っているのに `activityStatus=graduated` の人物が18人。卒業側の情報（graduated・leftAt・formerGroupNames）を優先し、元メンバー扱いにした。
  - 内訳：乃木坂46 3人（久保史緒里・梅澤美波・吉田綾乃クリスティー）、櫻坂46 14人、日向坂46 1人（山口陽世）。
  - 吉田綾乃クリスティーは leftAt・formerGroupNames が空で、graduated だけが根拠。
  - ほかに、`currentGroupName` が未入力の現役（Snow Man・timelesz・なにわ男子など）は、登録グループ＋active で現役と判定した。
- 確認（ローカル。POSTは遮断）：
  - 乃木坂46：現役33人（久保史緒里・白石麻衣は出ない）、含むONで97人（「卒業・元」バッジ64人）。
  - 現役だけ一括選択で33人。含むONで一括選択すると97人。OFFに戻しても97人とも選択中に残る（一覧は現役33人）。
  - 乃木坂46＋「久保」：現役のみ0人、含むONで久保史緒里・矢久保美緒。乃木坂46＋「白石」（含むON）で白石麻衣。
  - Snow Man：9人（含むONでも9人）。欅坂46：現役0人、含むONで36人。日向坂46：現役26人。
  - 乃木坂46で1人＋Snow Man全員で10人。配置は選択順。
  - グループなし69人。すべて＋「松本若菜」で表示される。
  - 1週間分は現役33人のうち21人で止まる。
  - 人物固定：一括ボタンなし。含むONで元メンバー（白石麻衣）を1人選べ、2人目は選べない。
  - 通常予約：乃木坂46 現役33件／含む97件。
  - PC・スマホで横スクロールなし。
  - `npx tsc --noEmit` 成功、`npx vitest run` 72ファイル1551件成功、`npm run build` 成功。予約テーブル・instagram_posts は変更なし。

**追記（Task 80）：本番反映前のデータ監査（読み取りのみ・DB変更なし）**
- 全360人で誤分類0件。最終判断は「現在の判定ロジックのまま本番反映」。
- 卒業済みなのに currentGroupName が残っている人物は19人（うち IKE は移籍先 TOOKAMI の現役で正しい）。
- currentGroupName が空の現役は43人（Snow Man・timelesz・なにわ男子・M!LK・モナキなど）。
- 卒業の根拠が activityStatus だけの人物は1人：吉田綾乃クリスティー。membershipNote に「2026年8月9日に卒業予定」とあり、卒業済みで正しい。
- 改名（欅坂46→櫻坂46、けやき坂46→日向坂46）でも、旧グループの現役は0人。新グループの現役は新グループにだけ出る。
- 人物DBのクリーンアップ（currentGroupName の削除、吉田綾乃クリスティーの leftAt・formerGroupNames）は別タスク。今回のcommitにはデータ修正を含めない。

---

## Task 81：人物選択UIの細部修正（スマホではみ出し・人物固定切替の案内・全員選択済み表示）

### 目的
Task 80 を本番で目視確認した際に見つかった3点を直す。人物選択の仕様（絞り込み・現役/元メンバー・一括選択・検索・上限・各モード）は変えない。

### 変更ファイル
- `src/components/admin/PersonCombobox.tsx`：候補ドロップダウンの最小幅を、sm（640px）以上は従来どおり `max(100%, 360px)`、sm未満は入力欄と同じ幅（`min-w-full`）に。390px幅で右に7pxはみ出していた問題を解消（maxWidth `calc(100vw - 32px)` は従来どおり）。共有コンポーネントのため、他の使用画面（instagram-post・rakuten-search・/photobooks）も PC・スマホで確認済み。PC の幅は変化なし。
- `src/app/admin/instagram-schedule/PersonMultiSelect.tsx`
  - 一括選択の可否（allowBulkSelect＝モード）が変わったら、切替前の一括選択メッセージ（「97人を追加しました。」等）を消す。
  - `notice` プロップを追加（呼び出し側が管理する案内。一覧の上に表示）。
  - 絞り込み中に一致した人物が全員選択済みなら、一括ボタンを「全員選択済み（N人）」（disabled）に。一部だけ選択中は従来どおり「乃木坂46を全員選択（97人）」。「選択をすべて解除」は変更なし。
- `src/app/admin/instagram-schedule/BulkScheduleClient.tsx`：2人以上選択した状態で人物固定へ切り替えたときだけ「人物固定モードのため、先頭の1人だけを選択しました。」を表示（先頭1人に絞る既存処理はそのまま）。選択を変える・モードを戻す・予約登録後に消える。

### 注意点
- 1人だけ選択して人物固定へ切り替えた場合は案内を出さない（何も外れないため）。
- 上限（1週間分の人数）で押せないときのボタン表記は従来どおり（「全員選択済み」は一致した全員を選んだときだけ）。

---

## Task 82：/admin/product-check のスマホ表示で横スクロール（約245px）が出る問題を修正

### 目的
人物カードの見出し右側のボタン群（作品管理・公開ページ・メモ/優先・楽天再取得・AI判定・再判定・全件AI判定・確認状態）が、スマホ幅で画面からはみ出して横スクロールが出ていた（390pxで245px、360pxで274px）。PC表示・処理ロジックは変えずに、スマホでカード内に折り返す。

### 原因
- ボタン群の外枠が `flex-shrink-0` のため、1行分の幅（601px）より縮まず、`flex-wrap` が効いていなかった（カード見出しは390pxで324px）。
- さらに楽天再取得ボタンの外枠も `flex-shrink-0` で、実行中・結果表示の文言が `whitespace-nowrap` のため、外枠だけ直すと右寄せ（justify-end）で左側へはみ出して見えなくなる状態があった。
- ローカルはRedis未接続で人物カードが表示されないため再現しない（本番のみで発生）。

### 変更ファイル（表示スタイルのみ）
- `src/app/admin/product-check/ProductCheckPersonSection.tsx`：ボタン群の外枠に `max-w-full`。
- `src/app/admin/product-check/PersonRakutenFetchButton.tsx`：外枠に `max-w-full`。処理中の進捗・利用制限中（429）・二重実行の文言の `whitespace-nowrap` を外す。完了件数表示は `whitespace-nowrap` → `flex-wrap`。エラー表示（220px・省略）、API設定不足、API正常・0件、ボタン本体はそのまま。

### 確認
- 360 / 390 / 430px：通常・処理中・利用制限中・二重実行・完了・エラー（・API設定不足・0件）のすべてで横スクロール0、左右の切れなし、ボタン・リンクはすべて押せる位置にある（実際の処理は実行せず、各状態の文言を画面上に再現して確認）。
- 1280px：通常状態のボタン配置（位置・サイズ）は修正前と同一。実行中・結果表示の高さも修正前と同じ。

### 注意点
- スマホではカード見出しが2〜3行になるため、ページ全体が縦に長くなる（390pxで約6.4万px→8.4万px）。
- 楽天再取得・AI判定の処理ロジック、ボタンの順番・機能は変更なし。

---

## Task 83：一括予約「人物固定・テンプレを変える」を複数人物に対応（人物ごとにテンプレを全部使ってから次の人物へ）

### 目的
人物固定モードで複数人物を選べるようにし、「人物（選択順）× テンプレ（並び順）」の投稿キュー（A-H, A-G, A-J, B-H …）を、1日あたり件数ずつ日をまたいで続きから割り当てる。

### 変更ファイル
- `src/lib/instagram-template-plan.ts`（純粋関数）
  - `templateSequenceForPerson`：1人に使うテンプレの並び。自動ローテーション＝選んだ順、手動（1週間）＝並べた順、手動（1日分）＝投稿時刻順。
  - `buildPersonTemplateQueue`：人物×テンプレのキュー。
  - `planFixedPersonSchedule`：キューを既存の `allocateBulkSlots` で空き枠へ割り当て（予約済み・過去の枠は飛ばして次の空き枠へ。投稿内容は飛ばさない）。1週間分は `maxCount`（7日×件数）で打ち切り、超えた分は予約しない。各行に「その日の何件目／その日の件数」。
  - 最終日の±1件調整（`adjustLastDay`、既定OFF）：最終日が1件だけで、前日が設定件数で埋まっている場合に限り、その1件を前日の最後の投稿の1時間後へ寄せる（前日＝設定＋1件）。寄せる時刻が予約済み・過去・23時より後、または上限で打ち切った場合は調整しない（理由を返す）。最終日が設定−1件以下はそのまま（OFFと同じ）。通常の日は変えない。
  - 旧 `assignTemplatesToSlots`（1人の枠にテンプレを繰り返し割り当て）は削除。
- `BulkScheduleClient.tsx`
  - 人物固定モードでも複数選択・グループ一括選択を使える（1人制限・先頭1人に絞る処理と案内を削除）。人数の上限なし（件数は1週間分の枠で打ち切り）。
  - 件数：通常＝キューすべて（複数日にまたがる）、1週間分＝最大7日×件数。
  - 「最終日の投稿数を±1件調整してまとめる」チェック（既定OFF）と、調整しなかった理由の表示。
  - 配置プレビュー（人物固定）：日付ごとの見出し行（何日目・件数）、時刻・人物・テンプレ・「n/m件目」、前日と同じ人物から始まる日は「（前日の続き）」、調整した行に「最終日調整」。1週間で打ち切った件数の注記。
  - 従来モード（人物を変える・テンプレ固定）の配置・テンプレ選択・自動ローテーション（生成時）は変更なし。
- `TemplatePlanSettings.tsx`：説明文を新しいルールに合わせた（UIは同じ）。
- テスト：`instagram-template-plan.test.ts` を新ルールで書き直し（ケース1〜7ほか24件）、`instagram-post-times.test.ts` の人物固定部分を新ルールに更新。

### 注意点（従来からの変化）
- 人物1人の場合も「人物×テンプレ」件数になる（例：1人×H,G,J＝3件。以前のように1日分・1週間分の枠をテンプレの繰り返しで埋めることはしない）。
- 手動（1日分）は「人物ごとの1日分の並び」として扱う。予約済み・過去の枠があると、テンプレは時刻に固定されず後ろへずれる（キュー順を優先）。
- DBスキーマ・予約API・prepare API・Cron・投稿処理は変更なし（各投稿は従来どおり personName＋templateId＋scheduledAt の1行）。
- `PersonMultiSelect` の `notice` プロップは使われなくなった（残置）。

### 確認（ローカル。非GETはすべて遮断、生成・予約・画像生成なし）
- ケース1〜3・5〜10 を画面で確認（乃木坂46一括33人×H,G,J×1週間5件＝99件→35件、白石麻衣（元メンバー）を含む、手動1日分）。ケース4は予約済み枠の応答を差し替えて確認。PC・390pxで横スクロール0。

---

## Task 84：人物固定・テンプレを変える：必要日数の自動計算と「全件を予約／最大7日分まで予約」

### 目的
選んだ人物数 × テンプレ数 ÷ 1日あたり投稿数（切り上げ）で必要日数を自動計算し、予約前に「総投稿数・予約予定・未予約・必要日数・予定期間」を表示する。基本は全件を予約、1週間分は「最大7日分まで予約」オプションにする。

### 変更ファイル
- `src/lib/instagram-template-plan.ts`：`planFixedPersonSchedule` の結果に `summary` を追加（totalPosts／scheduledCount／omittedCount／perDay／baseDays＝予約予定÷1日件数の切り上げ／days＝最初の投稿日〜最後の投稿日の通し日数／開始・終了日／dayDiff＝days−baseDays／adjusted）。各行に `dayNumber`（最初の投稿日を1日目とした通し日数。投稿のない日も数える）。
  - 表示も予約も同じ配置結果（items）から作るので、画面の日数と実際の予約日がずれない。予約APIは受け取った行（日時・人物・テンプレ）をそのまま保存し、日数を別に計算しない。
- 新規 `src/app/admin/instagram-schedule/PlanSummaryCard.tsx`：「N投稿 / M日間」カード。選択人物・選択テンプレ・総投稿数・1日あたり・予約予定・未予約（最大7日分ON時は常に表示）・必要日数・開始日・終了予定日。計算式と、延長（既存予約・過去の枠）／短縮（最終日調整）の理由。
- `BulkScheduleClient.tsx`
  - 人物固定モードでは「通常／1週間分を作成」タブを出さず、「全件を予約」の説明と「最大7日分まで予約」チェックにした（内部は従来どおり bulkMode='week' ＝ 7日×件数で打ち切り）。従来モード（人物を変える）はタブのまま。
  - 配置プレビュー上にカード。日付見出しを「10/02（1日目・5件）」形式（通し日数）に。
- テスト：`instagram-template-plan.test.ts` に必要日数のケース（1〜8・11、延長・1日まるごと予約済み・0件）を追加。

### 注意点
- 「最大7日分まで予約」は人物固定モード専用の状態（`fixedMaxWeek`、初期値OFF）。従来モードの「1週間分を作成」（`bulkMode`）とは独立しており、互いに影響しない。
- 手動選択の入力方法は「時刻ごとに指定」（既定）／「順番に並べる」を明示的に選ぶ（`manualStyle`）。以前は1週間モードかどうかで切り替わっていたが、「最大7日分まで予約」とは連動しない。`TemplatePlanSettings` の `weekMode` プロップを `manualStyle` に置き換えた。
- 必要日数は最初の投稿日から数える（開始日が今日で過去の枠しか残っていない場合は翌日から）。
- DBスキーマ・予約API・prepare・Cron・投稿処理は変更なし。

### 確認（ローカル。非GETはすべて遮断、生成・予約・画像生成なし）
- ケース1 9投稿/2日、ケース2 18投稿/4日（開始日10/05に変えると10/05〜10/08）、ケース3 30投稿/3日、ケース4 99投稿/20日、ケース5 予約予定35・未予約64・7日、ケース6（予約済み3枠を応答差し替え）18投稿/5日・1日延長、ケース7 5/5/1・3日、ケース8 5/6・2日（1日短縮）、ケース9・11 白石麻衣（元）＋目黒蓮×4テンプレ＝8投稿、ケース10 乃木坂46一括33人、ケース12 390pxで横スクロール0。

---

## Task 85：Instagram予約の人物選択に「人物 × テンプレート」の投稿状況を表示（投稿済みは警告のみ）

### 調査結果（読み取りのみ）
- `instagram_post_schedules`：template_id・status・media_id・published_at を持つ。status='published' は Instagram の media_publish 成功後にだけ設定され、media_id が入る。
- `instagram_posts`：実際に公開された投稿の履歴だが、テンプレートの列はない。予約からの投稿は media_id で予約と結び付く。管理画面 /admin/instagram-post からの手動投稿は予約が無く、テンプレートが分からない。
- 実データ（2026-10-01時点）：予約 #27 松村北斗×標準（published・media あり）、#40 目黒蓮×H（published・media あり）。森本慎太郎の 9/21 の投稿は手動投稿（予約 #26 は cancelled）でテンプレート不明。#31〜33 は cancelled。
- 結論：予約からの投稿は既存データで正確に判定できるため、DB変更なし。手動投稿は推測でテンプレートに割り当てず「テンプレ不明」として表示する。

### 判定ルール（`src/lib/instagram-template-history.ts`）
- 投稿済み＝予約の status='published' かつ media_id・published_at あり。人物×テンプレートごとに最新の published_at。
- scheduled / processing / failed / needs_review / cancelled / draft、生成のみは投稿済みにしない。
- 予約と media_id で結び付かない instagram_posts は「テンプレ不明の投稿」（人物ごとの最新日時）。

### 変更ファイル
- 新規 `src/lib/instagram-template-history.ts`（純粋関数）：buildTemplateHistory／templatePostedAt／findPostedCombos／personTemplateChips（テンプレート定義の順。定義外のIDも末尾に出す。テンプレ不明の投稿がある人物には未投稿を返さない）／unknownTemplatePostedAt／shortTemplateLabel（定義のラベルから作る。H/G/J決め打ちなし）／formatPostedDate。
- `src/lib/instagram-post-store.ts`：`getTemplateHistory()`（published の予約と instagram_posts を読むだけ）。
- `src/app/api/admin/instagram-schedule/posted-persons/route.ts`：既存の personNames・lastPostedAt に加えて templateHistory を返す。
- `PersonMultiSelect.tsx`：人物名の下にテンプレート状況。3状態：✓ 投稿済みと確認できる（今回も選択中なら ⚠）／○ 未投稿と確認できる（今回選択中）／？ テンプレ不明の投稿あり。
  - テンプレ不明の投稿がある人物には ○ を出さない（どのテンプレートも未投稿と断定しない）。例：森本慎太郎は「？ テンプレ不明 09/21」だけ。
  - 投稿履歴が1件もない人物には何も出さない。
  - 人物固定モードでは人物単位の「投稿済み（日付）」バッジを出さず、テンプレート別の表示に統一（`showPersonPostedBadge`）。従来モードは既存バッジのまま。
  - 選択中パネル：テンプレートIDが一致した場合だけ「⚠ 人物：H（日付）は投稿済みです」。テンプレ不明の過去投稿は「？ 過去にテンプレート不明の投稿があります（日付）」（灰色の補助表示。警告にしない）。選択の禁止・自動除外はしない。
- `BulkScheduleClient.tsx`：
  - 配置プレビューの各行に「⚠ 投稿済み 日付」、上部に「投稿済みの組み合わせがN件含まれています」（両モード。従来モードは「自動」以外のテンプレートで判定）。
  - 一括予約の確認ダイアログに、実際に生成されたテンプレート（Jの代替を含む）で判定した組み合わせ一覧を出し、ボタンを「このまま予約」にする（予約は禁止しない）。
  - 「最終日の投稿数を±1件調整してまとめる」の表示を「最終日が1投稿だけなら前日にまとめる」＋短い説明にし、例外は「詳細を見る」に収納（動作は変更なし）。
- テスト：新規 `instagram-template-history.test.ts`（A〜J、3状態の表示 A〜E、テンプレ不明だけでは警告しない、定義外テンプレ、短縮名）。

### 注意点
- 手動投稿（/admin/instagram-post）のテンプレートを今後も判定したい場合は、instagram_posts に template_id（null 可）を追加して手動投稿時に記録する案がある（未実施・別タスク。既存の手動投稿はテンプレ不明のまま）。
- 投稿順・必要日数・最大7日・最終日調整・予約済み枠スキップのロジックは変更なし。

---

## Task 86：動画生成（/admin/video-maker）Phase A — ジョブ登録と oshi-video-maker Worker 連携

### 目的
推しサーチ管理画面から「人物（複数）→テンプレート→ナレーション方式→生成」を操作できるようにする。重い処理（Remotion/FFmpeg/Chromium）はVercelでは動かさず、自宅Macの oshi-video-maker Worker がジョブを取得して既存の生成処理（scripts/produce.ts）で生成し、final.mp4 を Vercel Blob へ直接アップロードする。

### 構成
- 管理画面 → `/api/admin/video-jobs`（既存の proxy.ts セッション認証＋Originチェック）→ Neon `video_generation_jobs` に queued で登録。
- Worker → `/api/worker/*`（`Authorization: Bearer VIDEO_WORKER_SECRET`、CRON_SECRETとは別。proxy.tsの対象外のため各ハンドラで検証。SHA-256に揃えて timingSafeEqual で比較）。WorkerはNeonへ直接接続しない。
- 取得は1本の条件付きUPDATE（`WHERE status='queued' AND id = (SELECT … FOR UPDATE SKIP LOCKED)`）。複数Workerでも二重取得しない。Workerは自分が取得したジョブ（worker_id一致・processing）にしか書けない。
- 動画は `/api/worker/video-jobs/[id]/upload-token` が発行する client token（そのジョブ専用パス `video-jobs/{jobId}/final-{random}.mp4`・video/mp4のみ・200MBまで・30分・上書き不可）で Worker → Blob へ直接アップロード（Vercel関数の4.5MB上限を通さない）。BLOB_READ_WRITE_TOKEN自体はWorkerへ渡さない。完了報告時は `head()` で実在とパス一致を確認してから completed にする。
- テンプレート・対応ナレーション方式は oshi-video-maker の VIDEO_TEMPLATE_REGISTRY が正本。Workerが起動時と30秒ごとに `/api/worker/heartbeat` で「Phase AのWorkerが実際に生成できる方式」だけを報告し、`video_workers` に保存。管理画面はそれだけを表示・選択可能にし、ジョブ作成時もこの能力で検証する（oshi-search側に定義をコピーしない）。
- 人物はジョブに persons.name を入れ、Worker側で PERSON_REGISTRY に対応付ける（未登録なら推測せず failed）。管理画面では Worker が報告した対応人物以外を選ぶと警告を出す。

### DB変更（新規テーブルのみ・既存テーブルは無変更）
- `video_generation_jobs`：id / batch_id / retry_of_job_id / person_name / person_slug / template_id / template_version / narration_mode / status（queued・processing・completed・failed・cancelled）/ attempts / progress_step・progress_total・progress_label / worker_id / heartbeat_at / created_at・started_at・completed_at・updated_at / error_step・error_message / video_url・video_pathname・video_size_bytes・duration_sec / qa_status・qa_warnings・qa_report / post_texts / narration_script / result / worker_export_dir。索引：(status, created_at)、batch_id、person_name。
  - 設計案の `cancel_requested`（実行中の中断はPhase Aでは行わない）と `claimed_at`（started_atと同値）は見送り。
- `video_workers`：worker_id / last_seen_at / version / templates / persons / updated_at。
- migration記録：`drizzle/0013_video_generation_jobs.sql`。既存運用どおり `/api/admin/db-init` の CREATE_STATEMENTS・TABLE_NAMES にも追加。
- 適用：ローカル（`.env.local` 接続＝本番相当のNeon）へは 0013 の CREATE TABLE/INDEX IF NOT EXISTS だけを直接実行済み（db-init全体は実行していない）。Vercel本番で別DBを使っている場合は `/admin/db-init` からの適用が必要。

### 変更ファイル
- 新規：`src/server/video-jobs/job-store.ts`・`worker-auth.ts`・`worker-route.ts`、`src/app/api/admin/video-jobs/route.ts`・`[id]/cancel/route.ts`・`[id]/retry/route.ts`、`src/app/api/worker/heartbeat/route.ts`、`src/app/api/worker/video-jobs/claim/route.ts`・`[id]/progress`・`[id]/upload-token`・`[id]/complete`・`[id]/fail`、`src/app/admin/video-maker/page.tsx`・`VideoMakerClient.tsx`、`drizzle/0013_video_generation_jobs.sql`。
- 変更：`src/db/schema.ts`（2テーブル追加・doublePrecision import）、`src/app/api/admin/db-init/route.ts`（CREATE文・テーブル名追加）、`src/app/admin/AdminLayoutClient.tsx`（ナビ「🎬 動画生成」1行）。
- 環境変数：`VIDEO_WORKER_SECRET`（32文字以上。ローカルは `.env.local` に開発専用の値を追記済み。Production/Previewへは未設定）。

### 注意点
- 人物選択は既存の `instagram-schedule/PersonMultiSelect.tsx` を再利用（投稿済みバッジ等は渡さない）。同コンポーネントの「この順番で日時へ割り当てられます」はInstagram向けの文言のまま表示される。
- 一覧取得時、15分以上進捗報告のない processing ジョブは failed（error_step=Worker応答なし）にする。
- 同時に依頼した人物は選択順に1本ずつ処理されるよう created_at を1msずつずらして登録する。
- 動画URLは Vercel Blob の公開URL（推測困難なランダムパス）。
- 動作確認（ローカル next dev ＋ 自宅Mac Worker）：松村北斗×気になる人紹介×音声なし → completed（QA PASS・17.0秒・Blob再生/ダウンロード確認）。未対応人物の失敗が次のジョブを止めないこと、10並列claimで1件だけ取得、他Workerからの報告拒否、queuedキャンセル、既存管理画面・vitest全件成功を確認。

---

## Task 87：動画生成（/admin/video-maker）運用仕上げ — 人物選択の文言

### 目的
/admin/video-maker で再利用している人物選択（`instagram-schedule/PersonMultiSelect.tsx`）に、Instagram一括予約向けの「この順番で日時へ割り当てられます」が表示されていたため、動画生成画面でだけ適切な文言にする。

### 変更ファイル
- `src/app/admin/instagram-schedule/PersonMultiSelect.tsx`：選択中一覧の見出しの説明を `selectionOrderNote`（任意）で差し替え可能にした。省略時は従来の「この順番で日時へ割り当てられます」のままのため、Instagram予約画面の表示は変わらない。
- `src/app/admin/video-maker/VideoMakerClient.tsx`：`selectionOrderNote="この順番で1本ずつ生成されます"` を渡す。

### 注意点
- 投稿済みバッジ・テンプレート投稿状況は、動画生成画面では従来どおり渡していないため表示されない（変更なし）。
- 同時期に oshi-video-maker 側で Worker の launchd 自動起動・スリープ対策（caffeinate -i）・進捗報告の順序保証を追加（oshi-search 側の変更なし）。

---

## Task 88：推しに合うサブスク診断（/oshi-vod）高機能版

### 目的
推しを選ぶだけで「出演作品を一番多く見放題で見られる動画配信サービス」を診断する公開機能を追加する。作品数重視・月額重視・コスパ重視の3ランキング、2サービス最適化（一番多く見られる2サービス／80%以上を最安で見る方法）、無料作品、見られる作品一覧、見られない作品＋代替手段、人物別内訳、詳しい比較、共有URL・SNS共有・診断結果画像（feed 1080×1350／story 1080×1920）までを初期実装で揃えた。ユーザー操作は「推しを選ぶ → 診断する」のみ。

### DB変更
なし（テーブル・カラム・migration・db-init いずれも変更なし）。新規の外部API・AI APIも導入していない。

### 新規ファイル
- `src/lib/vod-availability.ts` — 「確認済み」「今すぐ見られる」判定の共通関数（`getConfirmedProviders` / `getStreamingProviders` / `STREAMING_TYPES`）。中身は既存の `isConfirmedVodAvailability` + `deduplicateProviders` の組み合わせのみ。
- `src/lib/vod-plan-info.ts` — 料金比較情報の一元管理（service / kind / planName / monthlyPrice / taxIncluded / sourceUrl / checkedAt / isComparable / note / officialUrl）と `isPriceComparable()`。
- `src/lib/oshi-vod/`：`types.ts`・`core.ts`（計算の純粋関数）・`params.ts`（URL解析・組み立て、最大12人）・`picker.ts`（人物選択用データ・検索）・`data.ts`（server-only。既存取得関数の組み合わせ＋`unstable_cache` 300秒）・`format.ts`・`share.ts`・`image-data.ts`。
- `src/lib/ga-event.ts` — GA4 イベント送信ラッパー（window.gtag がある場合のみ）。
- `src/app/oshi-vod/page.tsx`・`oshi-vod.css`・`opengraph-image.tsx`（静的OG）。
- `src/app/api/oshi-vod/image/route.tsx` — 診断結果画像（`?p=...&size=feed|story`）。
- `src/server/oshi-vod/result-image.tsx` — 結果画像テンプレート（Satori。人物写真なし・外部ロゴ画像なし）。
- `src/components/oshi-vod/`：`OshiVodPersonPicker`（診断専用の複数選択UI）・`OshiVodResultHero`・`OshiVodRankings`・`OshiVodPairs`・`OshiVodWorkLists`・`OshiVodPersonBreakdown`・`OshiVodDetailCompare`・`OshiVodServiceCta`・`OshiVodServiceLine`・`OshiVodShare`・`OshiVodTracker`・`OshiVodEntryCta`・`sec-label.ts`。
- テスト：`vod-availability.test.ts`（旧ローカル実装との完全一致を2000ケース×3パターンで検証）・`vod-plan-info.test.ts`・`oshi-vod-core.test.ts`・`oshi-vod-params.test.ts`・`oshi-vod-picker.test.ts`・`oshi-vod-share.test.ts`。

### 変更ファイル
- `src/app/person/[slug]/page.tsx` — ローカル `getStreamingProviders` を共通関数へ置き換え（同一実装）。`#vod` セクション末尾に「この人を含めてサブスク診断」（`/oshi-vod?with=人物名`）を追加（配信中作品がある人物のみ＝同セクション表示時のみ）。
- `src/components/site/StreamingNowSection.tsx`・`src/server/instagram-post/site-ui/data.ts` — ローカル `getStreamingProviders` を共通関数へ置き換え。
- `src/app/groups/[groupSlug]/page.tsx` — ローカル `getPublicProviders` の中身を `getConfirmedProviders` に置き換え。メンバー欄の直前に診断導線を追加（現役メンバー1〜12人：全員選択済みで開く／それ以外：`?group=` でメンバー選択を開く）。
- `src/app/page.tsx` — 「グループで探す」の直後に「推しに合うサブスクを診断」導線（`<aside>`。既存の `section:nth-of-type` による見出し番号CSSに影響しない）。
- `src/app/sitemap.ts` — `/oshi-vod` 本体のみ追加。
- `src/lib/affiliate-constants.ts`・`src/app/admin/affiliates/AffiliateManager.tsx` — slotKey `oshi_vod_result`（表示名「サブスク診断 結果画面」）を追加。
- `next.config.ts` — `outputFileTracingIncludes` に `/api/oshi-vod/image`・`/oshi-vod/opengraph-image`（既存の日本語フォントを同梱）。
- `CLAUDE.md` — 現在の構成説明を「DB正本＝Neon PostgreSQL／Redis＝補助用途」に修正し、VOD判定・料金情報のルールを追記（本開発ログの過去エントリ・アーキテクチャメモは当時の記録として書き換えていない）。

### 設計上の判断・注意点
- **判定の一致**：診断は `getConfirmedProviders`（人物ページ等と同一）を通した後に配信種別で分類するだけ。1人診断の「今すぐ見られる」件数が人物ページの配信中件数と一致することを本番データ（目黒蓮31・ラウール26・宮舘涼太19）とテストで確認。
- **分類**：作品ごとの配信種別を優先。flatrate かつ料金情報に `kind:'subscription'` があるサービス→有料見放題（ランキング対象）、free/ads→無料枠（ABEMA・Lemino等も作品単位で判定）、rent/buy→詳細比較のみ、Prime Video追加チャンネル（`isPrimeVideoChannel`）→Prime Video本体に数えない、料金情報にないサービスの見放題→「その他」（推測で分類しない）。TVer・YouTube（`kind:'free'`）は有料ランキングに入れない。
- **重複排除**：キーは `canonicalWorkId ?? id`。同一作品の複数行の配信情報は全行を合算してから判定（作品詳細ページの合算方針と同じ）。人物別内訳では各人物側に表示。
- **カバー率の分母**：選択人物の作品のうち、いずれかの有料サブスクで見放題が確認できるユニーク作品数。表示は小数1桁切り捨て、80%判定は整数演算（`count*5 >= total*4`）で表示と判定が食い違わないようにした。
- **ランキング**：作品数（料金未登録も含む）・月額・コスパ（交差乗算で比較）の3種。同率は 1,1,3 方式で「同率」表示。並びの最終キーは `vod-plan-info.ts` の定義順。アフィリエイト情報は計算関数に一切渡さない。
- **80%以上を最安で見る方法**：価格比較可能なサービスのみ。1サービスで達成できるものがあれば1サービスを優先、無ければ2サービスの最安。未達時は「見つからなかった」旨と最大カバー構成を表示。
- **料金**：2026-10-08 に各サービスの日本向け公式ページを確認して入力（Hulu 1,320円＝2026/10/1改定後の通常決済、U-NEXT 2,189円、Prime Video（Amazonプライム月額）600円、Disney+ スタンダード 1,250円、DMMプレミアム 550円、Leminoプレミアム 1,540円（Web）、TELASA 990円、いずれも税込）。Netflix は広告つきプランで一部作品が見られず、スタンダードの税込表記を公式で確認できないため `isComparable=false`。ABEMA（公式ページ間で料金表記が不一致）・FOD・NHKオンデマンド・のぎ動画（公式ページを取得・確認できず）も `isComparable=false`。料金改定時は `vod-plan-info.ts` の値と `checkedAt` を更新する。
- **SEO**：`/oshi-vod`（クエリなし）のみ index・sitemap 掲載。`?p=`・`?with=`・`?group=` 付きは `noindex, follow`＋canonical を本体へ。JSON-LD は BreadcrumbList・WebPage（入口のみ FAQPage）。人物・グループ単位のSEO固定ページは作っていない（`core.ts`・`data.ts` を呼べば将来作れる構成）。
- **アフィリエイト**：CTA は `AffiliateSlot`（slotKey `oshi_vod_result`）＋未登録時は `VodTrackLink`（公式URL・既存 /api/track 計測）。表示ルール（結論カード・各ランキング1位・組み合わせ・詳細比較の全サービス）で一律に付け、提携の有無で位置・順位は変えない。広告表示時のみ既存どおり「PR」。
- **Analytics**：GA4 `diagnosis_start`（person_count・source）・`diagnosis_complete`（person_count・top_service・target_work_count。同一組み合わせは30分重複送信しない）・`diagnosis_cta_click`（service・placement・rank）・`diagnosis_share`（method）。人物名は送らない。
- **結果画像**：結果ページと同じ計算結果から生成。CDNキャッシュ `s-maxage=3600`。入力は公開人物のみ・最大12人。
- **キャッシュ**：診断結果は `unstable_cache`（300秒、tag `oshi-vod`）。キャッシュ値を小さく保つため代表作品行は表示に必要なフィールドのみに絞り、無料作品・代替手段は作品キーで参照（Snow Man 9人で約430KB）。

### 動作確認
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1712件全通過、`next build` 成功（`/` はISR 1分のまま、`/oshi-vod/opengraph-image` は静的、フォントのトレース確認済み）。
- Playwright（ローカル next dev / next start、360・390・1280px）：入口・結果（1人・3人・12人）・`?with=`・`?group=乃木坂46`・トップ／人物／グループの導線、横スクロールなし・コンソールエラーなし、robots/canonical、GA4 4イベントと /api/track の送信内容（GA通信はブロックして dataLayer で確認）、結果画像2サイズ、sitemap を確認。

---

## Task 88 追記：/oshi-vod 実画面（390px優先）のUI/UX確認と修正

### 目的
実データ（Snow Man 9人ほか）でスマホ幅390pxを中心に全18状態を確認し、「初見で使い方が分かるか・情報量・結論の見え方・CTAの自然さ・C案との統一・ランキングが広告順位に見えないか」の観点で見つかった問題を修正する。

### 変更ファイル
- `src/components/oshi-vod/OshiVodResultHero.tsx` — 主指標「見放題で見られる推しの作品 64 / 139作品」を大きく1行で表示し、カバー率・料金は2タイルに整理（390pxで数値が折り返していた）。料金の「税込」を別行の小さな表記にして「（税／込）」の不自然な折り返しを解消。「ランキングを見る↓」「結果をシェア↓」のページ内リンクを追加。
- `src/components/oshi-vod/OshiVodRankings.tsx`・新規 `OshiVodRankingTabs.tsx`（client） — 3ランキングを縦積みからタブ切替（各タブに1位を表示）に変更。ランキング内のサービス別配色CTAを撤去し、「順位は作品数・料金・配信データだけで決めています。広告の有無は順位に関係ありません」を明記（1位だけにブランド色ボタンがあり広告枠のように見えたため）。
- `src/components/oshi-vod/OshiVodServiceCta.tsx` — `variant="compact"`（中立色の小さな公式サイトリンク）を追加。詳しい比較では全サービス分の大きなブランド色ボタンが並んでいたため compact に変更。
- `src/components/oshi-vod/OshiVodDetailCompare.tsx` — 無料サービス（TVer・YouTube）の見放題欄を「0 / N作品（0%）」ではなく「対象外（無料サービス）」と表示。
- `src/components/oshi-vod/OshiVodWorkLists.tsx` — 見放題作品カードの初期表示を6→4件。代替手段リストを有用度順（有料見放題→無料→レンタル→追加チャンネル→その他）に並べ替え30件まで、無料作品はサービスごと20件までに制限。
- `src/components/oshi-vod/OshiVodPersonPicker.tsx` — 選択タグのグループ名は複数グループにまたがる場合のみ表示。グループ全員選択後はボタンを「✓ 全員選択済み」に。人物を1人以上選ぶと「診断する」ボタンを画面下に固定（sticky）。
- `src/components/oshi-vod/OshiVodEntryCta.tsx`・人物ページ・グループページ — 導線ボタンの文言を短縮（「診断 →」）し、説明文を短くして390pxでタイトルが1文字だけ折り返す問題を解消。絵文字アイコンは削除。
- `src/app/oshi-vod/oshi-vod.css` — 上記に対応するスタイル（タブ・compact CTA・sticky・料金表記）。

### 注意点
- 確認用スクリプトはGA4への送信をすべて遮断して実行する（`AnalyticsGate` は /admin 以外で常にGAを読み込むため、ローカル確認でも本番プロパティへ送信される）。今回の確認の初回実行分ではローカル（localhost）からのページビュー・診断イベントが送信されていた。
- VODロゴは管理画面登録ロゴ（/api/providers）取得後に差し替わる既存仕様のため、開発サーバー初回コンパイル直後のスクリーンショットでは空白に写ることがある（実表示は正常）。一部TMDbロゴURLは404で既存のフォールバック動作になる（既存ページと同じ）。
- 確認用スクリーンショットと再撮影スクリプトは `tmp/oshi-vod-review/`（gitignore対象）に保存。
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1712件全通過。

---

## Task 88 追記2：localhost からの GA4 送信停止・VODロゴ再確認

### 目的
ローカル開発・動作確認から本番 GA4 プロパティへ page_view・diagnosis_* 等のイベントが送信されないようにする。あわせて、完全に読み込まれた状態の本番ビルドで診断結果のVODロゴを再確認する。

### 変更ファイル
- `src/lib/analytics-host.ts`（新規）— `isLocalAnalyticsHost(hostname)`：localhost・127.0.0.1・::1・*.localhost を判定する純粋関数。
- `src/components/site/AnalyticsGate.tsx` — マウント後に hostname を判定し、ローカルホストでは `GoogleAnalytics` 自体を描画しない（GA未読込のため自動 page_view も `window.gtag` も発生せず、OshiAdBanner の affiliate_click を含む全カスタムイベントも送信されない）。/admin 除外は従来どおり。
- `src/lib/ga-event.ts` — 念のため `sendGaEvent` でもローカルホストでは送信しない。
- `src/lib/__tests__/analytics-host.test.ts`（新規）— ローカル判定と、本番・Preview・LAN IP 等では従来どおり計測することを検証。

### 確認結果
- 本番ビルド（`next start`）で、localhost・127.0.0.1 は GA リクエスト0件・`window.gtag` 未定義。ローカル以外のホスト名（ブラウザのホスト解決で 127.0.0.1 へ割り当てたテスト用ドメイン）では従来どおり gtag.js が読み込まれることを確認（確認時のGA通信は遮断し、実際には送信していない）。
- `next dev` は `allowedDevOrigins` 未設定の別オリジン（LAN IP 等）からのクライアントJSをブロックするため、GA読み込み確認は本番ビルドで行う必要がある。
- VODロゴ：Snow Man 9人の診断結果で、U-NEXT・FOD・Hulu・TELASA・Netflix・Prime Video・DMM TV・Lemino・ABEMA・NHKオンデマンド・TVer・YouTube はすべて正常表示。**Disney+ のみロゴ未表示（グレーの再生アイコン）**。原因は既存データ側で、管理画面の配信サービス（vod_providers）に Disney+ のロゴ未登録・配信データに TMDb ロゴパスなし・`public/providers/` にローカル画像なし。既存の作品詳細ページ（例 /work/tmdb-tv-295597）でも同じ表示であり、診断機能固有の問題ではない。解消するには /admin/providers で Disney+ のロゴURLを登録する（データ変更のため未実施）。
- 主要画面のスクリーンショット（本番ビルド・フォント／画像読み込み完了後に撮影）と撮影スクリプトを `tmp/oshi-vod-screens/`（gitignore対象）に保存。
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1714件全通過、`next build` 成功。

---

## Task 88 追記3：Disney+ロゴの登録・GA4を本番ホストのみに限定

### 1. Disney+ロゴ
- **調査**：`public/providers/`（.gitkeepのみ。`AVAILABLE_LOCAL_LOGO_SLUGS` も空）・リポジトリ内／git履歴の画像（Disney+素材なし）・管理画面の配信サービス（`vod_providers`：Disney+の行なし）・既存の配信データを確認。既存配信データ（`works.vod_data`）の Disney+ エントリに、TMDb watch provider（source=tmdb_watch_provider）由来のロゴパス `/5eZ872CghnHFLB1j8grszbrx0dx.png`（19件）・`/97yvRBw1GzX7fXprcF80er19ot.jpg`（3件）が既に保持されており、いずれも現在も有効（200）な Disney+ 公式ロゴだった。一方、最多の `/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg`（manual_csv 等101件）は TMDb 側で404になっており、重複集約でこの行が選ばれる作品ではロゴがグレーの代替アイコンになっていた。
- **対応**：新しい外部画像は取得・追加せず、既存データが保持していた TMDb ロゴ（ProviderLogo が Netflix・Prime Video 等で既に使っている TMDb ロゴ配信と同じ）を、既存の ProviderLogo 管理方式＝管理画面の配信サービス登録（`vod_providers`）へ登録した。管理画面 `/api/admin/providers` POST と同じ処理（`normalizeProviderName` で slug 正規化 → `saveProvider`）を使い、`slug=disneyplus`・`name=Disney+`・`logoUrl=https://image.tmdb.org/t/p/w92/5eZ872CghnHFLB1j8grszbrx0dx.png`・`isActive=true` を1行追加（本番DBへの書き込みはこの1行のみ。コード変更なし）。以後は /admin/providers から通常どおり変更・削除できる。
- **確認**：診断結果（Snow Man 9人）の全ProviderLogoで代替アイコン0件、Disney+ 7箇所すべて表示。既存の作品詳細ページ（/work/tmdb-tv-295597）でも Disney+ ロゴが表示されることを確認（診断機能だけの特殊対応ではない）。

### 2. GA4 を本番ホストのみに限定
- `src/lib/analytics-host.ts` — ローカル判定（ブラックリスト）を廃止し、`GA_ALLOWED_HOSTS = ['oshi-search.jp']` のホワイトリスト方式 `isGaAllowedHost()` に変更。localhost・127.0.0.1・*.vercel.app（Preview）・LAN IP・その他すべてのホストでは送信しない。www.oshi-search.jp は DNS 未設定（名前解決不可）のため含めていない。
- `src/components/site/AnalyticsGate.tsx` — 許可ホストでのみ GoogleAnalytics を読み込む（自動 page_view を含む）。
- `src/lib/ga-event.ts` — `sendGaEvent` も同じ判定を使う（diagnosis_start / complete / cta_click / share）。
- `src/components/affiliate/OshiAdBanner.tsx` — 既存の affiliate_click を `window.gtag` 直接呼び出しから `sendGaEvent` 経由に変更（イベント名・パラメータは同一）。これでサイト内のGA4送信はすべて同じ判定を通る。
- `src/lib/__tests__/analytics-host.test.ts` — 本番ホストのみ許可・Preview/ローカル/www/類似ドメインは拒否を検証。
- **確認（本番ビルド `next start`。ブラウザ内のホスト解決で各ホスト名をローカルへ向け、GA通信は遮断）**：localhost・127.0.0.1・Preview相当のホスト・www.oshi-search.jp は gtag.js 読込0件・カスタムイベント0件（gtag をスタブしても sendGaEvent が送らない）。oshi-search.jp のみ gtag.js が読み込まれ diagnosis_start / diagnosis_complete が記録される。*.vercel.app は .app がHSTSプリロード対象でhttp確認ができないため単体テストで検証。

### テスト
- `npx tsc --noEmit` エラーなし（`.next/types` に生成物の重複ファイル「* 2.ts」があり型エラーになったため削除して再実行。ソースコードの問題ではない）
- `npx vitest run` 1714件全通過
- `next build` 成功（`/` ISR 1分・`/oshi-vod/opengraph-image` 静的は変わらず）
- スクリーンショットは Disney+ ロゴが写る `tmp/oshi-vod-screens/05_詳しい比較_390px.png` のみ撮り直し（`capture-05.mjs`）。他は撮影済みのものを維持。

---

## Task 88 追記4：Preview確認後のUI調整（見出し・分母表記・トップ導線）

### 変更
- `src/lib/oshi-vod/core.ts`（`buildHeadline`）— 結論文を「あなたの推し3人なら、作品数重視では○○が一番合っています」から「あなたの推し3人なら、作品数1位は○○」に変更（同率時は「作品数1位はAとB（同率）」）。月額・コスパ重視では別サービスが1位になりうるため、総合的な推薦に見える表現を避け、作品数ランキングの1位であることを明示。人数・サービス名は動的。
- `src/components/oshi-vod/OshiVodResultHero.tsx` — 主指標のラベルを「対象43作品中、見放題で見られる作品」にし、数値の下に小さく「対象＝現在いずれかの有料サブスクで見放題確認できる43作品（登録出演作品154作品のうち）」を補足（登録出演作品との違いを明示）。
- `src/components/oshi-vod/OshiVodEntryCta.tsx`・`src/app/page.tsx` — 導線カードに任意の小さな補足ラベル `note` を追加し、トップページのみ「無料・登録不要」を表示（説明文は「推しを選ぶだけで、一番多く見られるサービスがわかる」）。人物・グループページの導線は変更なし。
- テスト（結論文の期待値）を更新。診断ロジック・ランキング・共有・SEO・結果画像は変更なし。

---

## Task 89：「FODプレミアム」を FOD として統合（provider名正規化のエイリアス追加）

### 目的
配信データに「FODプレミアム」（および英字表記「FOD Premium」）と登録された配信情報が、FOD とは別サービス（slug `fodプレミアム` / `fodpremium`）として扱われ、人物ページ・作品ページ・/vod/fod・推しに合うサブスク診断で FOD の件数が少なく出ていた。DBの配信データは書き換えず、既存の正規化処理で統合する。

### 変更ファイル
- `src/lib/vod-dedup.ts` — `normalizeProviderName()` の完全一致エイリアス表 `CANONICAL_SLUG_MAP` に `'fodプレミアム': 'fod'`・`'fodpremium': 'fod'` を追加（Leminoプレミアム → lemino と同じ扱い）。Prime Video 追加チャンネル（FOD Channel Amazon Channel 等）の判定は正規化より前に行われるため影響しない。
- `src/lib/__tests__/vod-dedup.test.ts` — 正規化（FODプレミアム / FOD Premium → fod、追加チャンネルは統合しない、他サービス不変）と、同一作品に FOD・FODプレミアム・FOD Premium が並ぶ場合に1件へ集約されることを検証（4件追加）。

### 設計上の判断
- 人物ページ・作品ページ・StreamingNowSection・グループページ・/vod/[provider]・Instagram投稿・推しに合うサブスク診断はすべて `normalizeProviderName()` / `deduplicateProviders()`（`vod-availability.ts` 経由を含む）でサービスを識別しているため、エイリアス1か所の追加で全画面が FOD に統一される。同一作品に FOD と FODプレミアム が両方ある場合は `deduplicateProviders()` により1件（ソース優先度の高い方）に集約され、重複カウントしない。
- 診断ランキングの計算にアフィリエイト情報を渡さない仕様は変更なし。

### 実データでの確認（読み取り専用。全公開人物360人）
- 生データ：FODプレミアム 見放題23件・レンタル3件、FOD Premium 見放題1件 → すべて slug `fod` として認識。
- 人物ページ相当（全人物の「今すぐ見られる」件数合計）：FOD 1,436 → 1,446（+10）、fodプレミアム 23 → 0、fodpremium 1 → 0。+10 にとどまるのは、24件のうち14件が同じ作品に既に FOD があり1件に集約されたため（FOD と FODプレミアム 併記の作品行は17件）。
- FOD 以外のサービス：全126サービス・全360人で件数の変化なし。
- FOD件数が変わった人物は8人（例：山里亮太 4→7、バナナマン 4→5、広瀬アリス 11→12）。Snow Man・なにわ男子・目黒蓮の診断は FODプレミアムの作品を含まないため変化なし。
- 診断（例：山里亮太）：FOD見放題 4→7、有料サブスク見放題の対象作品 19→20（FODプレミアムのみで配信されていた作品が新たに対象に入るため）。他サービスの作品数は不変だが、分母が増えるためカバー率は変わる（U-NEXT 11/19=57.8% → 11/20=55%）。詳しい比較の「そのほかの配信」から FODプレミアム が消えた。
- 画面（本番＝修正前 と ローカル本番ビルド＝修正後 の比較）：人物ページ（山里亮太）の配信サービス比較が「FOD 4件・fodプレミアム 3件」→「FOD 7件」。作品ページ tmdb-movie-308186 は FODプレミアム と FOD の2カードが FOD 1カードに、FODプレミアムのみの tmdb-movie-55887 は「FODプレミアムで視聴可能（リンクなし）」→「FODで今すぐ見る →」（FODの公式リンク・配色）。/vod/fod は 1,378 → 1,383作品、271 → 272人。

### 未対応（報告のみ）
- 「Amazonプライム・ビデオ（FODチャンネル経由）」1件が Prime Video 本体として扱われている（全角表記のため追加チャンネル判定の正規表現に一致しない）。FOD以外（Prime Video）の集計に影響するため今回は変更していない。

### テスト
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1718件全通過、`next build` 成功。

---

## Task 89 追記：Prime Video 追加チャンネルの表記ゆれ判定（本体見放題からの除外）

### 目的
「Prime Videoの追加チャンネル・別料金チャンネルは、Prime Video本体の見放題としてカウントしない」ルールが、一部の表記ゆれで効いていなかった（Prime Video本体の見放題として、人物ページ・作品ページ・推しに合うサブスク診断に数えられていた）。DBの配信データは書き換えず、既存の追加チャンネル判定（`detectPrimeVideoChannel` → `normalizeProviderName` / `isPrimeVideoChannel`）を拡張する。

### 調査（読み取り専用・全配信データ）
- 追加チャンネルなのに Prime Video 本体（slug `primevideo`）として扱われていた表記：
  - 「Amazonプライム・ビデオ（FODチャンネル経由）」1件（日本語表記のため判定の正規表現に一致しなかった）
  - 「Prime Video（Leminoセレクト）」3件・「Prime Video (Leminoセレクト)」1件（"Amazon" なしの "Prime Video（…）" 形式が判定対象外だった）
- 本体扱いではないがチャンネルとして認識されていなかった表記：「アニメタイムズ（Amazon Prime Videoチャンネル）」1件（slug `アニメタイムズ`＝「その他」扱い。ランキングには元々数えていない）
- 正しく追加チャンネル判定されていたもの：「○○ Amazon Channel」形式（TMDb由来、NHK On Demand / FOD Channel / dAnime / TELESA 等 34種）、「FODチャンネル for Prime Video」、「Amazon Prime Video（FODチャンネル）」「Amazon Prime Video（Leminoセレクト）」。FOD本体（slug `fod`）に追加チャンネルが混ざっているデータはなかった。
- provider名では判定できず note にのみチャンネルである旨が書かれている行：
  - providerName「Prime Video」・flatrate・note「Prime Video内のNHKオンデマンドチャンネルで現在配信中。別途チャンネル契約が必要。」1件
  - providerName「NHKオンデマンド」・flatrate・note「Prime Video内のNHKオンデマンドチャンネルで本作を配信中…」1件
  - （他に note「配信区分は見放題/チャンネル扱いとして記録」の Prime Video 1件は記述が曖昧）
  自由記述の note からの自動判定は誤判定の恐れがあるため実装していない（データ側の修正を推奨、未実施）。
- TBSチャンネル・バンダイチャンネル・YouTube（○○チャンネル）等は Prime Video とは無関係の名称で、追加チャンネル判定の対象外（変更なし）。

### 変更ファイル
- `src/lib/vod-dedup.ts`
  - 追加チャンネル判定の正規表現を拡張：先頭が "Amazon Prime Video" / "Prime Video" / "Amazonプライム・ビデオ" / "プライムビデオ" の「（○○）」形式、および「○○（Amazon Prime Videoチャンネル）」の後置形式。括弧内の「…経由」は除去し「Amazon Prime Video（FODチャンネル）」と同じスラグにそろえる。
  - 本体を指す括弧表記（パススルー）に「見放題」「プライム会員特典」を追加（既存の jp / withads / 広告付き はそのまま）。
  - 追加チャンネル表示名（`extractChannelName`）も同じ判定でチャンネル名を取り出すよう変更。`AMAZON_CHANNEL_DISPLAY_NAMES` に `fodチャンネルamazonchannel`（FODチャンネル）・`アニメタイムズamazonchannel`（アニメタイムズ）を追加。
- `src/lib/__tests__/vod-dedup.test.ts` — 表記ゆれの追加チャンネル判定、本体表記は追加チャンネルにしない、Prime Video 以外の「チャンネル」名は対象外、表示名の検証を追加（15件）。
- FODプレミアム → FOD の正規化（Task 89 本編）はそのまま維持。

### 実データでの確認（読み取り専用。同じデータに対して修正前後を連続で計測）
- 全360人の「今すぐ見られる」件数：Prime Video 1,401 → 1,396（-5）。移動先は Leminoせれくと +4・FODチャンネル +1（追加チャンネル）。アニメタイムズ1件は「その他」→ 追加チャンネル表示に変わるのみ。FOD（1,446）を含む他サービスは不変。影響する人物は6人（篠塚大輝・正源司陽子・宮地すみれ・石塚瑶季・清水理央・上村ひなの）。
- 診断：篠塚大輝 Prime Video 1→0（月額1位 Prime Video → TELASA、コスパ3位 Prime Video → U-NEXT）、timelesz Prime Video 16→15（順位不変、1作品あたり38円→40円）、日向坂4人（宮地・正源司・清水・石塚）Prime Video 1→0（月額1位 Prime Video → TELASA）。2サービス最適化・80%以上を最安で見る方法はいずれも変化なし。Snow Man・なにわ男子・目黒蓮は変化なし。
- 画面（本番＝修正前 と ローカル本番ビルド＝修正後）：作品ページ tmdb-tv-289474 / tmdb-tv-290464 で、追加チャンネルのカードと並んで誤って表示されていた「Prime Videoで今すぐ見る →」（本体扱い）が消え、「Prime Video内 FODチャンネル」「Prime Video内 Leminoせれくと」（追加チャンネル・別途チャンネル登録が必要）のみに。人物ページ（篠塚大輝）の配信サービス比較は「Prime Video 1件」→「Prime Video内 FODチャンネル 追加チャンネル 1件」。診断の詳しい比較「そのほかの配信」に追加チャンネルとして表示され続ける（作品自体は消えない）。
- 計測中、本番DBの配信データが自動更新等で変化していたため（約1〜2時間で無関係な件数差が発生）、比較は同一データに対して修正前後のコードを連続実行して行った。

### テスト
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1733件全通過、`next build` 成功。

---

## Task 89 追記2：Prime Video 追加チャンネル誤登録（157行）の公式確認・再発防止（DB未反映）

### 公式確認（読み取りのみ・DB変更なし）
- 対象：Prime Video 本体の見放題として集計中で note 等に追加チャンネル・別契約の可能性がある157行（122作品・76人）。
- 方法：Amazon / Prime Video の公式作品ページを取得し（Amazon検索・primevideo.com検索でタイトルから特定したページを含む）、視聴ボタンで判定。
  - 追加チャンネル＝「○○で観る 今すぐ登録」「○○の無料体験を開始する」（benefitId=nhkondemandjp 等）
  - Prime Video 本体＝「30日間の無料体験／プライムに登録」のみ
  - 「PrimeまたはNHKオンデマンドに登録」＝プライム会員でも視聴可（本体扱い・要確認）
  - 「お住まいの地域ではPrime Videoでの配信は終了しました」＝本体での配信なし（チャンネル登録ボタンがあればチャンネル）
  JustWatch等の第三者情報のみでは確定していない。
- 結果（同一作品の他人物行1件を追加した158行）：A Prime Video本体 17行/16作品、B 追加チャンネル 132行/97作品、C 別サービス本体 0、D 公式確認できず 9行/9作品（配信終了7・レンタルのみ1・特定不可1）。初回分類でA1（確認不要）とした中にも「PrimeまたはNHKオンデマンド」（本体でも視聴可）の作品があり、公式ページの再確認で本体へ戻した。
- 出力：`tmp/prime-channel-review/prime_video_review37_final.csv`（個別確認37行）、`tmp/prime-channel-review/prime_video_final_fix.csv`（最終修正CSV・158行：rename 132 / set_unknown 8 / set_rent 1 / keep 17）。
- 最終シミュレーション（メモリ上）：Prime Video本体の見放題 1,385→1,244（人物×作品）、ユニーク作品 946→840、FODは不変。順位（作品数/月額/コスパの1位・2サービス最適化・80%方法）が変わる対象 39（個人37・グループ2：Snow Man＝コスパ1位 Prime Video→U-NEXT、THE ORAL CIGARETTES）。

### 再発防止（コード変更・DBは未変更）
- `src/lib/vod-research-prompt.ts` — `PRIME_VIDEO_CHANNEL_RULE` を追加し、通常調査・ChatGPT完全同期の両プロンプトに挿入（Prime Video は追加料金なしで視聴できる場合のみ、追加チャンネルは「○○ Amazon Channel」の正式名、チャンネル名不明は unknown＋要確認、本体と追加チャンネルを同じ名前にしない）。
- `src/lib/vod-supplement.ts` — OpenAI Web検索補完プロンプトに同じルールを追加。
- `src/lib/vod-channel-guard.ts`（新規） — `isSuspectedPrimeChannelRow()`：provider が Prime Video 本体なのに note に「チャンネル／別途／追加契約／別料金／追加登録／for Prime Video／会員特典単体ではない」等、または sourceUrl が Prime Video のチャンネルページの行を検出。provider は書き換えない。
- `src/lib/vod-recheck-csv-import.ts` — 上記の行は取り込まず保留。プレビューに「追加チャンネルの可能性があります」警告、結果に保留行一覧。merge では保留行のみの作品は更新しない。ChatGPT完全同期では保留行がある作品の既存 Prime Video 情報を変更しない（`preserveSlugs`）。
- `src/lib/vod-chatgpt-sync.ts` / `src/lib/work-store.ts` — `computeChatgptFullSync` に `preserveSlugs` オプション。scope外（追加チャンネル名）を再取り込みした際、既存の同名 manual_csv エントリを置き換えて同一作品×同一サービスの重複を防止（TMDb等の他ソースは従来どおり保持し表示時に集約）。
- `src/app/api/admin/work-vod-import/route.ts` / `src/app/admin/work-import/WorkVodImportForm.tsx` — 行アクション `suspected_channel`（追加チャンネルの可能性・保留）を追加し、登録しない。
- `src/app/admin/vod-recheck/VodRecheckClient.tsx` — 反映結果に保留行を表示。
- テスト：`vod-channel-guard.test.ts`（新規）、`vod-chatgpt-sync.test.ts`・`vod-recheck-csv-import.test.ts` に追加。`npx tsc --noEmit` エラーなし、`npx vitest run` 1754件全通過、`next build` 成功。

---

## Task 89 追記3：Prime Video 追加チャンネル誤登録の反映用スクリプト（dry-run のみ実行・DB未反映）・再発防止の抜け漏れ対応

### 目的
- 最終確認済みCSV（158行）の変更だけを本番DBへ安全に反映する専用スクリプトを用意する。通常のVOD CSV取り込み（同名providerの上書き）は使わない。
- CSV取り込み・AI補完など、Prime Video 本体名義で追加チャンネルが登録され得る経路をすべて「保留」で塞ぐ。

### 反映用スクリプト（新規）
- `scripts/data/prime-video-channel-fix-2026-10.csv` — 最終修正CSV（`tmp/prime-channel-review/prime_video_final_fix.csv` と同一内容。tmp/ は gitignore のためスクリプトと一緒に管理）。
- `scripts/prime-video-channel-fix/plan.ts` — 判定ロジック（純粋関数）。
  - personName / workId / canonicalWorkId（work_aliases で解決）/ provider名 / 種別 / source / note が DB と完全一致する provider だけを変更対象にする。同じ条件の provider が2件以上・作品行なし・削除済み・hidden・canonical不一致などはすべて error（変更しない）。
  - 修正後状態に一致する行は already_applied（冪等）。
  - 件数検査（総158・変更141・ユニーク106作品・rename 132 / set_unknown 8 / set_rent 1 / keep 17）が1件でも違えば apply 不可。
  - rename 時は Prime Video の TMDb `logoPath`・`providerId`（9 等）を外し `providerId=-1` にする（チャンネルなのに Prime のロゴが表示されるのを防ぐ。ChatGPT一括同期の手動エントリと同じ形）。set_unknown / set_rent は配信種別のみ変更。削除はしない。
  - `evaluateRollbackEntry()` — バックアップから今回の変更だけを戻す判定。
- `scripts/prime-video-channel-fix/run.ts` — 実行本体。
  - デフォルトは dry-run（SELECT のみ）。`--apply` のときだけ書き込み。`--rollback <backup.json>` で復元（これも `--apply` なしは dry-run）。
  - apply は `neonSql.transaction()` の1トランザクション。各作品行は「読み込んだ時点の vod_data と jsonb で同一」の場合だけ UPDATE し、0行なら `1/0` でエラーにして全体をロールバック（部分反映なし）。`vod_recheck_logs` に作品行ごとの監査ログ（performed_by=`script:prime-video-channel-fix-2026-10`）。反映後に再読込して全行 already_applied を検証。
  - 毎回 `tmp/prime-channel-fix/<日時>-<mode>/` に result.csv・backup.csv・backup.json（変更対象の provider 修正前JSON＋作品行の vod_data 全体）を出力。
  - 実行：`npx dotenv -e .env.local -- npx tsx scripts/prime-video-channel-fix/run.ts`（`--apply` は本番デプロイ完了後に実行する）。
- `scripts/prime-video-channel-fix/plan.test.ts` — 一致判定・冪等・rename時のロゴ除去・復元判定・同梱CSVの件数検査。

### dry-run 結果（2026-10-09・本番DB・書き込みなし）
- 変更予定 141（rename 132 / unknown 8 / rent 1）・適用済み 0・維持 17・エラー 0・ユニーク106作品・作品行141。楽観ロック条件の事前確認 141/141。
- rename の内訳：NHK On Demand 63 / FOD Channel 26 / TELASA 19 / Lemino Select 7 / Nihon Eiga Net 5 / スペシャオンデマンド 5 / Anime Times 2 / KANTELE DOGA 2 / FANY 1 / 中京テレビ セレクト！ 1 / Channel Kyofu 1。rename 対象のうち131件は Prime の logoPath・providerId を保持していた。
- dry-run の変更内容で診断をメモリ上シミュレーション：Prime Video本体の見放題 1,385→1,244（人物×作品）・ユニーク 946→840、FOD 1,423 不変、順位が変わる39対象は前回の最終シミュレーションと完全一致。
- 注意：rename 先と同じチャンネルの TMDb エントリが既に同じ作品行にあるものが8件（表示・集計は `deduplicateProviders` で1件に集約。削除はしない方針のため残す）。

### 再発防止の抜け漏れ対応（保留方式・provider の自動書き換えなし）
- `src/app/api/admin/vod-title-import/route.ts` / `src/app/admin/people/import/VodImportForm.tsx` — 行アクション `suspected_channel`（保留・未登録）、件数・注意文・完了画面の保留タイトル一覧。
- `src/app/api/admin/csv-import/route.ts` / `src/app/admin/work-check/VodImportSection.tsx` — プレビューで `suspected_channel`。保存時もサーバー側で再判定して登録しない（`heldProviderCount`）。同期モードでは保留行のサービスを「CSVに記載あり」として扱い、既存の同名 manual_csv を削除しない。
- `src/app/api/admin/work-csv-import/route.ts` / `src/app/admin/work-check/WorksImportSection.tsx` — `vodAction: 'suspected_channel'`（作品登録は通常どおり、VODのみ保留）。
- `src/lib/vod-channel-guard.ts` — `partitionSuspectedPrimeChannelProviders()`：AI結果の note / reason / officialUrl / sourceUrl で判定。
- `src/lib/vod-supplement.ts` — AI Web検索補完の結果から該当 provider を採用しない（警告ログ）。vod-fetch / vod-recheck / cron vod-recheck / cron vod-refresh / vod-person-recheck / work-processor はすべて `supplementVodWithAI` 経由のためこれで塞がる。
- 対象外：`/api/admin/vod-add`（管理者が名前を選んで手動追加。note・URL を持たないため判定材料がない）、`work-manual`（VOD登録なし）、TMDb取得（TMDb側でチャンネルは別名で返る）。
- 既知の注意：今回修正する行のうち source=ai_recheck 2件・openai_web_search 1件は、今後のAI再確認／TMDb更新で置き換わる（置き換え時はAI結果に上記ガードが効く）。

### テスト
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1765件全通過、`next build` 成功。

---

## Task 90：サブスク診断（/oshi-vod）のアフィリエイト導線とFOD・ABEMA・NHKオンデマンド・のぎ動画の料金比較対応

### 目的
1. 診断結果の各サービスCTAを、提携済みサービスでは確実にアフィリエイトリンクにする（同じ広告を診断用に二重登録しなくても済むようにする）。
2. 「料金比較対象外」だったサービスの料金を公式サイトで再確認し、比較できるものは月額・コスパ比較に入れる。比較できないものは理由を出し分けて表示する。

### 調査結果（本番DB・読み取りのみ）
- `affiliate_programs` は Hulu（アクセストレード）1件のみ。素材は raw_html 1件（「Huluで今すぐ見る」）で、掲載位置は `work_provider` のみ。`oshi_vod_result` への掲載が無かったため、診断画面では Hulu も公式サイトリンクになっていた。

### 変更ファイル
- `src/components/oshi-vod/OshiVodServiceCta.tsx` — リンク先の優先順位を「`oshi_vod_result` の有効広告 → 同サービスの `work_provider` の有効広告 → 公式サイト（VodTrackLink）」に変更。`AffiliateSlot` の fallback を入れ子にするだけで、`AffiliateSlot`・`resolveAffiliateSlot` のロジックは無変更。詳しい比較用（compact）には `ov-cta--compact` クラスを付与。
- `src/components/site/AffiliateSlot.tsx` — CTA配色（`.affiliate-slot--work-provider`）の適用対象に `oshi_vod_result` を追加（現在この掲載位置を使っているのは診断画面のみ。`work_provider` 等の既存表示は無変更）。
- `src/app/oshi-vod/oshi-vod.css` — 詳しい比較（全サービスが並ぶ欄）では、アフィリエイト広告のリンクも公式サイトリンクと同じ中立の見た目にする（提携の有無で強調を変えない）。
- `src/components/oshi-vod/OshiVodTracker.tsx` — `diagnosis_cta_click` に `link_type`（affiliate / official）を追加。アフィリエイト広告のクリックは VodTrackLink を通らないため、ここで `/api/track`（`{type:'vod', service}`）を送り、VODクリック数の計測を維持。
- `src/lib/vod-plan-info.ts` — 2026-10-09 に公式サイトで確認した料金を登録し、比較対象にした：FOD（FODプレミアム スタンダードコース 1,320円税込・`fod.fujitv.co.jp/about/`。ライトコース976円は見放題本数が異なるため不使用）、ABEMA（広告つきABEMAプレミアム 680円税込・公式FAQで限定コンテンツが「すべて」見られると明記。広告なし1,180円と見放題範囲が同じ）、NHKオンデマンド（まるごと見放題パック 990円税込・`/share/enjoy/`・`/share/price/`）、のぎ動画（有料会員 WEB登録 1,320円税込・公式FAQ「支払いには何が使えますか？」。アプリ登録は1,700円）。Netflix は公式ヘルプが「地域によっては別途税金が課される場合があります」のみで税込を確定できないため比較対象外のまま。`notComparableReason`（price_unconfirmed / tax_unconfirmed）を追加。
- `src/lib/oshi-vod/format.ts` — `priceExclusionLabel()`：比較対象外の理由を出し分け（「料金未確認のため比較対象外」「税込料金を公式で確認できないため比較対象外」「無料サービスのため月額比較なし」）。
- `src/components/oshi-vod/OshiVodServiceLine.tsx`・`OshiVodPairs.tsx`・`OshiVodResultHero.tsx`・`OshiVodDetailCompare.tsx` — 一律の「料金比較対象外」「比較対象外」を上記の理由別文言に変更。追加チャンネル・料金未登録サービス（そのほかの配信）にも理由を表示。
- テスト：`vod-plan-info.test.ts`（追加5件）、`oshi-vod-format.test.ts`（新規3件）。

### 設計上の判断・注意点
- アフィリエイトの有無はランキング計算に一切渡していない（`core.ts` 無変更）。変わるのはリンク先だけ。
- `work_provider` の広告を診断で再利用した場合、ASP側では作品ページ経由と区別できない。診断経由を分けて計測したい場合は、管理画面で同じ素材に `oshi_vod_result` の掲載位置を追加すれば、そちらが優先される。
- 作品数ランキングは同数の並び順の最終キーが「月額の安い順」のため、料金登録により同率内の表示順だけ変わる対象がある（順位・件数は不変）。
- 実データ再計算：作品数ランキングの順位・件数は全378対象で不変。月額1位・コスパ1位・2サービス最適化・80%方法のいずれかが変わる対象は126（個人125・グループ1＝DISH//）。

### 動作確認
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1774件全通過、`next build` 成功。
- ローカル本番ビルド（外部通信はすべて遮断。ASPのクリック・インプレッションを発生させない）で、Hulu＝アフィリエイト（PR表記付き）、他サービス＝公式リンク、のぎ動画・FOD・NHKオンデマンドが月額・コスパに参加、Netflix は作品数ランキングのみ＋理由表示を確認。`diagnosis_cta_click`（service・placement・rank・link_type）と `/api/track` の送信を確認。`/oshi-vod` の index・canonical・OG画像・結果画像・sitemap・トップ／人物ページの導線、作品ページの既存Hulu広告表示に変化がないことを確認。

---

## Task 90 追記：料金のプラン名表示・料金確認日・CTAの見た目統一・診断キャッシュキー

### 変更ファイル
- `src/lib/vod-plan-info.ts` — `priceLabel`（料金表示の前置き。未指定は「月額」）を追加。のぎ動画「WEB月額」、FOD「スタンダードコース 月額」、NHKオンデマンド「まるごと見放題パック 月額」、ABEMA「広告つきABEMAプレミアム 月額」。のぎ動画の注記を「アプリから登録する場合は月額1,700円（税込）と料金が異なります」に。
- `src/lib/oshi-vod/format.ts` — `formatMonthlyPrice()` が `priceLabel` を使う（ランキング・組み合わせ・詳細比較・結果画像で共通）。`formatIsoDateJa()`（「2026年10月9日」）を追加。
- `src/components/oshi-vod/OshiVodResultHero.tsx` — 結論カードの料金に `priceLabel` を反映。
- `src/components/oshi-vod/OshiVodPairs.tsx` — `priceLabel` があるサービスはプラン名の重複表示をしない。
- `src/components/oshi-vod/OshiVodDetailCompare.tsx` — 料金確認日を「2026年10月9日（公式）」形式で表示。
- `src/app/oshi-vod/oshi-vod.css` — 結論カード・組み合わせのCTAは公式リンクとアフィリエイト広告で同じ大きさ（高さ44px以上・14px）にする（提携の有無で見た目の優先度を変えない）。
- `src/lib/oshi-vod/data.ts` — 診断結果キャッシュ（`unstable_cache`）のキーに料金情報の指紋 `PLAN_INFO_FINGERPRINT` を追加。キャッシュ値に料金・プラン名が含まれるため、料金表を更新したデプロイ直後に古い料金の結果（最大300秒＋再検証1回分）が表示されるのを防ぐ（Vercel の Data Cache はデプロイをまたいで残る。ローカルで実際に旧表示が出ることを確認して対応）。
- テスト：`oshi-vod-affiliate.test.ts`（新規13件）— 診断の計算（core / data / image-data）からアフィリエイト関連モジュールへ到達しないこと、ランキング・組み合わせ・詳細比較の部品がアフィリエイトを直接参照しないこと、CTAのリンク先が「oshi_vod_result → work_provider → 公式」の順であること・広告時のみPR表記、計測用 data 属性。`oshi-vod-format.test.ts` に料金表示・日付の7件を追加。

### 確認
- `npx tsc --noEmit` エラーなし、`npx vitest run` 1794件全通過、`next build` 成功。
- ローカル本番ビルドと Preview（`vercel deploy` で作業ツリーから作成。git push なし）で 390px・1280px を確認：横スクロールなし、「WEB月額」「広告つきABEMAプレミアム 月額680円（税込）」等の表示、料金確認日、アプリ料金の注記、既存の注意書き、Hulu＝アフィリエイト（PR）・他＝公式（PRなし）、CTA高さ（結論・組み合わせ44px以上／詳細比較40px）。
- `diagnosis_cta_click` の link_type（affiliate / official）と `/api/track` の送信を確認（外部通信は遮断して実施）。
- 実データ：作品数ランキングの順位・件数は全378対象で不変、月額・コスパ1位／2サービス／80%方法が変わる126対象（個人125・グループ1）はすべて新たに比較対象にしたサービスが関わる変化。

---

## Task 90 追記2：公式URLが無いサービスの空CTA枠を非表示

### 目的
詳しい比較で、公式URLが無く広告も無いサービス（例: amazonvideo のレンタル・購入のみ）の CTA 枠が空のまま余白として表示されていたのを解消する。

### 変更ファイル
- `src/app/oshi-vod/oshi-vod.css` — `.ov-page .ov-cta:empty { display: none; }`。CTA は Server Component で、広告の有無は AffiliateSlot の解決後にしか分からないため、何も描画されなかった枠だけを CSS で非表示にする。リンク先は推測で作らない。
- `src/lib/__tests__/oshi-vod-affiliate.test.ts` — 公式URLも広告も無いサービスはリンクを作らないこと、広告があれば従来どおり広告を表示することを追加（1件）。

### 設計上の判断・注意点
- ランキング計算・VOD判定・アフィリエイト判定（oshi_vod_result → work_provider → 公式）・DBは変更していない。URLがあるサービスの表示は従来どおり。

---

## Task 90 追記3：詳しい比較で「Prime Video」が2つ並ぶ問題（amazonvideo のレンタル・購入）

### 背景
TMDb の「Amazon Video」（正規化スラグ amazonvideo）はレンタル・購入のストアで、本番DBでは552件すべてが rent / buy。共通の表示名（`vod-dedup.ts` の `SLUG_DISPLAY_NAME`）が「Prime Video」のため、診断の詳しい比較で Prime Video 本体（見放題）のカードと同名のカードが2つ並んでいた（例: 中村倫也）。

### 変更ファイル
- `src/lib/oshi-vod/core.ts` — `DIAGNOSIS_SERVICE_NAME_OVERRIDES`（amazonvideo → 「Prime Video レンタル・購入」）を追加し、`computeServiceStats` のサービス単位の表示名（詳しい比較のカード名等）だけに適用。作品ごとのチップは「Prime Video ＋ 購入／レンタル」のように種別ラベルが付き区別できるため従来どおり。共通の表示名（作品ページ・人物ページ・グループ・Instagram・動画生成）、サービス識別子・分類・ランキング計算・DBは変更していない。
- `src/lib/oshi-vod/data.ts` — 診断結果キャッシュのキーに結果の版 `DIAGNOSIS_RESULT_VERSION`（2）を追加。表示名がキャッシュ値に含まれるため、デプロイ直後に旧コードで計算された結果（最大300秒）が表示されないようにする。
- `src/lib/__tests__/oshi-vod-core.test.ts` — 同じ作品に Prime Video 見放題とレンタルがある場合の表示区別、レンタル・購入がランキング（作品数・月額・コスパ・2サービス・80%）に入らないことを追加（2件）。

---

## Task 90 追記4：「Prime Video レンタル・購入」カードの月額欄の表示

- `src/lib/oshi-vod/core.ts` — `DIAGNOSIS_RENTAL_STORE_SERVICES`（amazonvideo のみ）を追加（表示専用）。
- `src/components/oshi-vod/OshiVodDetailCompare.tsx` — 上記サービスの月額欄を「比較対象外（料金未確認）」→「対象外（レンタル・購入）」に変更（料金情報が不足しているように見えるため）。Prime Video 本体・他サービスの表示、ランキング・2サービス最適化・80%判定（rent / buy は元々対象外）、アフィリエイト判定、DB、作品・人物・配信サービスページは変更なし。表示文言はコンポーネント側で決めるためキャッシュ値には影響しない。
- `src/lib/__tests__/oshi-vod-affiliate.test.ts` — 詳しい比較の月額欄（amazonvideo＝対象外（レンタル・購入）、Prime Video 本体＝月額600円（税込）等）を検証（1件）。

---

## Task 91：動画生成 — PERSON_REGISTRY未登録の推しサーチDB人物が「人物の対応付け」で失敗する問題

### 背景
本番 /admin/video-maker で 森本慎太郎 / まず見る3作 ショートV1 を生成すると「PERSON_REGISTRY未登録で、推しサーチDBで確認済みの人物slugも渡されていません」で失敗していた。ジョブ作成時（`createVideoJobs`）には `personVideoSlug(personName)` で人物slug（`p-3a6837bdcc7a`）を `video_generation_jobs.person_slug` に保存していたが、Workerがジョブを受け取る `/api/worker/video-jobs/claim` の応答に `personSlug` が含まれておらず、Worker（`resolveJobPerson`）には常に未指定で届いていた（4ce15ec で作成側だけ対応し、claim 応答への追加が漏れていた）。PERSON_REGISTRY 登録済みの人物は Worker が registry のslugを優先するため影響が無く、気づかれなかった。

### 変更ファイル
- `src/app/api/worker/video-jobs/claim/route.ts` — claim 応答に `personSlug: job.personSlug` を追加（ジョブ作成時に保存したDB人物のslugをそのまま渡す。推測・再計算はしない）。
- `src/app/api/worker/video-jobs/claim/__tests__/route.test.ts` — claim 応答に personSlug が含まれることを検証（1件）。

### 設計上の判断・注意点
- oshi-video-maker・DB schema・migration は変更なし。Worker側は既に「PERSON_REGISTRY優先、未登録なら渡されたslugを人物名から計算し直して一致した場合だけ使う」「テーマは registry に設定があれば上書き、無ければ DEFAULT_VIDEO_THEME」の実装済み。
- 登録済み人物（松村北斗・目黒蓮など）は Worker が渡されたslugを使わず registry のslugを使うため挙動は変わらない。

---

## Task 92：動画「推しでサブスク比較 ショートV1」— テンプレート共通CapCut音声を、台本が一致する3人だけ選べるようにする

### 目的
oshi-video-maker 側で「推しでサブスク比較」をテンプレート共通のCapCut音声（推し活あるあると同じ sharedCapcut 方式）に対応させた。共通音声の台本は、診断結果が「2サービスの組み合わせ（80%以上の表示なし）」のときだけ完全に一致する（それ以外は独自結果シーンの文が変わる）。不適合な3人で CapCut を選んで Worker で失敗する・誤った音声で生成されることを防ぐため、管理画面とジョブ作成APIでも、3人の診断結果が共通音声の利用条件に合うかを確かめる。

### 変更ファイル
- `src/lib/oshi-vod/video-feature.ts`（新規）— 診断結果から動画の台本の種類（pair / pair-over80 / single / single-covers-all）を求める純粋関数 `oshiVodVideoFeature`（oshi-video-maker の decideVodCompareFeature と同じ条件。台本の文章は持たない）、Worker報告の利用条件 `requires` の検証 `parseSharedCapcutRequirement`、判定 `checkVodCompareSharedCapcut`、理由の文言。
- `src/app/api/worker/heartbeat/route.ts` — `sharedCapcut.requires`（`{ kind: 'oshi-vod-compare-feature', feature: 'pair' }`）を検証して保存。既存の `video_workers.templates`（jsonb）に入るだけで schema 変更なし。知らない値は保存しない（条件不明＝CapCut不可）。
- `src/server/video-jobs/job-store.ts` — `WorkerTemplateInfo.sharedCapcut.requires` を追加。`createVideoJobs` で、推しでサブスク比較 × capcut の場合だけ診断結果を読み込み（`loadOshiVodVideoDiagnosis`。循環importを避けるため動的import）、`checkVodCompareSharedCapcut` が不可なら 400（日本語の理由）。管理画面からの作成・API直接呼び出し・再生成（`retryVideoJob`）のすべてがここを通る。
- `src/app/api/admin/video-jobs/vod-compare-preview/route.ts` — 3人の生成前確認の応答に `capcutCompatible` / `capcutReason` を追加（Worker最新報告＋診断結果で同じ関数を使って判定）。
- `src/app/admin/video-maker/VodCompareTrioPicker.tsx` — プレビューの判定を `onCapcutCheck` で親へ渡す。
- `src/app/admin/video-maker/VideoMakerClient.tsx` — 3人選択時、不適合なら「CapCutナレーション」を disabled にして理由を表示（選択中なら「音声なし」へ切り替え）。適合を確認できるまで CapCut での生成ボタンは押せない。共通音声の説明（Worker報告の message）を表示。「音声なし（あとから追加）」は常に選べる。
- テスト: `src/lib/__tests__/oshi-vod-video-feature.test.ts`、`src/server/video-jobs/__tests__/job-store-vod-capcut.test.ts`、`src/app/api/admin/video-jobs/__tests__/vod-compare-preview.test.ts`（計17件。既存の推し活あるある・人物ごとCapCut（まず見る3作）の挙動が変わらないことも確認）。

### 設計上の判断・注意点
- DB schema・migration なし（requires は jsonb の templates に保存、ジョブは既存の narration_mode / template_input をそのまま使う）。claim・Worker へのジョブ受け渡しも変更なし。
- 判定は3段: 管理画面（プレビューAPI）→ ジョブ作成API（最終防御・再生成も含む）→ oshi-video-maker の生成処理（診断結果から作った台本と共通音声の台本ハッシュを撮影前に照合し、違えば中止）。UIだけの判定にはしていない。
- Workerが requires を報告しない（旧Worker）・共通音声が準備できていない場合は、推しでサブスク比較の CapCut は作れない（安全側）。推し活あるある（requires なし）・人物ごとのCapCut保存済み音声の判定は従来どおり。
- 反映順: oshi-search を先に deploy（旧Workerは推しでサブスク比較の capcut を報告しないため、deploy しても挙動は変わらない）→ oshi-video-maker を更新し Worker を再起動（起動時にテンプレート報告を作るため再起動が必要）。

---

## Task 93：動画生成の投稿文タブ — 投稿前に編集してからコピーできるようにする（推しでサブスク比較の投稿文自動生成に合わせて）

### 目的
oshi-video-maker 側で「推しでサブスク比較 ショートV1」でも Instagram / TikTok / Threads / X の投稿文を自動生成するようにした（既存の成果物フォルダ・Worker の postTexts の仕組みをそのまま使うため、推しサーチ側の保存・API・DBは変更なし）。管理画面の生成履歴で、投稿前に手で直してからコピーできるようにする。

### 変更ファイル
- `src/app/admin/video-maker/VideoMakerClient.tsx` — 生成履歴の投稿文タブ: 読み取り専用だった入力欄を編集できるようにし（この画面の中だけ。保存はしない）、「コピー」は編集後の文章をコピー、「元に戻す」で自動生成の文章へ戻す。最初に表示するタブを、投稿文がある最初のタブにする（従来は「投稿文」固定で、無い場合は空欄に見えていた）。

### 設計上の判断・注意点
- DB・migration・Worker API（complete の postTexts）は変更なし。Instagram予約投稿の本文欄（job.postTexts.instagram を初期値にした編集欄）も従来どおり。
- 編集内容は保存しない（投稿文の正本は生成時の自動生成文。必要な人が都度直してコピーする運用）。

---

## Task 94：楽天商品の表示品質改善とクリック計測（Phase 1・未commit・Production未反映）

### 目的
楽天アフィリエイト商品の分類・重複・表示品質を改善し、楽天リンクのクリックを計測して今後の収益化の判断材料にする。VOD系アフィリエイト審査中のため、トップ／人物ページのセクション順・VOD広告リンク・配信ロゴ・CTA・サブスク診断・既存の楽天アフィリエイトURL・SEO（URL・metadata・構造化データ）は変更しない。

### 変更ファイル
- `src/lib/product-curation.ts`（新規・純粋関数）
  - `classifyProductForDisplay(title, adminCat, itemUrl)` — 取得元API（管理カテゴリ）＋商品名の明示的な語だけで「写真集・書籍 / CD / Blu-ray・DVD / グッズ / その他」を判定。根拠が無いものは推測せず「その他」（needsReview）。楽天ブックスCD・DVD検索は管理カテゴリをそのまま使用。書籍検索は書籍キーワードが無くても書籍（従来はグッズに落ちていた）、括弧外の品目がカレンダー・トレカ等の場合のみグッズ。楽天市場は「[Blu-ray]」等の括弧付き形式→グッズ品目名（「〜付き」「〜なし」は除外）→CD/Disc→書籍→「グッズ」の語→その他の順。CD・DVDカテゴリに手動登録された楽天市場ショップ出品は、商品名に形式が明示されていればそれに従う。
  - `isUsedListing` — グッズ等に混ざった【中古】出品を中古として扱う。
  - `isBulkResaleSet` / `demoteBulkResaleSets` — 【10枚セット】【100枚セット】「各25枚」「×100枚」等の業者向けまとめ買い出品（5枚以上）。削除せず一覧の末尾へ・ピックアップから除外。全形態セット・2冊セット・特典の「5枚セット」は対象外。
  - `dedupeProducts` — 同一ID・同一の商品ページ実URL（アフィリエイトURLは `pc` パラメータを展開）・同名出品（楽天市場の別ショップ）を先勝ちで1件に。楽天ブックスの同名は価格も一致する場合のみ重複扱い（別版の可能性）。初回盤A/B・通常盤・特典違いはタイトルが異なるため残る。
  - `stripPromoTags` — 表示用タイトルから確認できない宣伝タグ（【予約】【即納】【最安値】【送料無料】【新品】【最新】【オリコン加盟店】等、括弧外の「10％OFF」）を除去。【中古】・限定特典・形式は残す。DBの値は変更しない。
- `src/app/person/[slug]/page.tsx` — 旧 `BOOK_TITLE_KEYWORDS` / `classifyProduct` / `usedKeywords` を上記に置き換え。公開条件（verdict=related）・`applyDisplayOrder`／`sortUsedProducts`（並び替え・ティア）・データ取得は無変更。新品・中古それぞれ `dedupeProducts`、中古もセクション判定（従来はどのキーワードにも一致しない中古が表示から消えていた→中古タブに表示）。セクションに「その他」を追加。関連商品ピックアップには「その他」とまとめ買い出品を渡さない（`featuredSectionResults`）。JSXの並び・VOD・metadata・JSON-LDは無変更。
- `src/components/ProductTabList.tsx` — 「その他」タブ追加（0件なら非表示）。React key を新品/中古で区別。ProductCard に計測用 placement=`person_product_list`・position・表示カテゴリを渡す。
- `src/components/site/FeaturedProductsSection.tsx` — placement=`person_featured`・position・カテゴリを渡す。
- `src/components/ProductCard.tsx` — 表示タイトルに `stripPromoTags`。従来CTAボタンのみだったクリック計測を、画像・商品名・ボタンの各リンクに（1クリック=1リンクなので重複しない）。href/target/rel・見た目は無変更。
- `src/lib/rakuten-click-track.ts`（新規）— 楽天クリック計測の共通関数。既存の `/api/track`（type:'product'、Redis。トップ「人気商品」の集計元）と既存の GA4 `affiliate_click`（`sendGaEvent` 経由・本番ホストのみ）を再利用し、新しい送信先は作らない。GA4パラメータ: affiliate_name='rakuten', page_type, placement, position, link_element, person_name, product_id, product_category, item_name（100文字まで）。同じ商品・位置の1秒以内の連続クリックは1回だけ。`saveMeta:false` で人物が特定できないページから人物ページ由来のメタデータを空値で上書きしない。fetch は keepalive。
- `src/components/site/TrackedRakutenLink.tsx`（新規）— サーバーコンポーネントのページの楽天 `<a>` を置き換える薄いラッパー（属性はそのまま出力、onClickで計測のみ）。
- `src/app/page.tsx` — トップ「人気商品」（従来は計測なし）を TrackedRakutenLink に（placement=`home_popular_products`、外部リンクのときのみ計測）。表示タイトルに `stripPromoTags`。
- `src/components/site/PhotobookCard.tsx` / `PhotobookHomeSection.tsx` / `src/app/photobooks/page.tsx` — 既存の写真集カード計測を共通関数経由に（Redisへの送信内容は従来と同じ、GA4を追加）。placement=`home_photobooks_female|male` / `photobooks_list`。
- `src/app/groups/[groupSlug]/page.tsx` / `src/app/work/[workId]/page.tsx` — 楽天リンク（従来は計測なし）を TrackedRakutenLink に（`saveMeta:false`、クリック数のみ加算＋GA4）。
- テスト: `src/lib/__tests__/product-curation.test.ts`（21件・実データの代表的なタイトルで分類・重複・まとめ買い・宣伝タグ）、`rakuten-click-track.test.ts`（5件・送信内容・二重計測防止・本番ホスト以外でGA送信しない）、`tracked-rakuten-link.test.ts`（2件・置き換え前後で `<a>` の出力が同一）。

### 確認
- `tsc --noEmit`（src エラー0。`.next/types/* 2.ts` 等のmacOS複製ファイルによる既存エラーのみ）、`npm test` 104ファイル/1876件合格、`next build` 成功。lint はプロジェクトに ESLint 設定・スクリプトが無いため、一時設定（eslint-config-next core-web-vitals + typescript）で変更ファイルのみ確認しエラー0（警告は既存の未使用import・`<img>`）。
- `next start`（ローカル）× 390/1280px、計測送信（/api/track・GA）はブラウザ側で遮断して確認: トップ・人物6人（梅澤美波・松田里奈・成田凌・齊藤京子〔商品0件〕・阿部寛・佐藤勝利）で HTTP200・横スクロール0・「最安値」「予約受付中」表記0。人物ページの見出し・セクション順・VOD系リンク数は本番（oshi-search.jp）と全件一致。楽天リンクは全て target=_blank・rel に sponsored。CTAクリックで新規タブが楽天へ遷移し、計測は1回。グループ・写真集ページもクリックで遷移・計測1回（グループは saveMeta:false の送信内容）。
- トップ「人気検索・人気商品」はローカルに Redis 環境変数が無いため非表示（環境差）。リンクの出力が従来と同一であることは SSR テストで確認。

### 設計上の判断・注意点
- **既存のデータ課題（未修正・要判断）**：`src/lib/rakuten.ts` の `stableId('ic', itemUrl)` は楽天市場の itemUrl（アフィリエイトURL `hb.afl.rakuten.co.jp/hgc/<ID>/?pc=…`）のパス末尾から作られるため、**同じショップの別商品が同じ商品IDになる**（例: 梅澤美波の「予習DVD」と「3rd YEAR BIRTHDAY LIVE」が同ID）。verdict（AI/手動判定）も商品ID単位なので判定が共有されている。修正にはID生成変更と既存 verdict・並び順データの移行が必要なため今回は触れていない。表示側は従来どおりID重複を先勝ちで1件にする（判定されていない商品の露出を増やさないため）。
- 表示件数（人物ページの「関連商品 N件」・FAQ文中の件数）は重複除去・中古の追加表示で変わる（文言テンプレート・構造は無変更）。例: 梅澤美波 352→339、佐藤勝利 84→88、阿部寛 64→65。
- 管理画面の並び替え（savedOrder）は従来どおり優先。まとめ買い出品のみ各セクション末尾へ移す。
- 商品名の中の宣伝文句（括弧外の「最新コンサート会場販売」等）はショップの商品名として残している（タグ形式・割引率のみ除去）。
- GA4 で placement・link_element 等をレポートに使う場合は、GA4 管理画面でカスタムディメンション登録が必要。

---

## Task 94 追記：本番反映前の影響調査と最終検証（未commit・Production未反映）

### 1. 楽天市場の商品ID重複（既存不具合）の調査 — DB未変更
- **原因**：`src/lib/rakuten.ts` の `stableId('ic', Item.itemUrl)` が URL パス末尾の先頭24文字をIDにしている。楽天市場APIは affiliateId 指定時に itemUrl をアフィリエイトURL（`hb.afl.rakuten.co.jp/hgc/<ショップ単位の値>/?pc=実URL`）で返すため、**同じショップの商品はすべて同じID**になる。楽天ブックス系（bk/cd/dv）は itemUrl が `books.rakuten.co.jp/rb/<商品番号>/` なので影響なし。手動登録（mn-）も一意。
- **規模（本番DB読み取り専用の集計）**：楽天市場商品（グッズ・中古カテゴリ）6,165件に対し、人物内のID種類は5,908、全体では1,283種類しかない。同じ人物内で同じIDが別商品に付いている組が255組・510件（161人。すべてグッズ×中古の組）。その組に付いている判定：related 173 / deleted 43 / unrelated 18 / uncertain 3。1カテゴリ内の同一IDは0件（保存時の `mergeProductItems` が ID→Map で1件に潰すため）。
- **影響**：
  - 保存時：同じショップ・同じカテゴリの商品は1件しか残らない（取得のたびに後から来た商品で上書きされ、title・URL・価格が入れ替わることがある）。**同一ショップの初回盤A/B・通常盤・特典違いは区別されない**（楽天ブックスの商品は区別される）。
  - 判定（verdicts）：ID単位のため、別商品と判定を共有する。上書きで中身が入れ替わった商品は、前の商品の判定のまま公開される可能性がある。
  - クリック計測：Redis `product:click:{ID}`・`product:meta:{ID}` は人物をまたいだグローバルキーのため、同じショップの全商品のクリックが合算され、メタデータは最後にクリックされた商品で上書きされる（トップ「人気商品」の精度に影響）。GA4 は item_name・placement を送るため区別できる。
  - 並び替え（product_display_order）：保存行は現在1行のみで影響は小さい。
- **表示側の対応（今回）**：Phase 1 の重複除去が「IDが同じ別商品」をまとめないよう、`dedupeProducts` を「実URLが取れる場合はURL、取れない場合のみID」で同一判定するよう修正（従来の人物ページでも表示されていた組み合わせは引き続き両方表示）。React key に位置を含めた。
- **修正案（未実行）**：
  1. `stableId` を楽天市場だけ `pc` の実URL（`item.rakuten.co.jp/<shop>/<itemCode>/`）から作る新方式 `ic2-<shop>-<itemCode>` に変更（新規取得分から）。集計では実URLの無い楽天市場商品は0件、新方式で人物内6,163種類に分かれる。`product-store.ts` の `normalizeItemUrl` も `pc` を展開する。
  2. dry-run スクリプト（書き込みなし）：products の ic- 商品ごとに新IDを計算し、旧ID→新IDの対応表、旧IDが複数の新IDに分かれるもの（255組）、verdict・並び順への影響件数をCSVで出力。
  3. 本番DBのバックアップ（Neon のブランチ作成）を取ってから移行スクリプトを実行：products.items の id を新IDへ書き換え。verdicts は**旧行を残したまま**新IDの行を追加（旧IDが1商品にだけ対応するものは判定をコピー、複数に分かれたものはコピーせず未判定にしてAI判定に回す）。product_display_order の ID も置換。Redis のクリック数は移行しない（新ID分から計測。旧キーは残す）。
  4. 移行後に楽天再取得を行うと、これまで1件に潰れていた同一ショップの商品が新規として入るため、AI判定の件数（OpenAI費用）が増える点に注意。
  5. 確認後、旧ID行の削除は別途判断。

### 2. TypeScript エラー（.next/types）
- **原因**：プロジェクトが `~/Desktop` にあり、iCloud Drive の「デスクトップ」同期が有効（`FXICloudDriveDesktop=1`）。ビルド中のファイル置換が同期と競合し、`routes.d 4.ts`・`validator 5.ts` 等の複製が作られる（10/9 作成分は今回の作業前から存在）。tsconfig の include `.next/types/**/*.ts` に複製も含まれるため重複定義エラーになっていた。**今回の変更とは無関係**（HEAD 状態でも複製を除けば tsc 0件）。
- **対応**：`.next/types` の複製6ファイルを scratchpad に退避（削除ではない）→ `next typegen` で再生成 → `tsc --noEmit` 0件。`.next` 直下にも同種の複製が約520個、`.git` 内にも `index 10` 等の複製があり、今後も再発しうる（後述）。

### 3. 最終検証（変更前 HEAD と変更後を同条件で比較）
- 条件：ローカル専用の Upstash 互換モック（メモリ内・本番Redisに接続しない。トップ「人気商品」用にテスト用のクリック数・メタデータを投入）＋本番DBは読み取りのみ。`git stash -u` で HEAD をビルド・取得 → 復元して変更後をビルド・取得。/api/track・GA・楽天への通信はブラウザ側で遮断。
- 対象：トップ、人物（目黒蓮・齋藤京子・齊藤京子〔いずれも商品0件〕・梅澤美波・佐藤勝利・成田凌・阿部寛）、/photobooks、/groups/nogizaka46、作品ページ12件、/oshi-vod、robots.txt、sitemap.xml。
- 結果：商品以外（title・description・canonical・robots・OG・JSON-LD（FAQの件数を除く）・見出し・セクション順・楽天以外の全リンク〔VOD・診断導線を含む〕）は全ページ同一。sitemap 同一。写真集・グループ・作品ページの楽天リンクは同一。トップ「人気商品」のリンク先は同一（表示名から宣伝タグのみ除去）。横スクロール0、コンソールエラー0。
- 商品の除外：目黒蓮 157→157（除外0）。梅澤美波は別ショップの同名出品・同一URLの重複のみ除外（実URL同一の商品で確認）。佐藤勝利 +8・阿部寛 +1 は従来どのキーワードにも一致せず非表示だった中古（関連判定済み）。
- 途中で見つけて修正：楽天ブックスの「同名・同価格」重複扱いで、目黒蓮の「月の満ち欠け」先着特典（商品番号 17447015 と 17514703）が1件にまとめられていた → 楽天ブックスは商品番号（URL）が同じ場合のみ重複とするよう変更。タイトルでの重複判定は楽天市場の一般ショップ出品どうしに限定。

### 4. クリック計測
- 本番ホスト扱い（ブラウザ内で oshi-search.jp をローカルへ向け、Google への通信は遮断し dataLayer で確認）で、人物（画像・商品名・ボタン・ピックアップ）・トップ人気商品・トップ写真集・写真集一覧・グループ・作品の9か所をクリック → いずれも /api/track 1回・GA4 affiliate_click 1回、新規タブで楽天へ遷移。ダブルクリックも各1回。VODリンクのクリックでは楽天の計測は発生しない。

### 確認
- `next build` 成功、`tsc --noEmit` 0件、`npm test` 104ファイル/1878件合格、変更ファイルの ESLint エラー0（警告5件は既存の未使用import等。既存テストファイルには以前からの lint エラーあり）。

---

## Task 94 追記2：本番反映前の最終確認（未commit・Production未反映）

- **反映範囲の確認**：`HEAD` = `origin/main` = 現在の本番デプロイ（b9dee43、oshi-search.jp のエイリアス先、10/15 21:11 作成）。未pushコミット・stash なし。未コミットの変更は Phase 1 の11ファイル（変更）＋6ファイル（新規）だけ。差分の各行も Phase 1 関連のみで、動画生成・Instagram・VOD 関連の変更は含まれない。開発ログの差分は Task 94 の追記だけ（既存行の削除・変更なし）。
- **Vercel Preview**：git 管理ファイル＋Phase 1 の新規ファイルだけを scratchpad にコピーし（`.git`・`node_modules`・`.next`・`.env*` を除く、686ファイル）、`vercel deploy`（`--prod` なし）を実行しようとしたが、Claude Code の権限設定でブロックされたため未実施。commit・push は不要な方式。
- **GA4（スマホ幅 390px）**：本番ホスト扱いで再確認し、人物（画像・商品名・ボタン・ピックアップ）・トップ写真集・写真集一覧・グループ・作品の各クリックで /api/track 1回・GA4 affiliate_click 1回、ダブルクリックも1回、VODリンクでは発生しない（PC幅は前回確認済み）。

---

## Task 95（予定・未実施）：楽天市場の商品ID重複の修正と DB 移行計画

> 本番DBの変更を伴うため、ユーザーの許可が出るまで実行しない。調査結果は Task 94 追記（本番DBの読み取り集計）を参照。

### 原因
- `src/lib/rakuten.ts` の `stableId(prefix, itemUrl)` は、URL パス末尾の先頭24文字を ID にする。
- 楽天市場API（`fetchIchiba`＝グッズ、`fetchUsed`＝中古）は affiliateId 付きで呼ぶため、`itemUrl` がアフィリエイトURL `https://hb.afl.rakuten.co.jp/hgc/<ショップ単位の値>/?pc=<実URL>` で返る。パス末尾はショップごとに同じ値のため、**同じショップの全商品が同じ `ic-…` ID**になる。
- 楽天ブックス系（bk-/cd-/dv-。itemUrl が `books.rakuten.co.jp/rb/<商品番号>/`）と手動登録（mn-）は影響なし。
- 保存処理 `mergeProductItems`（`src/lib/product-store.ts`）は ID→Map で重複を除くため、同じショップ・同じカテゴリの商品は1件しか残らない。2つ目の判定キーである `normalizeItemUrl` もアフィリエイトURLのホスト＋パス（ショップ単位）で比較しているため、同様に衝突する。

### 規模（2026-10-16 読み取り集計）
- 楽天市場商品：6,165件（グッズ 3,307 / 中古 2,858）。旧IDの種類は人物内で5,908、全体で1,283。実URL（`pc`）が取れない商品は0件。実URLで数えると人物内6,163種類。
- 同じ人物内で同じIDが別商品に付いている組：255組・510件（161人。すべてグッズ×中古の組）。付いている判定：related 173 / deleted 43 / unrelated 18 / uncertain 3。
- `ic-` ID の verdicts：5,497行。`product_display_order`：1行。

### 修正対象
1. `src/lib/rakuten.ts`：楽天市場の ID を、実URL `item.rakuten.co.jp/<shop>/<itemCode>/` から作る新方式 `ic2-<shop>-<itemCode>` にする（`fetchIchiba`・`fetchUsed` の2か所）。楽天ブックス系・手動登録は変更しない。プレフィックスを変えるため、旧IDと新IDが混ざっても衝突しない。
2. `src/lib/product-store.ts`：`normalizeItemUrl` を、アフィリエイトURLの場合は `pc` の実URLで比較するようにする（`src/lib/product-curation.ts` の `resolveProductPageUrl` と同じ考え方。共通化を検討）。
3. 移行対象のデータ：
   - Neon `products.items[].id`（グッズ・中古カテゴリの ic- 商品）
   - Neon `verdicts`（person_name, product_id）
   - Neon `product_display_order.order_ids`
   - `photobook_settings` は写真集カテゴリ（bk-/mn-）のみのため対象外の見込み（dry-run で 0件を確認する）
   - Redis `product:click:{id}` / `product:meta:{id}` / `person:productClicks:{slug}` は移行しない（旧キーは残し、新IDで計測を始める。旧IDの値は同じショップの商品が合算されていて分けられないため）
4. 関連する管理画面API（商品削除・判定一括・不確実一覧・復旧・AI判定）は ID 文字列を扱うだけなので、コード変更は不要の見込み。dry-run 後に、旧ID・新ID混在での動作をテストで確認する。

### 移行手順
1. **コード修正とテスト**（DB変更なし）：新しい ID 関数の単体テスト（同じショップの別商品で別ID・同じ商品で同じID・`pc` 無しのフォールバック）、`mergeProductItems` で同じショップの別商品が潰れないテスト。
2. **dry-run スクリプト**（`scripts/` 配下、SELECT のみ）：ic- 商品ごとに新IDを計算し、CSV を出力する。
   - 旧ID→新IDの対応（人物・カテゴリ・タイトル・実URL）
   - 旧IDが1つの新IDに対応するもの / 複数に分かれるもの（255組の見込み）
   - 影響を受ける verdicts・product_display_order・photobook_settings の件数
3. **バックアップ**（後述）を取得し、復元できることを確認する。
4. **移行スクリプト**（`--apply` を付けたときだけ書き込む。人物単位でトランザクション、途中失敗時は再実行可能＝冪等）：
   - `products.items` の ic- 商品の `id` を新IDへ書き換える（他のフィールドは変更しない）。
   - verdicts：**旧IDの行は残したまま**、新IDの行を追加する。
     - 旧IDが新ID1つにだけ対応する場合：verdict・score・source・reason をコピーし、reason に移行元を記録する。
     - 旧IDが複数の新IDに分かれる場合（別商品が判定を共有していたもの）：どの商品に対する判定か判断できないため**コピーしない**（未判定としてAI判定に回す）。管理画面で確認できるよう、対象をCSVに残す。
   - `product_display_order.order_ids` の旧IDを新IDへ置換する（分かれるものは先頭の1件）。
5. **コード反映**：新IDでの取得・保存を有効にする（移行前にコードだけ反映すると、旧IDの商品と新IDの商品が二重になるため、移行の直後に反映する）。
6. **確認**：人物ページの表示件数・ピックアップ・管理画面（product-check）を移行前のスナップショットと比較する。
7. 楽天再取得を行うと、これまで1件に潰れていた同じショップの商品が新規（未判定）として入る → AI判定（OpenAI）の件数と費用が増えるため、対象人物を絞って段階的に行う。
8. 旧ID の verdicts 行の削除は、一定期間問題がないことを確認してから別途判断する（今回の計画では削除しない）。

### バックアップ方法
- **Neon のブランチ**（移行直前の時点の本番DBを丸ごと複製。復元はブランチからの restore、または接続先の切り替えで可能）。作成後、ブランチ側で products・verdicts・product_display_order の件数が本番と一致することを確認する。
- 追加で、対象3テーブルの該当行を JSON でエクスポート（`products` は グッズ・中古カテゴリ、`verdicts` は `product_id LIKE 'ic-%'`、`product_display_order` 全行）し、ローカル（commit対象外）に保存する。
- Redis は移行で書き換えないため不要。念のため、既存の `/admin/redis-backup` でバックアップを取ってもよい。

### 既存の商品判定データへの影響
- 旧IDが新ID1つに対応する判定（大半）：そのまま新IDに引き継ぐため、公開状態は変わらない。
- 別商品が判定を共有していたもの（255組・510件の見込み）：新IDでは未判定になり、AI判定が終わるまで公開ページに出ない（現在 related として表示されている組の一部が、一時的に非表示になる）。
- 手動で付けた判定（source が手動のもの）も同じ規則で扱う。分かれるものは手動で付け直す必要がある（dry-run CSV で件数を確認）。
- 旧ID の判定行は残すため、移行を取り消す場合は products の ID を戻すだけで元の状態に戻せる。
- 公開ページの重複除去（`dedupeProducts`）は実URLで同一判定しているため、移行の前後どちらでも正しく動く。

---

## Task 94 追記3：Phase 1 本番反映（2026-10-16）

- **反映**：commit `d6b61bb`（Phase 1 の17ファイルのみ）を main に push → Vercel 自動デプロイ `dpl_FboY7fWaf99stgGRfWPWbvT72jtn`（Ready、oshi-search.jp、githubCommitSha=d6b61bb）。
- **反映前の本番（ロールバック先）**：`dpl_FyKpKRNMpxfyHA9An7AHF3Ek39Y7`（commit `b9dee43`）。戻す場合は `vercel rollback dpl_FyKpKRNMpxfyHA9An7AHF3Ek39Y7`（DB変更なしのため即時に戻せる）またはコミットの revert。
- **公開後の確認（本番。/api/track はブラウザで止め、GA4の送信は内容を確認したうえで遮断、楽天への移動は移動先URLの確認のみ）**：
  - トップ・人物（梅澤美波・松田里奈・成田凌・齊藤京子・阿部寛・佐藤勝利）× 390/1280px：見出し・セクション順・VOD系リンク数が反映前の本番と同一、HTTP200、横スクロール0、コンソールエラー0。楽天リンクは全て target=_blank・rel=sponsored。
  - 目黒蓮・梅澤美波・佐藤勝利・成田凌・阿部寛・齋藤京子・齊藤京子・写真集一覧・グループ・作品・/oshi-vod・robots.txt：ローカルで検証したビルドと商品カード・タブ件数・metadata・楽天以外のリンクが一致。作品ページの JSON-LD の genre は本番のみ出力されるが、TMDb APIキーの有無（ローカルに無い）による環境差で、今回の変更とは無関係。
  - 商品画像：トップ人気商品15・目黒蓮40・写真集一覧24件すべて読み込み成功（390/1280px）。
  - クリック計測：人物（ボタン・画像・ピックアップ）・トップ人気商品・写真集一覧・グループ・作品の7か所 × 390/1280px で、本番の gtag.js が作る GA4 `affiliate_click` のリクエストが1クリックにつき1件（affiliate_name=rakuten・placement・position・link_element・product_id・product_category・item_name）、/api/track も1件。新規タブの移動先はリンクのアフィリエイトURLどおり。
- **未確認**：GA4 管理画面（リアルタイム・DebugView）での受信は、本番プロパティへの送信を遮断して検証したため未確認。

---

## Task 96：楽天アフィリエイト設定の最終確認と、推しアド専用ページ「はじめての応援広告ガイド」（/support-ads）（未commit・Production未反映）

### ① 楽天アフィリエイト設定の確認（コード変更なし・本番DBは読み取りのみ）
- `src/lib/rakuten.ts` の楽天API呼び出し5か所（楽天ブックス書籍・DVD・CD、楽天市場・中古）と `src/app/api/admin/rakuten-search/route.ts` の4か所は、すべて `affiliateId: RAKUTEN_AFFILIATE_ID` を付けて呼び、APIが返す `affiliateUrl` を保存（空の場合だけ itemUrl）。公開ページのカード（ProductCard・PhotobookCard・グループ・作品・トップ人気商品）は `affiliateUrl || itemUrl` をそのままリンクにしている。
- 本番DB集計（2026-10-16）：API経由の商品 83,290件はすべて `hb.afl.rakuten.co.jp/hgc/…` のアフィリエイトURL。楽天ブックスのCD・DVD検索は `http://` で返る（リンクとしては有効）。アフィリエイトURL内の識別部分（hgc の2・4番目のセグメント）は全件同じ形式で、1つのアカウント由来とみられる（IDは非表示）。`RAKUTEN_AFFILIATE_ID` はローカルの `.env.local` に無く Vercel のみに設定されているため、IDの値そのものの照合はしていない（ウェブサービス用の表記とリンク内の表記は異なるため、文字列一致では判定しない）。
- **要対応（既存データ）**：管理画面の手動追加（`/api/admin/product-manual`）は入力URLをそのまま `affiliateUrl` に保存するため、手動商品のうち **141件が通常の `books.rakuten.co.jp` URL（成果が付かない）**で、いずれも公開中（related）。29件は楽天の短縮アフィリエイトURL（`a.r10.to`。発行アカウントは未確認）。今回は既存の楽天商品ページを変更しない方針のため未修正。対応案：手動追加時に楽天アフィリエイトURLへ変換する／既存141件を管理画面でアフィリエイトURLに差し替える。

### ② 推しアド専用ページ
- URL：`/support-ads`（既存ルートと重複なし）。ページ名「はじめての応援広告ガイド」。DB・外部APIを使わない静的ページ（build で ○ Static）。
- 内容：応援広告とは／よく使われる場面／駅ポスター・駅サイネージ（デジタルサイネージ）・屋外ビジョン（街頭ビジョン）の違いと費用の目安／一人と団体（実行委員会・クラファン）の違い／希望日・予算・地域からの選び方／事務所の許可と必要書類／申込から掲載までの流れ／FAQ 6問／推しアドの広告枠。
- 事実は推しアド公式（トップ・使い方ガイド・FAQ・費用ガイド〔2026/07/30更新〕・個人で出す方法〔2026/10/08更新〕・出し方ガイド〔2026/10/08更新〕）で確認できた内容だけを使用し、文章は独自に要約。料金は費用ガイドの「目安」（7日間、税込/税抜の記載なし、媒体・時期・空き状況で変動）として出典日つきで表示。許諾確認代行（税抜5,000円＋消費税・サービス料、最短1週間）、駅ポスターは2名以上の団体名義が必要、提出物（駅ポスター4点・デジタル2点）、提出期限、申込前の空き枠確認不可、枠取り後の変更不可、未成年対象の掲載不可。公式サイトへの通常リンク・LINE相談リンクは置かない（成果対象外の経路へ誘導しないため）。
- SEO：title・description・canonical（https://oshi-search.jp/support-ads）・OG（article）、JSON-LD は BreadcrumbList・WebPage・FAQPage、index 対象。`src/app/sitemap.ts` に1件追加（既存エントリは無変更）。トップ・人物ページ・フッターからの導線は追加していない。
- デザイン：C案（GraphicPageStyles＋ページ専用 `support-ads.css`、`.sa-*` にスコープ）。スマホ優先、芸能人写真なし、推しアドのロゴ・配色は使わない。ページ上部と広告枠に「PR／広告（アフィリエイトリンク）」「推しサーチは運営元ではない」を明示。

### ③ アフィリエイトリンク
- 既存の承認済み AccessTrade リンクコード（人物ページの #推しアド バナー、300×250、rk は非表示）を `src/components/affiliate/oshi-ad-link.ts` に移し（文字列は完全一致をテストで固定）、人物ページの `OshiAdBanner` と新ページの `SupportAdsCta` の両方から使う。リンクコードの改変・公式URLへの置き換えなし。表示は既存と同じ `NEXT_PUBLIC_OSHI_AD_ENABLED=true` のときだけ。
- 計測：既存の GA4 `affiliate_click`（affiliate_name=oshi_ad、sendGaEvent 経由）を再利用し、page_type=`support_ads`・placement=`support_ads_bottom`。1秒以内の連続クリックは1回だけ送る。
- **未確認**：AccessTrade 管理画面の最新の成果条件と、このリンクコードの遷移先（Web申込ページか、LINE相談か）。クリックURLへアクセスするとクリックが計上されるため、遷移先の実地確認はしていない。

### 変更ファイル
- 新規：`src/app/support-ads/page.tsx`、`src/app/support-ads/support-ads.css`、`src/components/affiliate/SupportAdsCta.tsx`、`src/components/affiliate/oshi-ad-link.ts`、`src/lib/support-ads/content.ts`、`src/lib/__tests__/support-ads.test.ts`
- 変更：`src/components/affiliate/OshiAdBanner.tsx`（リンクコード定数を共通ファイルから読み込むだけ。描画・計測は無変更）、`src/app/sitemap.ts`（/support-ads を追加）

### 確認
- `tsc --noEmit` 0件、`npm test` 105ファイル/1885件合格、ESLint（変更ファイル）エラー0、`next build` 成功（`NEXT_PUBLIC_OSHI_AD_ENABLED=true`）。
- 新ページ（`next start`、360/390/1280px）：HTTP200、横スクロール0、コンソールエラー0、metadata・canonical・OG・JSON-LD 3種、広告枠のリンクコードが既存と完全一致、広告表記2か所。AccessTrade への通信はすべて遮断（計測画像はダミー画像で代替）し、クリック・表示回数を計上していない。本番ホスト扱いで、バナーのクリック1回・ダブルクリックとも affiliate_click が1件。人物ページの既存バナーは従来どおり（パラメータ同一。ダブルクリックでは2件になる既存挙動は変更していない）。
- 既存ページ：人物（目黒蓮・梅澤美波・佐藤勝利・成田凌・阿部寛・齋藤京子・齊藤京子）・写真集・グループ・作品・/oshi-vod・robots.txt を本番と比較し、metadata・JSON-LD・見出し・セクション順・リンクが同一（トップの人気検索/人気商品はローカルに Redis が無いための差、作品ページの JSON-LD の genre は TMDb キーの有無による差）。sitemap は /support-ads の追加のみ（ほか作品3件の差は本番 sitemap のキャッシュ時点の違い）。

---

## Task 96 追記：本番公開前の最終確認と軽微修正（未commit・Production未反映）

### 推しアドの広告リンク
- リンクコードは AccessTrade 標準形式（クリック `h.accesstrade.net/sp/cc?rk=…`・表示計測 `…/sp/rr?rk=…`、同じ rk、https、rel=nofollow）で、承認済みの人物ページ用バナーと完全一致。
- **未確認**：AccessTrade 管理画面の最新成果条件、クリック後の遷移先（Web申込ページか LINE 相談か）。公開情報（推しアド公式・Web検索）には記載がなく、クリックURLにアクセスするとクリックが計上されるため実地確認はしていない。
- **軽微修正**：成果対象外になりうる導線を確認なしで新設しないため、/support-ads の広告枠を `NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED='true'`（かつ従来の `NEXT_PUBLIC_OSHI_AD_ENABLED='true'`）のときだけ表示するよう変更（`isSupportAdsCtaEnabled()`、`src/components/affiliate/oshi-ad-link.ts`）。Vercel には未設定のため、このまま公開すると新ページには広告枠・広告表記・AccessTrade への通信が出ない。管理画面で確認後、Production に `NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED=true` を設定して再デプロイすると表示される（NEXT_PUBLIC_ はビルド時に埋め込まれるため再デプロイが必要）。FAQ「推しサーチと推しアドの関係」は広告枠の有無どちらでも正しい文に修正。
- 人物ページの既存バナーは無変更（ダブルクリックで affiliate_click が2件になる既存挙動も変更していない）。

### 公式情報との再照合（2026-10-16、FAQ・費用ガイド・出し方ガイド）
- 料金の目安（B1 4万〜8万円・B0 8万〜15万円〔7日間〕、駅デジタルサイネージ 5万〜50万円・大型ビジョン/特殊枠 30万円〜〔7日間〜〕、クラファン1口500円〜、変動・税区分記載なし・印刷費別途）、許諾代行 税抜5,000円＋消費税・サービス料・最短1週間、準備期間（駅ポスター3〜4か月前・デジタルサイネージ2か月前・最短2日程度）、2名以上の団体名義、許可とスクリーンショット提出、提出物（4点・2点）、提出期限、空き枠確認不可、枠取り後変更不可、未成年不可、媒体社審査：すべて一致。
- 表現の修正2点：「3日以内」は銀行振込の場合の推奨であることを明記、「個人で申し込める枠」の例を公式どおり「デジタルサイネージなど」に変更。

### 確認
- 本番相当（`NEXT_PUBLIC_OSHI_AD_ENABLED=true` のみ）で 360/430/390/768/1280px：横スクロール0・はみ出し0・文字切れ0（FAQ全開）・コンソールエラー0・広告枠/AccessTrade通信なし。広告枠を有効にしたビルドでも、リンクコード完全一致・PR表記2か所・クリック/ダブルクリックとも affiliate_click 1件。
- 既存ページ（人物7・写真集・グループ・作品・/oshi-vod・robots.txt）は本番と同一（トップは Redis、作品の JSON-LD genre は TMDb キーの環境差）。`tsc` 0件、`npm test` 105ファイル/1886件合格、ESLint エラー0。

---

## Task 97（予定・未実施）：手動登録の楽天商品でアフィリエイトURLが付いていないものの修正案

### 件数（2026-10-16 本番DB読み取り集計）
- アフィリエイトURL（hb.afl.rakuten.co.jp）でない商品は全体で **170件**（すべて手動登録 mn-、29人分、URLの種類81）。依頼文の「514件」に該当する集計は見つからなかった。
  - 通常の楽天ブックスURL（`http://books.rakuten.co.jp/rb/<商品番号>/`）：141件（商品番号71種類。写真集90・CD71の一部ほか）。すべて公開中（related）。
  - 楽天の短縮リンク（`a.r10.to`）：29件。楽天アフィリエイトの短縮URLだが、どのアカウントで発行されたかは未確認（アクセスするとクリックが計上されるため未確認のまま）。
- 原因：`/api/admin/product-manual` が入力URLをそのまま `itemUrl`・`affiliateUrl` に保存する。

### 正しいリンクの作り方
- 楽天APIに affiliateId を付けて呼ぶと、楽天ブックス商品は `https://hb.afl.rakuten.co.jp/hgc/<アフィリエイト識別子>/?pc=<URLエンコードした https://books.rakuten.co.jp/rb/<商品番号>/>` を返す（本番DBの楽天ブックス向けURL 77,092件がすべてこの形式・識別子1種類）。
- 141件のうち **130件（商品番号65種類）は、同じ商品番号の API 発行済みアフィリエイトURLが DB 内に既にある**（タイトル一致130/130、pc の商品番号一致130/130）。これをそのまま使うのが最も安全（新たに生成しない）。
- 残り **11件（3商品：日経エンタテインメント! 櫻坂46 Special 2026、SWITCH Vol.43 No.10、FRUITS ZIPPER 4th Anniversary写真集）**は、楽天ブックスAPI（affiliateId 付き）で ISBN/JAN またはタイトル検索して API の affiliateUrl を取得する（3回程度の呼び出し）。API に出ない場合は手動対応。
- a.r10.to の29件は、楽天アフィリエイト管理画面のリンク作成履歴で発行元を確認するか、同じ商品の API URL に置き換えるかをユーザー判断。

### 修正方針（実行はユーザーの許可後）
1. dry-run（作成済み・読み取りのみ）：修正前後の対応表 CSV（人物・カテゴリ・商品ID・判定・現URL・提案URL・出典の商品ID・タイトル一致）を出力。
2. Neon のブランチでバックアップ後、`products.items[].affiliateUrl` **だけ**を提案URLに更新する。`id`・`itemUrl`（元の商品URL・商品番号を保持）・verdicts（AI判定）は変更しない。公開カードは `affiliateUrl || itemUrl` なので、更新後はアフィリエイトURLで同じ商品ページ（pc の商品番号一致）へ遷移する。
3. 更新後、対象29人の人物ページで該当カードの href が hb.afl に変わり、pc が元の商品番号と一致することを確認（リンク先へのアクセスはしない）。
4. 再発防止：`/api/admin/product-manual` で楽天ブックス/楽天市場の通常URLが入力された場合、API で affiliateUrl を取得して保存する（取得できなければ警告）。

---

## Task 96 追記2：広告CTAの有効化準備（未commit・Production未反映）

- ユーザーが既存バナー（AccessTrade 承認済みコード）を実際にクリックして遷移先を確認：推しアド公式トップ（app.oshi-ad.com、atnct パラメータ付き）。公式トップに「掲載枠を探す」の導線があり、Web申込・クレジットカード決済に対応。
- CTA文言を遷移先に合わせて変更：見出し「公式サイトで掲載枠を探す」、本文「バナーを押すと推しアドの公式サイト（トップページ）が開きます。『掲載枠を探す』から…Webで申し込めます（支払いはクレジットカードまたは銀行振込）」、上部の案内リンク「公式サイトで掲載枠を探す ↓」。広告コードは無変更（完全一致テストあり）、公式URL・/ads への直リンクは置かない。
- 表示条件は `NEXT_PUBLIC_OSHI_AD_ENABLED=true` かつ `NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED=true`。参照箇所は `src/components/affiliate/oshi-ad-link.ts`（isSupportAdsCtaEnabled）と `src/app/support-ads/page.tsx` のみで、他ページには影響しない。/support-ads は静的ページ（○）のため、値はビルド時に HTML へ埋め込まれる（両方 true でビルドすると prerender HTML に広告枠・リンクコード・PR表記が入ることを確認、未設定なら入らないことも確認済み）。
- 確認：両方 true のビルドで 360/390/430/768/1280px 横スクロール・はみ出し・文字切れ0、コンソールエラー0、リンクコード完全一致、PR表記2か所、JSON-LD 3種・canonical、affiliate_click はクリック・ダブルクリックとも1件（人物ページの既存バナーは従来どおり）。既存ページは本番と同一（トップ＝Redis、作品 JSON-LD genre＝TMDb キーの環境差のみ）。tsc 0件、npm test 105ファイル/1886件、ESLint エラー0。

### 本番公開手順（ユーザー許可後に実施）
1. Vercel 環境変数を追加：`NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED=true` を **Production のみ**（Preview・Development には追加しない）。push より前に設定する（ビルド時に埋め込まれるため）。
2. Phase 2 のファイルだけを commit：`src/app/support-ads/page.tsx`・`src/app/support-ads/support-ads.css`・`src/components/affiliate/SupportAdsCta.tsx`・`src/components/affiliate/oshi-ad-link.ts`・`src/components/affiliate/OshiAdBanner.tsx`・`src/lib/support-ads/content.ts`・`src/lib/__tests__/support-ads.test.ts`・`src/app/sitemap.ts`・`docs/development-log.md` → main へ push → Vercel 自動デプロイ。
3. 公開後確認：デプロイの commit SHA、/support-ads の表示（スマホ・PC）・広告枠・PR表記・リンクコード、GA4 affiliate_click 1件（送信内容のみ確認）、sitemap に /support-ads、既存ページ（トップ・人物・/oshi-vod）が変わっていないこと。
- ロールバック：`vercel rollback dpl_FboY7fWaf99stgGRfWPWbvT72jtn`（Phase 1 公開時のデプロイ。DB変更なしのため即時）。広告枠だけ止める場合は Production の `NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED` を削除して再デプロイ。

---

## Task 98：応援広告ガイド（/support-ads）への内部リンク追加（未commit・Production未反映）

### 目的
VODアフィリエイト審査に影響を与えずに、既存の利用者が応援広告ガイドを見つけられるようにする。

### 変更ファイル
- `src/components/affiliate/OshiAdBanner.tsx` — 既存の広告カード（AccessTrade のリンクコード・計測 onClick・装飾・文言）は1行も変えず、外側に `<div>` を1つ追加し、カードの直下に `next/link` のテキストリンク「初めての応援広告｜費用・始め方を見る →」（/support-ads、`theme-text-link`、タップ領域44px）を追加。リンクは計測用 onClick を持つ creative の外にあるため affiliate_click は送られず、通常のサイト内遷移になる。広告が非表示（環境変数未設定・画像読込失敗）のときはリンクも一緒に非表示。
- `src/app/layout.tsx` — フッターナビの先頭に「応援広告の費用・始め方」（/support-ads）を追加。

### 確認
- 本番相当のビルド（`NEXT_PUBLIC_OSHI_AD_ENABLED=true`・`NEXT_PUBLIC_SUPPORT_ADS_CTA_ENABLED=true`）で、人物ページの広告カードの outerHTML が本番と完全一致（目黒蓮）。360/390/430/768/1280px：リンクはカードの12px下、横スクロール0・はみ出し0、エラー0。本文の並び順（今すぐ見られる作品 → 推しアド → 配信中の出演作品 → …）は従来どおり（推しアドの下にリンク1行分＝約56pxが増える）。
- ガイドリンクをクリック → /support-ads へクライアント遷移（ページ再読込なし）、affiliate_click 0件・/api/track の商品クリック0件・AccessTrade への遷移なし。フッターのリンクはトップ・/oshi-vod・/photobooks から /support-ads へ遷移。
- 推しアドバナー自体のクリック計測は従来どおり（人物ページ：affiliate_name=oshi_ad・page_type=person・placement=after_watch_now、1クリック1件）。
- 本番との比較：人物7・写真集・グループ・作品12・/oshi-vod で metadata・JSON-LD・見出し・セクション順が同一、リンクの差は /support-ads の追加のみ（トップは Redis、作品の JSON-LD genre は TMDb キーの環境差）。`tsc` 0件、`npm test` 105ファイル/1886件合格、ESLint エラー0（警告1件は既存の eslint-disable コメント）、`next build` 成功。

---

## Task 97 追記：手動登録の楽天商品 affiliateUrl 修正の準備（スクリプト作成・dry-run のみ。本番DB未変更・未commit）

### 再集計（2026-10-16、本番DB読み取りのみ）
- アフィリエイトURLでない商品は 170 件（全商品中。すべて手動登録 mn-）：楽天ブックス通常URL 141 件 / 短縮URL（a.r10.to）29 件。前回から変化なし。

### 判定結果（`scripts/manual-affiliate-url-fix/run.ts` の dry-run）
- **変更予定 130 件**（products 6 行：音嶋莉沙 CD 59・本・雑誌 3、野口衣織 写真集 30、髙松瞳 写真集 30、谷口愛季 CD 4、遠藤理子 CD 4／商品番号 68 種類）。同じ商品番号について楽天API（手動登録以外の bk-/cd-/dv- 商品）が発行済みのアフィリエイトURLを流用。130 件すべてで、流用元の遷移先（pc）の商品番号＝元の itemUrl の商品番号、遷移先はどちらも楽天ブックス（books.rakuten.co.jp）、商品名一致、URLの識別部分は楽天ブックス向けの共通値（DB全体の 77,158 件で1種類）と一致。※前回報告の「商品番号65種類」は誤りで、正しくは 68 種類。
- **変更しない 40 件**：
  - no_source 11 件（3商品：FRUITS ZIPPER 4th Anniversary写真集〔7人〕、日経エンタテインメント! 櫻坂46 Special 2026〔2人〕、SWITCH Vol.43 No.10〔2人〕）— DB内に同じ商品番号のアフィリエイトURLが無い（楽天市場の楽天ブックス店の商品にも無い）。URLを組み立てることはしない。
  - skip_unverified 29 件（a.r10.to）— 楽天公式の短縮URLかどうか・発行アカウントを公開情報で確認できないため、展開・変換しない。
- ambiguous_source・title_mismatch・invalid_source・duplicate_id_in_row は 0 件。

### スクリプト（`scripts/manual-affiliate-url-fix/`：plan.ts・plan.test.ts・run.ts）
- Prime Video チャンネル修正（Task 89）と同じ構成。デフォルト dry-run。apply は `--apply --expect <変更予定件数>` が一致し、異常判定が0件のときだけ。1トランザクションで、各 products 行は「読み込んだ時点の items と完全一致」の場合だけ更新（1行でも食い違えば全体ロールバック）。
- 変更するのは該当要素の affiliateUrl だけ（商品ID・itemUrl・商品名・価格・他フィールド・要素数・並び順・verdicts は変更しない。plan.ts で affiliateUrl 以外の差分があれば例外）。
- 商品ID重複問題への対策：(人物, カテゴリ, 配列内の位置, 商品ID, 現在の affiliateUrl, itemUrl) がすべて一致する要素だけを更新。同じ行に同じ商品IDが複数あれば変更しない。
- 楽天API・外部APIは呼ばない（DB内の既存URLを流用するだけ。追加課金なし）。
- 出力：`tmp/manual-affiliate-url-fix/<実行>/result.csv`（全170件の判定と修正前後URL）・`backup.json`（変更行の現在値）。`--rollback <backup.json>` で今回の変更だけを戻せる（dry-run で 130 件を判定できることを確認）。
- テスト：plan.test.ts 16件（商品番号・http/https の扱い、商品名不一致・短縮URL・流用元なし・流用元複数・識別部分不一致・同一ID重複は変更しない、affiliateUrl 以外を変えない、状態が変わっていたら例外、再実行で already_applied）。
- 確認時に、件数ガードの動作確認として `--apply --expect 999` を1回実行し、「件数不一致のため apply を中止」でトランザクション前に終了したこと（DB変更なし）を確認。

### バックアップと復元（apply 時）
- この環境には Neon の CLI・APIキー・Vercel 連携が無いため、Neon コンソールで実施：Branches → Create branch（親：本番ブランチ、Head、名前例 `backup-manual-affiliate-fix-20261016`）。復元は Neon の「Restore」（バックアップブランチから、または履歴保持期間内の時点を指定）。
- 推奨：作成したブランチの接続文字列を DATABASE_URL にして先に apply（本番に影響なし）→ 結果確認 → 本番で dry-run → `--apply --expect 130`。
- 行単位の復元はスクリプトの backup.json と `--rollback` で可能。

### 適用後の影響
- 公開カードは `affiliateUrl || itemUrl` のため、対象130件のリンクが楽天アフィリエイト経由になる（遷移先の商品ページは同じ）。表示件数・分類・並び順は変わらない（affiliateUrl は分類・重複判定・並び替えに使っていない。重複判定は itemUrl→pc の実URLで行うため同じ商品のまま）。
- 残り：no_source 11件（3商品）は、管理画面の楽天検索（API・affiliateId 付き）で該当商品のURLを取得して個別に差し替えるか、次回の楽天取得で同じ商品番号が入った後にスクリプトを再実行すると対象になる。a.r10.to 29件は楽天アフィリエイト管理画面で発行元を確認後に判断。再発防止（手動追加時の自動変換）は未実装。

### トップページ「人気検索」の並び順の変化
- 人気検索は Redis `search:ranking`（/api/search-track で利用者の検索ごとに加算）の回数順 TOP10 を、トップページで60秒キャッシュして表示している。本番の3時点（Phase 1 後・Phase 2 後・内部リンク後）の10件は同じ顔ぶれで、入れ替わったのは8〜10位（髙地優吾・M!LK・広瀬すず）の順序のみ。検索回数の増加による動的な変化のため修正不要。

---

## Task 97 追記2：本番修正前の最終検証と、検証用ブランチでの試験の準備（本番DB未変更・未commit）

### 130件の最終検証（本番DB読み取りのみ）
- 130件すべて：商品名が流用元と**完全一致**（【】付記の違いも無し）、盤種・特典表記（Type A/B・初回仕様限定盤・通常盤・CD＋DVD/Blu-ray・限定カバー等）も一致、流用元の商品ID（cd-/dv-/bk-＋商品番号）の番号＝元の itemUrl の商品番号、同じ商品番号に別名の商品は無し、遷移先はどちらも楽天ブックスの同じ商品ページ。初回盤A/B・通常盤・特典違いは商品番号が異なるため同一扱いにならない。
- 価格は 57 件で流用元と異なる（手動登録時に入力された価格。商品番号が同じためリンク先は同じ商品）。価格は今回変更しないため、表示価格はそのまま（既存の状態）。
- 流用元のアフィリエイトURLは、現在サイトで使われている楽天API発行の楽天ブックス向けURL 77,158 件と同じ識別部分（1種類）。推しサーチのアカウントとの対応を値で照合する手段はローカルに無い（RAKUTEN_AFFILIATE_ID は Vercel のみ）ため、反映後に楽天アフィリエイトの成果レポートでクリックの計上を確認する。
- 判断できない商品（流用元なし11・短縮URL29）は対象外。異常判定（名称不一致・流用元複数・形式不一致・同一ID重複）は0件。
- affiliateUrl の利用箇所はリンク表示（ProductCard・PhotobookCard・グループ・作品・トップ人気商品・計測）と写真集の代表選び（URLの有無のみ）だけで、分類・重複判定（itemUrl→実URL）・並び順・AI判定には使っていないため、表示件数・順位は変わらない。

### スクリプトの追加安全策（`scripts/manual-affiliate-url-fix/run.ts`）
- 書き込み（apply・復元）には `--confirm-host <接続先ホスト名>` を必須化（接続先の取り違え防止）。apply はさらに `--expect 130` の一致が必要。
- `--branch-selftest`：Neon 検証用ブランチ専用の通し試験。接続先が `.env.local` の本番ホストと同じなら開始前に中止（本番で実行できないことを確認済み）。内容：①対象行の1つを試験用に変更した状態で古い計画の更新を試み、全体が中止されて1件も更新されないこと（同時更新で古いデータを上書きしない）→ 試験用変更を戻す、②適用し、130件が適用済み・各行が想定どおり（affiliateUrl 以外不変）、③バックアップから復元し、全行が元の状態（元のURL）と完全一致、を自動判定。
- 更新SQLは本番に対して EXPLAIN（実行しない）＋存在しないキーで文法・型を確認済み。tsc・npm test（106ファイル/1902件）・ESLint エラー0。

### 検証用ブランチでの試験手順（ユーザー許可後）
1. Neon コンソール → 対象プロジェクト → Branches → New branch（Parent：本番ブランチ、Current data、自動削除 1 day のまま）→ Create。
2. Connect → 作成したブランチを選択 → 接続文字列をコピー → プロジェクト直下に `.env.branch-test` を作成し `DATABASE_URL=<接続文字列>` の1行だけを書く（.gitignore の `.env*` で git 対象外。Vercel の環境変数は変更しない）。
3. `npx dotenv -e .env.branch-test -- npx tsx scripts/manual-affiliate-url-fix/run.ts`（dry-run で 130 件）→ `… --branch-selftest --expect 130 --confirm-host <ブランチのホスト名>` で PASS を確認。
4. 本番：Neon でバックアップ用ブランチを作成（または履歴からの復元期間を確認）→ `npx dotenv -e .env.local -- … run.ts`（dry-run、backup.json 保存）→ `… --apply --expect 130 --confirm-host <本番ホスト名>` → 人物ページでリンク確認。戻す場合は `--rollback <backup.json> --apply --confirm-host <本番ホスト名>`。
5. 検証用ブランチは自動削除（1日）または Branches の ⋮ → Delete。

### Neon の料金（公式料金ページ、2026-10-16 確認）
- ブランチ：Free・Launch は1プロジェクト10個まで追加料金なし（超過は Launch/Scale で $1.50/branch-month、時間按分）。子ブランチのストレージは書き込んだ分だけ増える（copy-on-write）。
- コンピュート：ブランチが動作中の時間だけ CU-hour を消費（Free は月100 CU-hour まで、Launch $0.106/CU-hour）。5分無操作で停止。
- 履歴（時点復元）：Free 6時間（1GB まで）・Launch 7日・Scale 30日。契約プランはこの環境から確認できないため、Neon の Billing 画面で確認が必要。

---

## Task 97 追記3：本番DBの affiliateUrl 修正を実施（2026-10-16、未commit）

- 方針変更（ユーザー指示）：検証用ブランチは作らず、本番DBで直接実行。新しい Neon ブランチ作成・Vercel 環境変数の変更・commit/push/deploy はしていない。
- 事前確認：接続先は .env.local の DATABASE_URL（本番DB。ホスト名はログに記載しない）。dry-run 130件（6行）・異常判定0・対象外 no_source 11／短縮URL 29。バックアップ（backup.json：6行の items 全体＝元URLを含む／changes 130件＝人物・カテゴリ・配列位置・商品ID・修正前後URL）を検証（130/130 有効・対象一意）し、--rollback の dry-run で 130 件を判定できることを確認。成果対象の確認：流用URLは楽天API（affiliateId=RAKUTEN_AFFILIATE_ID、131日前から設定）が発行したもので、楽天ブックス向けリンク 77,158 件と同じ識別部分（1種類）。楽天APIドキュメント上、affiliateId 指定時に affiliateUrl が返り、手動リンク形式も hgc/<アフィリエイトID>/ 。更新前に全 products 行・verdicts・product_display_order・photobook_settings の指紋（md5）を取得。
- 実行：`run.ts --apply --expect 130 --confirm-host <本番ホスト>` を1回。products 6行・affiliateUrl 130件を1トランザクション（各行 items 完全一致の楽観ロック）で更新。スクリプトの反映後検証：適用済み 130 / 変更予定 0。
- 事後確認：products 2,160行のうち変化したのは対象6行のみ（谷口愛季 CD・遠藤理子 CD・野口衣織 写真集・音嶋莉沙 CD・音嶋莉沙 本・雑誌・髙松瞳 写真集）、全行の要素数不変、verdicts（86,655件）・product_display_order・photobook_settings は指紋一致（変更なし）。6行内で変わったのは affiliateUrl 130件のみで全件想定どおり、他フィールドの差分0。対象外：楽天ブックス通常URL 11件・a.r10.to 29件はそのまま。本番の人物ページ（3人）でカードのリンクが新URLに置き換わり、旧URLのリンクは無し。アフィリエイトURL 3件（2商品）を実際にたどり、hb.afl → pt.afl → books.rakuten.co.jp の同じ商品番号ページに到達（このため自分のクリックが最大3回計上されうる）。
- バックアップ：`tmp/manual-affiliate-url-fix/2026-10-16T07-00-20-305Z-apply/backup.json`・`result.csv`（git 対象外の tmp/）、同じものを作業用ディレクトリにも複製。戻す場合：`npx dotenv -e .env.local -- npx tsx scripts/manual-affiliate-url-fix/run.ts --rollback tmp/manual-affiliate-url-fix/2026-10-16T07-00-20-305Z-apply/backup.json`（確認）→ `--apply --confirm-host <本番ホスト>`。
- 残り：no_source 11件（3商品）・a.r10.to 29件・手動追加時の自動変換（再発防止）は未対応。楽天アフィリエイトの成果レポートでのクリック計上確認はユーザー側。

---

## Task 97 完了：手動登録の楽天商品 affiliateUrl 修正の完了整理（2026-10-16）

- 修正スクリプト `scripts/manual-affiliate-url-fix/`（plan.ts・plan.test.ts・run.ts）を確認：テスト16件合格・tsc・ESLint エラー0、接続情報や実際のアフィリエイトIDの記載なし。
- バックアップを git 管理外かつ iCloud 同期外の `~/oshi-search-backups/2026-10-16-manual-affiliate-url-fix/` に保存（権限 700/600、SHA256SUMS 付き、DB接続情報は含まない）。正本は `2026-10-16T07-00-20-305Z-apply/backup.json`（本番更新直前に取得）。リポジトリ内の tmp/ にも同じものが残っている（git 対象外）。
- 書き込みなしの復元確認：上記バックアップで `run.ts --rollback`（dry-run）を実行し「復元予定 130 / 復元済み 0 / エラー 0」、チェックサム全件一致。必要時は `--apply --confirm-host <本番DBのホスト名>` で今回の130件だけを元のURLに戻せる。
- 追加のDB変更・API呼び出し・デプロイはしていない。

---

## Task 99（Phase 3）：手動登録の楽天商品で通常URLが保存される問題の再発防止（未commit・Production未反映）

### 調査結果（本番DBは読み取りのみ）
- 手動登録の商品（ID mn-）は `/api/admin/product-manual`（POST）だけが作る。入力元は ①管理画面「商品を追加」（URLを手入力）と ②管理画面「楽天検索」からの一括追加。
- 根本原因：
  1. `/api/admin/rakuten-search` が楽天APIの `affiliateUrl` を捨てて `itemUrl` だけ返していた。楽天市場APIは affiliateId 指定時に itemUrl 自体がアフィリエイトURLになるが、楽天ブックス系（書籍・CD・DVD）は itemUrl が通常URLで、正規URLは affiliateUrl にしか入らない。
  2. product-manual が `affiliateUrl = itemUrl` で保存していた（通常URL・短縮URLもそのまま「affiliateUrl」になる）。
  3. 編集（PUT）は itemUrl だけ更新し affiliateUrl を更新しないため、URLを直してもリンク先が古いまま。
- 手動商品のURLの内訳：楽天ブックス向けと同じ識別部分の hb.afl 5,083 件・楽天市場各店舗の hb.afl 3,474 件（いずれも楽天検索の楽天市場APIから追加。店舗名・rafcid 付き）、楽天ブックス通常URL 141 件（店舗名なし＝楽天検索の書籍/CD/DVD から追加。130件は Task 97 で修正済み）、a.r10.to 29 件（手入力）。
- 再取得（batch-processor → storeProducts → mergeProductItems）：楽天API商品と手動商品は同じ products 行に入り、ID または normalizeItemUrl（ホスト＋パス）が一致すると統合される。
  - mergeRakutenItem は fetched の空でない値で上書きするため、楽天APIが affiliateUrl を返さない場合（affiliateId 未設定など）、rakuten.ts の affiliateLink() が itemUrl で代用 → 既存の正規アフィリエイトURLが通常URLで上書きされうる。
  - normalizeItemUrl はアフィリエイトURLのホスト＋パス（楽天市場では店舗単位で同じ）で比較していたため、同じ店舗の別商品が同一とみなされ、手動登録の楽天市場商品が別商品で上書き・統合されうる（商品ID重複問題 Task 95 と同種）。
  - 修正済み130件：itemUrl が楽天ブックス通常URLのため、同じ商品番号の楽天APIの CD・DVD・書籍が同じ行に再取得されると、従来どおりその API 商品に統合される（ID は API 側に変わる。今回の変更で affiliateUrl が通常URLに戻ることは無くなった）。

### 変更
- `src/lib/rakuten-affiliate-link.ts`（新規・純粋関数）：リンク種別判定（アフィリエイトURLはホスト hb.afl.rakuten.co.jp・/hgc/<識別子>/・pc が楽天の商品ページの場合だけ。通常URL・短縮URL・クエリに文字列を含むだけのURLを誤判定しない）、同一性キー（楽天ブックス＝商品番号〔楽天市場の楽天ブックス店 book/<番号> も同じ〕、楽天市場＝店舗＋商品コード）、管理画面のリンク状態（確認済み／通常URLのため要確認／短縮URLのため要確認／発行元未確認のため要確認／URL未設定）、同一商品名の判定（全半角・空白・盤種特典を含まない【】付記だけ吸収。Type A/B・初回/通常・特典表記の違いは別商品）、手動登録時の affiliateUrl の決定（①楽天APIが返した正規URL（遷移先が同じ商品の場合）②既存DBの同じ商品・同じ販売元・同じ名前の正規URL（URLが1種類に決まる場合）③それ以外は空＝要確認。URLは組み立てない・短縮URLは変換しない。貼り付けた hb.afl は既存のAPI発行URLと同じ識別部分の場合だけ確認済み）。
- `src/lib/rakuten-affiliate-resolve.ts`（新規・サーバー）：既存DBから同じ商品の API 発行アフィリエイトURL（手動登録以外）を最大50件読む。読み取りのみ・楽天APIは呼ばない。読み取り失敗時も推測せず要確認。
- `src/app/api/admin/product-manual/route.ts`：POST は上記で affiliateUrl を決定（確認できなければ空。公開カードは affiliateUrl || itemUrl のためリンクは従来どおり機能）し、レスポンスに linkStatus・表示名・理由を返す。楽天検索から渡された affiliateUrl を受け付ける。PUT は itemUrl が変わったときだけ決め直し、新しいURLが確認済み affiliateUrl と同じ商品なら正規URLを残す。商品ID・商品名・価格・カテゴリ・AI判定（saveVerdict の扱い）は従来どおり。
- `src/app/api/admin/rakuten-search/route.ts`・`src/app/admin/rakuten-search/RakutenSearchClient.tsx`：書籍・CD・DVD・楽天市場の結果に API の affiliateUrl を含め、追加時に product-manual へ渡す（APIの追加呼び出しなし）。
- `src/lib/product-store.ts`：mergeRakutenItem は既存の affiliateUrl がアフィリエイトURLで、取得値がそうでない場合は上書きしない。normalizeItemUrl はアフィリエイトURLなら遷移先（pc）の商品ページで比較（同じ店舗の別商品を同一視しない。同じ商品は従来どおり統合）。
- 管理画面：`src/components/admin/AffiliateLinkBadge.tsx`（新規）。`ManualProductModal.tsx` に入力URLの扱いの案内（保存前）と保存結果のリンク状態、編集時の現在のリンク状態。`PersonProducts.tsx` の商品一覧に、手動追加商品は常に・それ以外は要確認／未設定のときだけバッジ表示。要確認は黄色・⚠、確認済みは緑・✓。
- DBカラムの追加なし（状態は itemUrl・affiliateUrl から判定）。DBデータの変更なし（130件・11件・29件を含め既存データは触れない）。

### テスト・確認
- 追加テスト：`rakuten-affiliate-link.test.ts`（24件：正規URL・http/https、通常URL（楽天ブックス・楽天市場）、短縮URL、URL未設定、偽装URL、同名の別商品番号、特典違い・盤違い、同じ店舗の別商品、候補複数、貼り付けURLの発行元）、`product-store-affiliate.test.ts`（6件：再取得で正規URLを通常URLで上書きしない、修正済み手動商品が通常URLに戻らない、同じ店舗の別商品を統合しない）、`product-manual-affiliate-route.test.ts`（10件：API URL優先・DB流用・見つからなければ空・同名別番号・短縮URL・DB失敗時・未設定400・編集時の保持／決め直し）。
- `tsc --noEmit` 0件、`npm test` 109ファイル/1942件合格、`next build` 成功。ESLint：新規ファイル・変更箇所のエラー0（RakutenSearchClient・PersonProducts の5件は HEAD 時点からある react-hooks のエラー）。
- 本番DB読み取りでの確認：保存済み全商品のリンク状態は API 商品 83,356 件すべて確認済み、手動商品は確認済み 8,687（＝8,557＋修正130）／通常URLのため要確認 11／短縮URLのため要確認 29（想定どおり）。照合処理は修正済み商品の正式名で「確認済み（既存DB）」、名前が1文字でも違えば要確認、no_source 商品は要確認、短縮URLは照合なし。1件あたり約1.5秒（全商品の jsonb を走査）。
- 管理画面（ローカル本番ビルド＋ローカル専用 Redis モック、書き込み系リクエストはブラウザで遮断）：商品一覧のバッジ（音嶋莉沙 62件確認済み、谷口愛季 要確認2件・確認済み4件）、追加フォームの案内文（通常URL・短縮URL・アフィリエイトURL）、編集時の現在のリンク状態を確認。

---

## Task 99 追記：本番公開前の最終確認（未commit・Production未反映）

### 「確認済み」表示の意味の明確化
- 「確認済み」は〈楽天アフィリエイトURLの形式〉かつ〈遷移先が商品URLと同じ商品〉の確認で、成果帰属（どの楽天アカウントに計上されるか）は確認していない。混同を避けるため表示名を「アフィリエイトURL（形式・遷移先確認済み）」に変更し、バッジの説明と保存結果に「成果の計上先は楽天アフィリエイトのレポートで確認」と明記。URLの出どころ（楽天APIが返したURL／既存DBの同じ商品のURL／既存のAPI発行URLと同じ発行元）は保存結果の理由に表示。
- アフィリエイトIDの照合（認証情報・IDは出力せず一致可否のみ）：本番の管理画面「楽天検索」を1回呼び（本番管理画面へのログイン1回・楽天API 1回）、現在の本番設定で発行されたURLの識別部分を DB 保存済みURLと比較 → 楽天ブックス店 2/2、DBにも存在する店舗 4/4 で一致。DB の正規URLは現在の本番設定（RAKUTEN_AFFILIATE_ID）で発行されたものと同じ。ID がユーザーの楽天アカウントのものかは楽天の管理画面でのみ確認可能。

### 照合処理の軽量化（DBスキーマ・インデックス変更なし）
- `findAffiliateCandidates`：items を全展開する前に、products 行を文字列で絞り込む（楽天ブックス＝商品番号を含む行、楽天市場＝商品コードを含む行〔大文字小文字無視〕。必ず候補を含む上位集合）。最終判定の正規表現と同一性・名前の検証は従来どおり。
- 本番DB読み取りでの確認：修正済み130件すべてで、照合結果が保存済みの正規URLと一致（130/130、平均 315ms・最大 564ms。従来は約1.3〜1.9秒）。楽天市場のAPI商品20件（無作為）も 20/20 で同じ商品ページの正規URLを返した（平均 約0.5秒）。

### テスト追加・最終確認
- `rakuten-search-affiliate.test.ts`（5件：書籍・CD・DVD・楽天市場で API の affiliateUrl を返す、API が返さない場合は空で通常URLで代用しない、追加のAPI呼び出しなし）。
- `tsc` 0件、`npm test` 110ファイル/1947件合格、ESLint（変更・新規ファイル）エラー0、`next build` 成功。
- 公開ページ（ローカル本番ビルド＋ローカルRedisモック）：人物7・写真集・グループ・/oshi-vod・robots.txt は本番と完全一致（楽天リンク・商品カード含む）。作品の JSON-LD（TMDb キー）とトップ（Redis）の差は既知の環境差。
- 管理画面：「✓ アフィリエイトURL（形式・遷移先確認済み）」「⚠ 通常URLのため要確認」の表示、編集時の現在のリンク状態を確認（書き込み系リクエストはブラウザで遮断）。

---

## Task 95 追記（Phase 4 調査・設計）：楽天市場の商品ID重複の根本改善（コード・DB未変更）

### 調査結果（2026-10-16、本番DB読み取り・本番管理画面の分析API GET のみ）
- **原因の確定**：`src/lib/rakuten.ts` の `stableId('ic', Item.itemUrl)`。楽天市場APIは affiliateId 付きで itemUrl を `https://hb.afl.rakuten.co.jp/hgc/<店舗単位の識別部分>/?pc=<商品ページ>` で返し、パス末尾（店舗単位）の先頭24文字をIDにしている。全 6,198 件で `id = 'ic-' + 識別部分の先頭24文字` が成立し、ID 1,284 種類＝店舗 1,284 で 1対1（複数店舗にまたがるID・複数IDを持つ店舗は 0）＝**商品IDが実質「店舗ID」**。楽天市場APIの公式識別子 `itemCode`（店舗コード:商品番号）は保存していない。
- **楽天ブックス系（bk-/cd-/dv-）**：itemUrl が `books.rakuten.co.jp/rb/<商品番号>/` で、商品番号は特典違い・盤違いでも別（ISBN/JAN は同じ場合がある）ため一意。問題なし。手動登録（mn-）も一意。修正済み130件は mn- のため影響なし。
- **保存時の挙動**：`mergeProductItems` が ID で重複除去するため、同じ人物・同じカテゴリの行には同じ店舗の商品が1件しか残らない（行内の重複ID 0件）。再取得のたびに、同じ店舗の別商品の内容で上書きされうる（判定はIDに付いたまま）。
- **規模**：楽天市場商品 6,198 件（321人、535行）。同じ人物内で同じIDが別商品に付いている：**257組・514件（162人）**、すべて「グッズ＋中古」の組。DB全体では1つのIDを最大332商品が共有（店舗ごとの商品数：1商品971店・2〜9商品264店・10商品以上49店、実在商品4,430）。
- **判定（verdicts、(人物, 商品ID) が主キー）**：ic- の判定 5,528 行。514件の組に付いた判定：AI related 168・手動 deleted 43・手動 unrelated 16・手動 related 7・auto uncertain 3・AI unrelated 2。商品が存在しない ic- 判定 248 行（入れ替わりの跡）。
- **他の参照**：product_display_order・photobook_settings に ic- ID は 0 件。Instagram 生成は表示時に参照するだけで保存しない。Redis `product:click:{ID}`／`product:meta:{ID}` はIDがグローバル（人物をまたぐ）。分析画面で確認できた商品クリック 8キー・10回のうち、ic- は 1キー・1回（共有IDのキー）。
- **影響**：表示（同じ店舗の別商品が出ない・中身が入れ替わる）、AI判定（別商品の判定を流用）、クリック集計（同じ店舗の全商品が1キーに合算、メタは最後のクリックで上書き）。DB容量 105MB（products 17MB・verdicts 16MB、ic- を含む行は 3.4MB）。

### 修正設計
- **新ID**：楽天市場は `ich-<店舗コード>:<商品コード>`（小文字化。プレフィックスを変えて旧 `ic-` と衝突させない）。新規取得では API の `itemCode` を正とし、旧データは保存済みの遷移先URL（pc＝`item.rakuten.co.jp/<店舗>/<商品コード>/`。全件に存在）から同じ形式を作る。http/https・末尾スラッシュ・大文字小文字・アフィリエイトの包み（hb.afl）・m/rafcid 等のパラメータの違いは同じ商品として扱い、URLが違うだけで別商品にはしない。楽天市場上の楽天ブックス店（book/<番号>）は楽天ブックスの商品番号と同じ扱い（Phase 3 の同一性キーと共通）。楽天ブックス系・手動登録のIDは変更しない。
- **段階**：
  1. コードのみ（DB変更なし）：楽天市場APIの `itemCode` を商品に保存し、URL由来のキーと一致するかを通常の定期取得でログ集計（一括再取得はしない）。
  2. dry-run（読み取りのみ）：旧ID→新IDの対応表（6,198件）、1対1の組・分かれる組（514件）・孤立判定（248）・各テーブルへの影響件数を CSV 出力。
  3. 移行（許可後）：Neon ブランチでバックアップ＋対象行の JSON 書き出し → 定期取得の時間帯（12:00 JST）を避けて実行 → 人物単位のトランザクションで products の ic- 要素の id だけを新IDに書き換え（他フィールド不変、楽観ロック）、verdicts は旧行を残したまま新IDの行を追加（1対1は全項目をコピー、514件の組は判定を共有していたためコピーせず未判定＝非公開のまま AI 再判定または手動確認）→ 直後に新ID生成のコードを反映。
  4. 以後の通常取得で、これまで1件に潰れていた同じ店舗の別商品が新規（未判定）として入る。AI判定の件数が増えるため、人物単位で段階的に行う。
- **データ消失の防止**：商品・判定の削除なし（追加と id の書き換えのみ）、旧判定行は残す、Neon ブランチ＋JSON バックアップ、行単位の楽観ロックと1トランザクション、復元スクリプト（products は backup の items に戻し、追加した判定行だけ取り消す）。Redis は変更しない（新IDで新しく集計。旧キーは残す）。表示順・写真集設定は ic- を含まないため変更不要。修正済み130件（mn-）と Phase 3 の affiliateUrl 保護は維持。
- **費用**：Neon は無料枠内（ブランチ1本・書き換え約3.4MB＋判定数千行）、楽天APIの一括呼び出しなし、Redis 変更なし。AI 再判定（514件＋以後の新規）は既存の OpenAI 利用の範囲で少額。

---

## Task 95 追記2（Phase 4 実装）：楽天市場の商品IDを itemCode 由来に変更（移行前の互換対応）と移行シミュレーション（未commit・本番DB未変更）

### コード修正
- `src/lib/rakuten-item-id.ts`（新規・純粋関数）：新ID `ich-<店舗コード>:<商品コード>`。楽天市場APIの公式 `itemCode` から作り、商品URL（アフィリエイトURLなら遷移先）の店舗と一致しない・itemCode が無い／不正な商品は null（推測で作らない）。商品コードだけ URL と異なる場合は itemCode を正とし ok_url_differs として区別。大文字小文字・http/https・アフィリエイトの包み等の違いは同じID。移行用に、保存済みの itemCode（あれば）または遷移先URLから同じ形式を作る関数。
- `src/lib/rakuten.ts`：楽天市場（グッズ・中古）の取得で、旧 `stableId('ic', itemUrl)`（店舗単位）をやめ、新IDを使う。itemCode を確認できない商品は保存せず、理由別件数と URL 不一致件数をログ出力。itemCode を商品データに保存。取得内の重複除去（ID単位）で同じ店舗の別商品が潰れていた問題も解消。楽天ブックス系（bk-/cd-/dv-）・手動登録（mn-）は無変更。
- `src/lib/product-store.ts`（互換）：新ID（ich-）で取得した商品が、既存の楽天市場商品（旧 ic- または新 ich-）と同じ商品ページ（遷移先URL）なら既存IDを残す（判定が外れて非表示になるのを防ぐ。一度付いたIDは変わらない）。itemCode は既存商品にも記録される（後の移行で使う）。Phase 3 の affiliateUrl 保護はそのまま。
- `src/db/write.ts`・`src/lib/batch-lock.ts`：移行ロック `product-id-migration`（既存の batch_lock の仕組み）が有効な間は、upsertProduct（products への書き込みの唯一の経路：定期取得・手動の再取得・手動登録・復旧）をエラーで止める。ロックが無ければ従来どおり。
- 楽天検索・手動登録：楽天市場の検索結果に itemCode を含め、追加時に渡す。手動登録は ID は従来どおり mn-、itemCode は商品URLの店舗と整合する場合だけ保存。
- 型：RakutenItem / RakutenIchibaItem に itemCode（任意）。
- テスト：rakuten-item-id.test.ts（12件：同じ店舗の別商品は別ID・同じ商品は同じID・itemCode なし／不正／店舗不一致は作らない・楽天ブックス店・移行用ID・取得処理で潰れない・互換で既存ID維持）、product-id-migration-guard.test.ts（2件）、scripts/ichiba-id-migration/plan.test.ts（9件）。既存の楽天取得テスト2件は、テストデータに実際のAPIと同じ itemCode を追加（検証内容は不変）。tsc 0件・npm test 113ファイル/1970件・ESLint エラー0・build 成功。公開ページは本番と同一（人物7・写真集・グループ・/oshi-vod・robots。トップ＝Redis、作品 JSON-LD＝TMDb の既知の環境差のみ）。

### 移行シミュレーション（`scripts/ichiba-id-migration/simulate.ts`、本番DB読み取りのみ。出力 `tmp/ichiba-id-migration/2026-10-16T12-00-07-788Z-simulation`）
- 対象 535行・楽天市場商品 6,198件：新IDに変換可能 6,198（変換不可 0）、行内の新ID衝突 0、既存IDとの衝突 0、既存の新ID判定との衝突 0。同じ商品が同じ人物の別カテゴリにもある（新IDが同じ）2組。
- 判定：引き継ぎ可能 5,043件（追加する判定行 5,041。内訳 deleted/manual 2,762・related/ai 1,757・unrelated/manual 217・related/manual 153・unrelated/ai 135・uncertain/auto 15・relevant/ai 2）。判定なし 677件（引き継ぎ不要）。
- 判定の帰属が不明（同じ人物で同じ旧IDを別商品が共有し、判定あり）：239組・478件（related/ai 336・deleted/manual 86・unrelated/manual 32・related/manual 14・uncertain/auto 6・unrelated/ai 4）。当初案（移行して未判定にする）では現在公開中の 350件（120人）が一時的に非公開になるため、方針を変更し、**この478件は今回は移行せず旧IDのまま**（判定・表示とも現状維持）。review-list.csv で再確認し、確認できた組から個別に移行する。
- 実際にIDを書き換える商品 5,720件、移行で非公開になる商品 0件。商品が存在しない旧ID判定 248件は移行・削除しない。
- クリック集計：Redis の product:click / product:meta は旧IDのまま残す（店舗単位で合算されており商品ごとに分離できない）。分析画面で確認できた楽天市場のクリックは1キー・1回のみ。新IDの商品は新しいキーで計測される。

### 本番移行の安全策（設計・許可後に実施）
- 実行前：Neon の検証用でない「バックアップ用」ブランチ作成（無料枠内）＋対象 535行の items と ic- 判定の JSON 書き出し（git 管理外）。新コードを先に公開して互換期間を置き、定期取得で itemCode が既存商品に記録されることと、itemCode と URL の不一致件数（ログ）を確認してから移行する。
- 実行時：移行ロック product-id-migration を取得（全経路の products 書き込みを停止）→ 定期取得（12:00 JST）・AI判定を避けた時間帯に、人物単位のトランザクション＋行単位の楽観ロックで ic- 要素の id だけを書き換え、判定は新ID行を追加（旧行は残す）→ 検証 → ロック解放。
- ロールバック：products をバックアップの items に戻し、追加した新ID判定行だけを削除（旧行は残っているため判定は元どおり）。

---

## Task 95 追記3（Phase 4 公開前の最終安全確認）：本番データでのメモリ上の再現検証（未commit・本番DB未変更）

### 検証方法
- `scripts/ichiba-id-migration/verify.ts`（新規・読み取り専用）：本番DBの対象 535行（楽天市場商品 6,198件）と、該当人物の判定を読み込み、メモリ上で「新コードでの再取得」「移行」「復元」を再現。公開中の商品（verdict=related）を人物・カテゴリ・商品ページ・商品名の単位で比較。DB・Redis への書き込み、楽天API・OpenAI の呼び出しはしない。移行のメモリ上の適用・復元は `plan.ts` の applyPlanToRows / rollbackPlan（移行スクリプトでも同じ変換を使う）。
- 結果：全19項目 OK（対象範囲の公開中商品 2,260件）。
  - S1 コード先行公開後に同じ商品を再取得：既存IDは不変（6,198→6,198）、商品数・中身（商品名・URL・affiliateUrl・価格等）不変（itemCode が記録されるだけ）、公開中の商品は不変、対象外478件は旧IDのまま・判定共有も現状どおり。
  - S2 API が affiliateUrl を返さない場合：正規 affiliateUrl は上書きされない。
  - S3 同じ店舗の別商品が新たに見つかった場合：新IDで別に追加（未判定＝非公開）、既存商品・公開は不変、行内ID重複なし。
  - S4 itemCode と URL が食い違う場合：既存IDは不変。
  - S5 移行：公開中の商品は完全に同じ、変わるのは商品IDだけ（他フィールド・順序・件数不変）、書き換え 5,720件、引き継ぐ判定 5,041行は「旧IDに対応する商品がちょうど1つで、その商品の新IDにだけ同じ値（verdict・source・score）」、行内ID重複なし。
  - S6 復元：商品データ・判定とも移行前と完全一致（旧判定は削除しないため、追加した判定行を消すだけで戻る）。
  - S7 公開後・移行前に定期取得が入った場合：移行で新ID同士・既存ID・既存判定と衝突しない、移行後の公開は不変。
  - S8 移行後の定期取得：IDも公開も不変。
- 単体テスト追加：plan.test.ts に共有グループの扱いを追加（9件）。

### 追加で判明した注意点
- **OpenAI 費用**：毎日の定期取得（/api/cron/refresh → processAllPersons）は全人物を再取得し、新規商品を自動でAI判定（1人1日150件まで、gpt-4o-mini、1件あたり約 $0.000134。直近の通常は1日40〜60件・約 $0.006）。新コード公開後は、これまで同じ店舗で潰れていた別商品が新規として入るため、一時的にAI判定が増える。上限いっぱいでも1日約 $6.7（全人物×150件）、実際はそれより大幅に少なく数日で収束する見込み。
- **孤立判定**：移行後は旧IDの判定行（約5,041）を復元用に残すため、「商品が存在しない判定」として、データ損失監査（/admin/data-loss-audit）の件数が増え、商品復旧API（/api/admin/product-recovery、Redis に残る旧データから商品を追記する機能）の候補にも出る。復旧を実行すると旧IDの商品が二重に戻りうるため、**移行スクリプトと同時に「移行済みの旧ID判定を孤立判定・復旧候補から除外する」対応が必要**（未実装）。
- **判定の正しさの限界**：引き継ぐ 5,043件は「現在その商品に適用されている判定」を同じ商品の新IDへ移すもので、公開状態は完全に現状維持になる。ただし旧ID時代に同じ店舗の別商品の内容で入れ替わった経歴がある場合、その判定が当初どの商品に対して出されたかまでは記録が無く確認できない（現状より悪化はしない）。

## Task 95 追記4（Phase 4）：移行後に旧IDの判定・商品が二重に復活しないよう、復旧APIとデータ損失監査を対応（未commit・本番DB未変更）

### 目的
移行後も復元用に残す旧ID（ic-）の判定行が「商品の無い孤立判定」として扱われ、復旧API が Redis に残る旧データから同じ商品を旧IDで二重に追加したり、新IDへ引き継いだ判定を同じ店舗の別商品に付け直したりするのを防ぐ。データ損失監査の孤立件数が見かけ上増えるのも防ぐ。

### 新旧IDの対応の判定（`src/lib/legacy-ichiba-verdict.ts`、新規・純粋関数）
- `legacyIchibaIdFromItemUrl`：旧IDを itemUrl から再計算（`src/lib/rakuten.ts` の stableId('ic', itemUrl) と同じ規則）。移行は id だけを書き換え itemUrl は変えないため、新ID商品から元の旧IDが分かる。
- `classifyOrphanVerdicts`：孤立判定を `migrated`（同じ人物の新ID商品のうち旧IDが一致するものに、同じ内容の判定＝verdict・source・score・reason が付いている＝移行で引き継いだもの）／`same_shop_new_id`（旧IDは一致するが判定が引き継がれていない＝同じ店舗の別商品の可能性。要確認）／`orphan`（従来どおり）に分類。
  - **移行スクリプトは判定を引き継ぐとき verdict・source・score・reason をそのまま写すこと**（この一致で「移行済み」を判定する）。
- `recoveryConflict`：復旧候補を追加してよいかを判定。同じID（already_in_db）、同じ商品ページ（same_product_exists：アフィリエイトURLは遷移先で比較、手動登録の通常URLとも一致）、旧IDで同じ旧IDに対応する新ID商品がある（legacy_id_has_new_id_item）場合は追加しない。人物の全カテゴリの商品と比較する。
- `normalizeItemUrl` は product-store.ts からここへ移動（product-store.ts は再エクスポート。挙動は同じ）。

### 変更
- `src/lib/orphan-verdicts.ts`（新規・読み取り専用）：孤立判定を取得して上記で分類する共通関数 `getOrphanVerdicts` と人物別集計 `summarizeOrphanVerdicts`（移行済みは orphanCount に含めず migratedCount に分ける）。
- `src/app/api/admin/product-recovery/route.ts`：
  - GET orphan-stats / orphan-detail / redis-check / id-diagnosis：移行済みの旧ID判定を除外。要確認の判定は分類 `R`（復旧候補の A にしない）。orphan-stats は `migratedTotal`、orphan-detail は `migratedCount` も返す。
  - POST：候補ごとに `recoveryConflict` で判定（同じ実行内の候補どうしの重複も含む）。書き込み直前に最新の全カテゴリの商品で再確認。dry-run 結果に `sameProductExistsCount`・`legacyIdHasNewIdItemCount` を追加。
- `src/app/admin/work-recovery/page.tsx`・`ProductRecoveryClient.tsx`：孤立件数は移行済みを除いた件数。移行済み件数の注記、R 分類・dry-run の除外件数を表示。
- `src/app/admin/data-loss-audit/page.tsx`：⑪ の孤立件数は移行済みを除いた件数。「移行済み旧ID判定（孤立ではない）」を別に表示。⑫（verdict 件数と商品件数の差）は従来どおり生の件数（移行後は旧ID判定行の分だけ差が増える）。
- `src/lib/product-store.ts`：
  - mergeProductItems：取得した商品が手動登録（mn-）の商品と同じ商品ページなら、手動登録の商品をそのまま残し取得分は追加しない（取得分のIDで置き換えると手動登録の判定が外れるため）。
  - appendProductToCategory（手動登録）：同じ商品ページ（遷移先で比較）の商品が同じカテゴリにあれば duplicate（定期取得のアフィリエイトURLの商品と、手動登録の通常URLの二重登録防止）。

### 読み取り専用の計測（本番DB SELECT のみ、メモリ上で移行を再現。`tmp/ichiba-id-migration/measure-orphans.ts`）
- 現在：孤立判定 3,730件（bk 2,531・dv 720・ic 248・cd 230・mn 1）。新しい取得関数の結果も従来のSQLと同じ 3,730件・移行済み 0件。
- 移行後（再現）：単純な比較では 8,771件に増えるが、新しい分類では 5,041件が「移行済み」、残り 3,730件は移行前と同じ（移行前から孤立していた 248件の ic- を含め、分類は変わらない）。
- 引き継ぎ元の旧ID判定 5,041行（商品 5,043件分）：すべて「移行済み」と判定（取り違え・取りこぼし 0）。
- 保留（deferred_shared）478件：移行後も旧IDのまま商品が残るため、判定が孤立になるもの 0件。
- 移行前の楽天市場商品（Redis に残る旧データ相当）6,198件を移行後のDBへ復旧しようとした場合：すべて追加されない（同じ商品ページあり 5,720件、同じIDあり 478件）。
- 手動登録：mn- 商品 8,727件のうち、同じカテゴリに同じ商品ページの他の商品があるもの 0件（今回の変更で既存の表示が変わる商品は無い）。

### テスト
- `src/lib/__tests__/legacy-ichiba-verdict.test.ts`（新規 10件）、`scripts/ichiba-id-migration/plan.test.ts` に移行後の分類・復旧の統合テスト1件追加。
- 全テスト 114ファイル・1,981件 OK、`npx tsc --noEmit` OK（`.next/types/* 3.ts` の既知の重複ファイル由来のエラーのみ）、`next build` OK。lint はプロジェクトに設定が無いため未実施。

## Task 100（Phase 5・②）：人物ページのカテゴリ別商品導線（未commit・Production未反映）

### 目的
人物ページの「関連商品ピックアップ」（各カテゴリ最大4件）から、そのカテゴリの商品一覧へ直接進めるようにし、楽天商品へのクリック機会を増やす。SNS投稿などからカテゴリ一覧へ直接リンクできるようにする。

### 変更
- `src/lib/product-tabs.ts`（新規・純粋関数）：タブ定義（ProductTabList から移動。タブ名・分類は不変）、タブ↔ページ内リンクID（`#products-photobook|cd|bluray|goods|other|used`）、タブ別件数 `countProductsByTab`（一覧と同じ数え方）。
- `src/components/site/FeaturedProductsSection.tsx`：各カテゴリのピックアップの下に「<カテゴリ>をもっと見る（全N件） →」（`href="#products-<slug>"` の通常のページ内リンク。見た目は既存の「関連商品をもっと見る」と同じ文字リンク）。一覧の件数がピックアップの表示件数以下なら出さない。件数が渡されない場合は数字なしで表示。
- `src/app/person/[slug]/page.tsx`：ピックアップに `categoryCounts={countProductsByTab(allProductItems)}` を渡すだけ（並び順・掲載条件・他セクションは不変）。
- `src/components/ProductTabList.tsx`：
  - 商品があるカテゴリごとに着地点 `<span id="products-<slug>">`（高さ0、固定ヘッダー＋クイックナビ分の scroll-margin）をサーバー描画。JS 読み込み前でもその位置へスクロールする。`space-y-4` の外に置き、レイアウトは変えない。
  - マウント時（直接アクセス・リロード）と hashchange（戻る／進む）で URL のカテゴリを選択。ページ内リンクで選んだ状態からカテゴリ以外のURLへ戻ったら「すべて」に戻す。同じリンクの再クリック（hashchange が起きない）もクリックで反映。選ばれたタブがタブ列の外にあれば横方向だけスクロールして見せる。
  - URL の書き換え（pushState/replaceState）はしない（既存のクイックナビと同じ通常のページ内リンクのみ）。新しいページURLは増えないため canonical・構造化データ・サイトマップに影響しない。

### 注意点
- 内部リンクなので楽天クリック計測（affiliate_click・/api/track）は送らない。楽天リンク・計測のコードは変更なし。
- 既存の「関連商品をもっと見る」（#products）は従来どおり「すべて」。
- 「その他」はピックアップに出ないためリンクは無いが、`#products-other` で直接開ける。

### 確認
- 単体テスト `src/lib/__tests__/product-tabs.test.ts`（9件）：タブ↔ID の往復、カテゴリ以外のハッシュは無視、件数、ピックアップのリンク（5件以上／4件以下／件数不明）、楽天リンクの href・sponsored 不変、着地点の描画。
- 全テスト 115ファイル・1,990件 OK、tsc OK（`.next/types/* N.ts` は既知のiCloud重複ファイル）、build OK。lint はプロジェクトに設定なし。
- ローカルの本番ビルド＋Playwright（360/390/430/1280px、/api/track はブラウザ内で横取りし本番Redisへ送らない）：79項目すべて OK。CD・写真集のリンク→該当タブ、件数表示＝タブ件数、一覧の先頭が固定ヘッダーに隠れない、戻る／進む、直接アクセス、不明なカテゴリ、再クリック、横はみ出しなし、ハイドレーションエラーなし、もっと見るで計測なし、楽天リンクのクリックは /api/track 1回。件数4件以下の人物（リンクなし）・商品0件の人物（エラーなし）。
- 本番（現行コード）とローカルで人物ページの楽天リンク（URL・順序・target・rel）が完全一致（目黒蓮75件・成田凌27件）。canonical・JSON-LD・VOD・今すぐ見るセクションのHTMLも一致。

---

## Task 114：Vercel 使用量の削減（トップ・ジャンルの再生成1時間化、写真集の集計キャッシュ、作品ページの関連商品の取得量削減）（本番DB/Redis未変更）

### 目的
Vercel Hobby の無料枠超過（直近30日：Active CPU 10時間25分/4時間、ISR Writes 約29.4万/20万、Fast Origin Transfer 11.05GB/10GB）への対策。調査で効果が大きいとした改善案①〜③を実装（④人物ページのキャッシュは保留）。

### 変更
- `src/lib/public-listing-cache.ts`（新規）：`PUBLIC_LISTING_CACHE_TAG`・`PUBLIC_LISTING_REVALIDATE_SECONDS`（3600）・`revalidatePublicListings()`（タグ・`/`・`/genre/[genre]` を即時無効化。Next.js のリクエスト外〔GitHub Actions の価格更新・スクリプト・テスト〕や描画中は例外を握りつぶして何もしない）。
- `src/app/page.tsx`：`revalidate` 60→3600。トップのデータキャッシュ5つ（人物・人気検索/人気商品・グループ・VOD作品数・写真集）を 60→3600秒にし、すべてに `PUBLIC_LISTING_CACHE_TAG` を付けた（既存の `RANKING_DATA_CACHE_TAG`・`photobook-home` も維持）。
- `src/app/genre/[genre]/page.tsx`：`revalidate` 60→3600。
- `src/lib/photobook-store.ts`：公開用の集計結果 `getPublishedPhotobookItems` と検索候補 `getPhotobookFacets` を `unstable_cache`（3600秒、タグ `photobook-home`＋`PUBLIC_LISTING_CACHE_TAG`）でキャッシュ。管理画面用（`getAllPhotobookItems`・`getAdminPhotobookRows`・男女管理）はキャッシュしない。
- 即時反映：`src/db/write.ts` の公開ページに出るデータの書き込み関数（upsertProduct・upsertVerdict・deleteVerdictInDB・upsertWork・batchUpdateVodData・upsertPersonMeta・upsertGroupMeta・deleteGroupMetaInDB・upsertPhotobookSetting・resetPhotobookSetting・upsertVodProvider・deleteVodProviderInDB・publishPersonInDB・unpublishPersonInDB）の書き込み成功後、および `src/lib/photobook-gender-write.ts`（男女の一括設定）・`src/lib/work-store.ts`（作品の物理削除2か所）・`src/lib/work-dedup-apply.ts`（作品統合）で `revalidatePublicListings()` を呼ぶ。書き込み失敗時は呼ばない。
- `src/lib/work-related-products.ts`（新規）：作品ページの関連商品。DB 側で「Blu-ray・DVD／CD／本・雑誌 × 判定 related」の商品の ID・商品名・位置だけを読み、作品名の一致は従来と同じ JS の正規化で判定、表示する最大6件の全項目だけを読む。2回の読み取りの間に位置の商品が変わった場合は従来の方法（全商品・全判定）で選び直す。従来の選び方は純粋関数 `selectWorkRelatedFromStored` として残した（テスト・検証用）。price-refresh の import 制約（judgment-store を読み込まない）を守るため product-store には置いていない。
- `src/app/work/[workId]/page.tsx`：`getRelatedProducts` を `getWorkRelatedProducts` 経由に。
- テスト：`work-related-products.test.ts`（無作為データ500通りで従来と一致・カテゴリ順・2回目の読み取りの省略・選び直し・DBエラー）、`public-listing-cache.test.ts`（無効化の内容・リクエスト外で失敗しない・3600・全書き込み関数の呼び出し・書き込み失敗時は呼ばない・写真集キャッシュのキーとタグ・管理画面はキャッシュしない）。`photobook-store-inflight.test.ts` は `next/cache` をモック。

### 検証
- tsc OK、npm test 117ファイル・2,009件 OK、build OK（`/` と `/genre/[genre]` は Revalidate 1h）。
- 本番DBを読み取りのみで比較：公開作品のうち関連商品がある 2,509作品＋ない 722作品（計3,231作品・関連商品 6,664件）で、新旧の結果（商品・順序・件数・全項目）が完全一致。作品ページ1回あたりのDB読み込みは平均 176KB→10KB（-94%、300作品の抽出）。
- ローカル `next start`（DB に書き込まない一時ルートで無効化を確認し、確認後に削除）：2回目以降はキャッシュから（写真集一覧 3.9秒→0.12秒）、無効化するとトップ・ジャンル・写真集が作り直され、その次からまたキャッシュ。
- 本番（変更前）とローカル（変更後）の比較：トップ・ジャンル・写真集・作品ページ計30ページで title・description・robots・OG/Twitter・canonical・JSON-LD が一致。関連商品がある作品15ページ＋トップ＋写真集で楽天アフィリエイトリンク122件（URL・順序）が一致。GA4 タグも同じ。※ローカルは Upstash・TMDb の接続情報が無いため「人気商品・人気検索」と TMDb のジャンルを比較から除外。
- `revalidatePublicListings()` は Next.js の外（tsx で直接実行）でも例外を出さないことを確認。

### 注意点
- トップの「人気検索・人気商品」（Redis のクリック数）はクリックでは無効化しないため、最大1時間遅れる（商品の保存時は従来どおり即時）。
- 毎日の Cron（商品の自動更新・VOD）で書き込みがあると、その時点で1回作り直される（想定どおり）。
- 人物ページ・作品ページは引き続き毎回生成（④人物ページのキャッシュは保留）。

---

## Task 116：楽天商品の価格の分割自動更新 — 本番稼働前の最終準備（手動実行のみ・定期実行は無効のまま）

### 目的
Task 107〜113 の価格更新（GitHub Actions・OpenAI 不使用）を、既存の新商品の発見・AI判定・公開ページを変えずに、手動実行だけできる状態で公開できるようにする。

### 公開する範囲（以前の未公開機能とは切り分け。HEAD に「追加」する形）
- 新規：`src/lib/price-refresh.ts`・`src/lib/price-refresh-runner.ts`・`src/lib/rakuten-api-gate.ts`・`src/lib/price-freshness.ts`（`scripts/price-refresh/coverage.ts` の取得日時の基準日数に使う。公開ページでは未使用）・`scripts/price-refresh/*`（run・snapshot・backup・halt・coverage）・`.github/workflows/price-refresh.yml`・`docs/price-refresh-runbook.md`・テスト。
- `src/lib/product-store.ts`：価格更新専用の関数（productIdentityKey・PRICE_FIELD_KEYS・mergePriceFieldsOnly・getStoredCategoryRow・savePriceOnlyItems・applyPriceUpdates・applyPriceUpdatesToItems・listPersonsWithProducts）を追加するだけ。mergeProductItems・storeProducts 等の既存の関数は変えない。
- `src/db/write.ts`：`updateProductItemsOnly`（既存行の items・fetched_at だけを UPDATE。INSERT しない）を追加。
- `src/types/rakuten.ts`：`priceFetchedAt`（DB に保存）と表示用の `priceStale`・`priceDateLabel`（型だけ。公開ページでは未使用）を追加。
- `src/lib/rakuten.ts`：価格更新が楽天APIの共通の使用権（rakuten-api-gate）の中で呼んだときだけ、使用権を通して送る（1.1秒以上の間隔・2回目も 429 なら共通の停止を記録・停止中は送らず 429 扱い）。使用権の外（既存の商品の自動更新・管理画面・診断）は従来どおり（0.4秒間隔のプロセス内制御）で動作を変えない。
- 含めない：推し活お買い物診断、楽天クレジット、価格の取得日時の表示（商品カード・各ページ）、新商品の発見の変更（mergeProductItems の同一性チェック・手動判定の保護・AI判定の分離＝batch-processor・verdict-decision）、Vercel 用の `/api/cron/price-refresh`、U-NEXT 関連（別作業）。

### 作業中のコードの変更（両方に共通）
- `src/lib/price-refresh.ts`：カテゴリ検索を `withRakutenApiSession`（label `price-search:<カテゴリ>`）の中で行う。作業中の `src/lib/rakuten.ts` は既に使用権を持っていればそれを使う（二重に取らない）。
- `.github/workflows/price-refresh.yml`：リポジトリ変数 `PRICE_REFRESH_ENABLED` が `true` でないあいだは `full`（全件）を実行しない（最初のステップで失敗させる）。schedule は引き続きコメントで無効。
- `scripts/price-refresh/run.ts`：manual-test の人物は2人まで。本体（DB 接続）は環境変数・人物の確認後に読み込む（未設定時に接続エラーの詳細を出さず、足りない項目名だけ出す）。
- `docs/price-refresh-runbook.md`：上記に合わせて更新（全件の禁止、2人まで、実行時間帯の注意、表示は今回含めない、429 の扱い）。

### 検証（公開版：HEAD 445dce3 に上記だけを適用した作業ツリー）
- tsc OK、npm test 122ファイル・2,077件 OK（公開しない機能のテストは公開版から除外：新商品の発見の同一性チェック、商品カードの表示、Vercel 用ルート。共通の使用権のテストは価格更新の使用権の中で実行する形に変更。`rakuten-gate-scope.test.ts` を追加：使用権の外は Redis を使わず従来どおり、中では使用権を通し、2回目の 429 で共通の停止を記録し以後は送らない）、build OK（公開ページ・ルートの追加なし）。
- 価格更新の dry-run（成田凌）OK。manual-test の人数制限・人物未指定・環境変数不足は要約1行で終了。
- GitHub リポジトリは公開（public）→ GitHub Actions の標準ランナーは無料。Neon は 105MB、price_refresher ロール・トリガーは未作成（読み取りのみで確認）。

### 注意点
- 既存の商品の自動更新・管理画面は共通の使用権を使わないため、同じ時間に動くと合計で1秒1回を超えうる。手動テストは毎日 12:00〜12:10 頃（JST、既存の自動更新）を避け、実行中は同じ人物の管理画面での再取得・編集をしない。schedule は既存の自動更新と重ならない時刻。
- 価格更新を本番で動かしても、公開ページの表示は価格の値が変わるだけ（取得日時の表示は含めていない）。

---

## Task 118：価格更新 — 更新できなかった商品を管理画面で確認できるようにする（未commit・本番DB/Redis未変更）

### 目的
価格の自動更新（Task 107〜116、公開済み・手動実行のみ）について、価格を取得できなかった商品・カテゴリを管理画面から確認できるようにする（既存の価格更新の仕組みを再利用。新しい更新処理は作らない）。

### 変更
- `src/lib/price-refresh-runner.ts`：人物ごとの直近の結果（`PersonRefreshState.last`：更新件数・処理カテゴリ数・楽天から取得できなかったカテゴリと status／HTTP ステータス・コード指定の結果・完了・自動停止）を進み具合と同じ Redis のハッシュ（`price-refresh:state`）に保存。実行全体の要約を `price-refresh:last-run` に保存（ロック中・停止中で何もしなかった回は保存しない。保存に失敗しても価格更新の結果は変わらない）。`RunSummary.persons[].failedCategories` を追加。Redis のコマンドは1回の実行につき1つ増えるだけ。
- `scripts/price-refresh/run.ts`：取得できなかったカテゴリを HTTP ステータスごとに数えて出力（`failedCategories`、例 `{"503":1}`）。手動テストでは人物ごとの内訳も出し、あれば「先に進まず原因を確認」の警告を出す（商品名・URL・認証情報は出さない）。
- `src/lib/price-refresh-status.ts`（新規・読み取りのみ）：Redis の自動停止・ロック・直近の実行・人物ごとの直近の結果、DB 側で集計した公開中（判定 related）の商品の価格の取得状況（30日以内／古い／不明）、人物ごとの更新できていない商品と理由の目安（楽天の商品を特定できない／カテゴリ検索に出たときだけ更新／コード指定可）。
- `src/app/admin/price-refresh/page.tsx`（新規）：上記の表示ページ（管理画面のログインが必要。更新・停止の操作は置かない）。`src/app/admin/AdminLayoutClient.tsx` にメニュー「価格更新」を追加。
- `docs/price-refresh-runbook.md`：手動テストで `failedCategories` を確認する手順、管理画面での状況確認を追記。
- テスト：`price-refresh-runner.test.ts` に4件（503 の記録・途中停止時の記録・何もしなかった回は要約を上書きしない・自動停止の記録）、`price-refresh-status.test.ts`（Redis は読み取りコマンドだけ・理由の目安・公開中で古い／不明な商品だけを出す）。

### 検証
- tsc OK、npm test 130ファイル・2,208件 OK、build OK（`/admin/price-refresh` 追加）。
- 本番DBで集計を読み取りのみ実行：公開中の商品 40,437件（353人）すべて取得日時不明（価格更新は未実行のため）、0.75秒。成田凌の更新できていない公開中の商品 6件（コード指定可3・検索に出たときだけ3）、賀喜遥香 441件。
- ローカルの `next start` で管理画面のログイン情報を付けて表示を確認（一覧・人物の詳細とも 200、ログイン情報なしはログイン画面へ）。ローカルは Upstash の接続情報が無いため「実行の状態」は本番でのみ表示。

### 注意点
- 管理画面の集計は全商品の JSON を DB 側で展開する（約0.75秒・転送約24KB）。表示のたびに実行されるため、頻繁な再読み込みは避ける。
- `AdminLayoutClient.tsx` は別作業（U-NEXT）の未公開の変更と同じファイル。公開時はメニュー1行だけを切り出す。

---

## Task 119：価格更新 — 楽天のエラーが続いたらその回を安全に終える（未commit・本番DB/Redis未変更）

### 目的
429 以外の楽天のエラー（503 等）・通信エラー・保存の失敗が続いたときに、無駄な呼び出しを続けず、その回を安全に終えて原因と位置を記録する。

### 変更
- `src/lib/price-refresh-runner.ts`：`MAX_CONSECUTIVE_FAILURES = 3`。カテゴリ検索で取得できなかったカテゴリ（fetch_failed：503 等・通信エラー／db_error）が人物をまたいで3回続いたら `stoppedBy: 'upstream_errors'` で終了（取得できたカテゴリ・商品があれば数え直す）。429 は従来どおり1回で終了。終了時は `stopDetail`（人物・カテゴリ・直近のエラー〔例「本・雑誌: 503」〕）を実行結果・人物の直近の結果（`last.stop`）・実行の要約（`price-refresh:last-run`）に記録。429・エラーの連続で終える場合は、失敗したカテゴリから次回取り直す（進み具合を進めない）。コード指定の取得にも同じ上限を渡す。
- `src/lib/price-refresh.ts`：コード指定の取得で 503 等・通信エラーが3回続いたら `stoppedBy: 'upstream_errors'`（`errors` に直近のステータス）で終了。取得できれば数え直す。取得できなかった商品は変更しない（従来どおり）。
- `scripts/price-refresh/run.ts`：要約に `stopDetail` を出し、エラーの連続で終えた回は警告を出して終了コード1（Actions の失敗通知）。
- `src/app/admin/price-refresh/page.tsx`：直近の実行に「楽天のエラーで終えた位置」、人物の行に「◯◯で終了」を表示。
- `docs/price-refresh-runbook.md`：エラーの連続での終了と、手動テストでの `stopDetail` の確認を追記。
- テスト：runner 5件（人物をまたぐ3回で終了・位置と原因・取り直し位置、途中の成功で数え直し、保存失敗・通信エラーも数える、429 の取り直し位置、コード指定での終了）、price-refresh 2件（コード指定の 503×3 で終了し価格は不変、途中の成功で数え直し）。

### 注意点
- 1カテゴリの検索は複数回のリクエストを含むため、「3回」はカテゴリ（またはコード指定の商品）単位で数える。
- 取得できなかった商品の価格・取得日時は従来どおり変更しない。

---

## Task 121：Neon 適用前の最終確認 — 価格更新で変えるのを price・priceFetchedAt だけに限定、トリガーで価格の値も検査、パスワードをハッシュで指定（未commit・本番DB未変更）

### 目的
「価格更新専用ユーザーは既存商品の price と取得日時以外を変更できない」ことを、コード・自動停止の比較・DB の保護トリガーで揃えて保証する。パスワードを Git・ログ・Neon の SQL Editor の履歴に出さない。

### 変更
- 価格更新で変更する項目を `price`・`priceFetchedAt` だけに（従来は reviewCount・reviewAverage も更新していた。レビュー数・平均は人物ページの自動の並び順〔レビュー数×平均〕と星の表示に使われるため、価格更新では変えない）：`src/lib/product-store.ts`（`PRICE_FIELD_KEYS`・`applyPriceFields`・`mergePriceFieldsOnly`）、`src/lib/price-refresh.ts`（コード指定の反映・キャッシュ）、`src/lib/price-refresh-runner.ts`（自動停止の指紋はレビューも「価格以外」として比較）、`scripts/price-refresh/snapshot.ts`（前後比較もレビューを保護対象に）。新商品の発見（neondb_owner の保存）では従来どおりレビューも更新される。
- 保護トリガー（`docs/price-refresh-runbook.md` の SQL）：`price_keys` を `price`・`priceFetchedAt` の2つに。さらに、変更する場合は price は正の数値、priceFetchedAt は数値だけ（消す・文字列・null・0以下は拒否。元の値をそのまま残す場合は検査しない）。
- `scripts/price-refresh/make-role-password.py`（新規・標準ライブラリのみ）：256ビットのパスワードを作り、画面に出さずに `.env.price-refresh.local`（Git 管理外・権限600）へ価格更新専用ユーザーの接続文字列を保存。Neon に貼る SQL を `tmp/price-refresh-role.sql`（Git 管理外・権限600）に書き出す。パスワードは PostgreSQL 標準の SCRAM-SHA-256 のハッシュで指定するため、SQL Editor の履歴にも平文は残らない（ハッシュが使えない場合の予備として平文版 `tmp/price-refresh-role.plain.sql` も作る。使わなければ消す）。既存のファイルは上書きしない。
- テスト：価格更新でレビュー数・平均を変えないこと（カテゴリ検索・手動登録の商品）に期待値を変更。

### 検証
- npm test 130ファイル・2,215件 OK、tsc OK。
- スクリプトのハッシュ計算は PostgreSQL 自身が作るハッシュと一致（同じ salt で比較）。ハッシュ指定の CREATE ROLE はそのまま保存される。ダミーの .env.local で全体を実行し、権限600・平文の表示なし・owner のパスワードを含まない・2回目は上書きせず終了を確認。
- 本番と同じ構成の検証環境（Task 120 と同じ方法）で、更新後の SQL をハッシュ指定のパスワードで適用：60/60。追加分：既存（owner）によるレビュー数・平均の変更は成功、価格更新ユーザーによるレビュー数・平均の変更・price の削除・文字列・0・マイナス・null・priceFetchedAt の文字列化・削除はすべてトリガーが拒否、拒否後のデータは不変。owner の92件の保存はトリガー込み 5ms。

---

## Task 125：価格更新 — related の商品だけを更新、30%以上の変動は確認対象に（未commit・本番DB/Redis 未変更）

### 目的
成田凌の manual-test の前に、(1) 判定が unrelated・判定なしの商品を価格更新の対象から外す、(2) 前回の価格から30%以上変わる取得価格を自動で反映せず確認対象にする。判定・表示設定・並び順は変えない。

### 変更
- `src/lib/product-store.ts`：`PRICE_REVIEW_CHANGE_RATE = 0.3`、`priceChangeReview()`（前回の価格から30%以上〔整数で比較〕、または前回の価格が無い・0以下なら確認対象。商品ID・変更前の価格・取得した価格・変動率・理由）。`mergePriceFieldsOnly` に `eligibleIds`（related の商品ID）を追加し、対象外は変更しない（`notEligible`）、30%以上は反映せず `reviews` に入れる。`applyPriceUpdatesToItems`・`applyPriceUpdates`（コード指定）も30%以上は反映せず `reviews` を返す。
- `src/lib/price-refresh.ts`：`refreshPersonPrices` に `eligibleIds`（related の商品が無いカテゴリは楽天APIを呼ばず `no_eligible`）。カテゴリの結果・全体の結果・コード指定の結果に `reviews`、カテゴリの結果に `notEligible`。
- `src/lib/price-refresh-runner.ts`：人物ごとに判定が related の商品IDを1回読み、カテゴリ検索とコード指定の両方に使う。確認対象を `RunSummary.persons[].priceReviews`、人物の直近の結果 `last.priceReviews`（最大50件）・`last.notEligible`、実行の要約 `priceReviews`（件数）に記録。
- `scripts/price-refresh/run.ts`：要約に `priceReviews`（件数）、手動テストでは確認対象ごとに `priceReview`（人物・カテゴリ・商品ID・変更前の価格・取得した価格・変動率％・理由）を出力。
- `src/app/admin/price-refresh/page.tsx`：「価格の確認待ち（自動で更新しなかった商品）」の表（人物・カテゴリ・商品ID・変更前の価格・取得した価格・変動率・理由・日時）、人物の行に「確認待ち N」。
- `docs/price-refresh-runbook.md`：変わる項目の説明を更新。
- テスト：既存の価格更新のテストで30%以上の変化を使っていた値を30%未満に変更（目的は価格以外を変えないことの確認のため）。追加：30%の境界（±29.9% は反映、±30% は確認対象、前回の価格なし）、43,027円→28,059円の中古商品が確認対象として価格・取得日時・他の項目とも不変で保存もしない、related でない商品は結果に含まれても不変、related の無いカテゴリは楽天APIを呼ばない、カテゴリ行の fetched_at が新しくなっても確認対象は次回も確認されコード指定の候補に残る、API エラー時は価格を保持、コード指定でも30%以上は反映しない、runner が related の商品IDを渡し確認対象を記録（上限50件）。

### 注意点
- カテゴリ行の `fetched_at` は、そのカテゴリで1件以上反映したときだけ新しくなる。価格更新は毎回すべてのカテゴリを検索し、コード指定の候補は商品ごとの `priceFetchedAt` で選ぶため、行の `fetched_at` は確認対象・取得失敗の商品の再確認を妨げない（新商品の発見・公開サイトもこの値を使っていない）。
- 確認対象の商品は、自動では反映されない（価格の変動が続く限り毎回確認対象になる）。反映の方法（管理画面からの承認等）は今回は用意していない。

---

## Task 126：価格更新 — DB 読み込みの削減と1回の処理量の上限（未commit・本番DB/Redis 未変更）

### 調査（変更前の1人あたりの DB 読み込み）
指紋（DB 側で計算・小）×2、related の商品ID（小）、**人物の全カテゴリの全商品**（カテゴリに商品があるかの判定だけに使用）、カテゴリごとの保存直前の行の読み直し（反映に必要）、**コード指定の候補選びのための人物の全商品（2回目）**、コード指定の反映直前の行の読み直し（必要）。dry-run の見積もりも人物ごとに全商品を読んでいた。

### 変更
- `src/lib/price-refresh-io.ts`（新規）：DB から読んだ行数・量（JSON の長さ）の数え上げ（プロセス内のみ）。
- `src/lib/rakuten-api-gate.ts`：共通の使用権を通した楽天APIの呼び出し回数を数える `rakutenApiCallCount()`（表示用の数え上げだけ。呼び出しの制御は不変）。
- `src/lib/price-refresh-runner.ts`：
  - `categorySummaryFromDb`：カテゴリごとの商品数と related の数を DB 側で数える（商品の中身は読まない）。人物の全商品の読み込みを置き換え。
  - `lookupItemsFromDb`：related・取得日時が無い／古い・楽天ブックス（books.rakuten.co.jp/rb、または item.rakuten.co.jp/book）か楽天市場の数字の itemCode を持つ商品だけを、従来の候補の順（取得日時の古い順→カテゴリの順→保存の順）で上限まで読む（足りなければ続きを読む）。最終的な候補は従来どおり `selectLookupCandidates`（lookupCodeOf）で決める。人物の全商品の2回目の読み込みを置き換え。
  - 1回の上限：`maxApiCalls`（次のカテゴリで最大12回使いうるなら始めない。コード指定は残りの回数まで）、`maxCategories`（楽天を検索するカテゴリ数）、既存の `maxPersons`。上限に達したら `stoppedBy: 'max_api_calls' | 'max_categories' | 'max_persons'` で終了し、進み具合（nextCategory・コード指定の途中）は従来どおり保存して次回続きから。
  - 使った量：人物ごと（`last.usage`）・実行ごと（`RunSummary.usage`・実行の要約）に、楽天APIの呼び出し回数・DB から読んだ行数・量。
  - dry-run の見積もり（`planPriceRefresh`）は `lightItemsFromDb`（ID・商品ページURL・アフィリエイトURL・itemCode・取得日時だけ）を使う。
- `src/lib/price-refresh.ts`：`refreshPersonPrices` に `summary`（カテゴリの要約）を追加。要約があれば人物の全商品は読まない。保存直前の行の読み込み量を数える。
- `src/lib/product-store.ts`：`applyPriceUpdates` の行の読み込み量を数える（1行の追加のみ）。
- `scripts/price-refresh/run.ts`：上限を環境変数で設定（`PRICE_REFRESH_MAX_PERSONS` 既定30・`PRICE_REFRESH_MAX_API_CALLS` 既定800・`PRICE_REFRESH_MAX_CATEGORIES` 既定200。上限・下限つき）。開始時に上限、終了時に使った量（API 回数・DB の行数・量 KB）を出力。手動テストでは人物ごとの使った量も出力。
- `src/app/admin/price-refresh/page.tsx`：直近の実行に「使った量」、人物の行に API 回数・DB の量。
- テスト：runner 5件（全商品を読まない、API 回数の上限で止まり次回は止まったカテゴリから、カテゴリ数の上限、対象の無いカテゴリは数えない、コード指定が上限で途中なら未完了）、price-refresh 1件（要約があれば読む商品の行は保存直前の1行だけ）。既存のテストの DB の偽物に `query` を追加、dry-run のテストに軽い読み込みを渡す。

### 検証（本番DBを読み取りのみ）
- 71人（成田凌・賀喜遥香・商品の多い15人・無作為の60人）で、新しい方法のコード指定の候補（順序まで）が従来と 71/71 一致、カテゴリの要約が 71/71 一致、dry-run の見積もりが完全に一致。※最初は item.rakuten.co.jp/book の楽天ブックスを絞り込みで落として3人で不一致 → 条件を修正して一致。
- 人物ごとの読み込み量（保存直前の行の読み直しは前後で同じなので除く）：71人で 32.3MB → 3.3MB（-90%）。dry-run の見積もり：16.1MB → 7.8MB（-52%）。全員1回の全商品は 51.6MB、軽い項目は 28.1MB。
- tsc OK、npm test 132ファイル・2,244件 OK、dry-run（成田凌・賀喜遥香）OK。

### 追加：dry-run の出力（GitHub Actions の dry-run で確認できるように。すべて読み取りのみ）
- `limits`：1回の上限の設定値（dry-run でも出力）。
- `usage`：dry-run で使った量（楽天APIは呼ばないので 0回、DB の行数・量 KB）。
- `estimate`：実際に更新するときの楽天APIの回数の見込み（カテゴリ検索 3〜12回/カテゴリ＋コード指定の候補）と、上限に対して何回の実行に分かれるか。
- `progress`（Redis 設定時）：対象人物ごとの進み具合を `HMGET price-refresh:state` で読む（never_run／in_progress＋続きのカテゴリ／completed、直近の結果の API・DB の量、確認待ち・取得失敗の数、自動停止の有無）。Redis へのコマンドは GET・EXISTS・HMGET のみ（偽の Upstash で確認）。
- `src/lib/price-refresh-runner.ts`：表示用に `CATEGORIES_ORDER`（nextCategory の添字の順）を export。

## Task 127：価格の確認待ちの承認・却下（管理画面 /admin/price-refresh）（未commit・本番DB/Redis 未変更・マイグレーション未適用）

### 目的
30%以上の価格変動などで自動更新しなかった商品を、管理画面から個別に承認（価格を反映）・却下（反映しない）できるようにする。確認待ちを DB に永続化し、次の実行で消えないようにする。

### 調査（変更前）
- 確認待ちは Redis の人物ごとの直近の結果（`price-refresh:state` の `last.priceReviews`、最大50件）にだけあり、次にその人物を処理すると上書きされていた（途中で止まると消える）。
- 価格更新は GitHub Actions で price_refresher（products の items・fetched_at の UPDATE のみ・トリガーで price/priceFetchedAt 以外の変更を拒否）として実行。管理画面は既存サイトの接続（neondb_owner）。
- 管理者認証は proxy.ts（/api/admin はセッション Cookie〔HMAC 署名〕と書き込み時の Origin を確認）。管理者は共有パスワードの1種類のため、操作者は名前の入力で記録する（U-NEXT の確認承認と同じ方式）。

### 変更
- `drizzle/0020_price_reviews.sql`（新規）・`src/db/schema.ts`・`src/app/api/admin/db-init/route.ts`：テーブル `price_reviews`（変更案。人物・カテゴリ・商品ID・変更前の価格・取得した価格の組で一意。status: pending／approved／rejected／superseded／stale）と `price_review_logs`（承認・却下・反映せずの履歴。追記のみ）を追加のみ。既存テーブル・権限の変更なし。
- `src/lib/price-refresh-runner.ts`：確認待ちに楽天から価格を取得した日時（`fetchedAt`）を付け、Redis の受け取り箱 `price-refresh:review-inbox`（上限5000項目・1人1回200件）にも書く（失敗しても価格更新は続ける）。価格の判定・30%のルール・related のみ・上限・中断・再開は不変。
- `src/lib/price-review-store.ts`（新規）：取り込み（Redis → DB、1トランザクション、取り込めたら受け取り箱の項目だけ消す。保存されていない商品は取り込まない）、一覧（ページ分割・現在の保存価格・承認できない理由）、履歴、承認・却下。
  - 承認：Serializable の1トランザクションで (1) 確認待ちを承認済み（確認待ちのまま・画面の価格と一致・14日以内・商品の条件を満たすときだけ）(2) 商品の該当要素の `price`・`priceFetchedAt` だけを `jsonb_set` で更新 (3) 商品が更新されていなければ 0 除算で全体を取り消す (4) 履歴。商品の条件：同じIDがカテゴリ内に1件だけ・保存済みの価格が変更前の価格のまま・商品ページURL/アフィリエイトURL/itemCode が検出時と同じ・判定 related。満たさなければ stale にして履歴に「反映せず」と理由。
  - 却下：確認待ちを却下済み＋履歴（商品は変えない）。同じ組は再取り込みでも却下のまま。別の組は新しい確認待ち（同じ商品の古い確認待ちは superseded）。
  - 二重操作は状態の条件（pending のときだけ）で1回だけ。同時操作の競合（40001）は「中止（何も変更していない）」。
- `src/app/api/admin/price-review/route.ts`（新規）：POST。proxy に加えて処理内でもセッションと Origin を確認。入力（ID・価格は整数・範囲、操作者名1〜50文字）をサーバー側で検証。価格更新の実行中（Redis のロック）は承認しない（423）。エラー文は返さない。承認後は人物ページを再検証。
- `src/app/admin/price-refresh/page.tsx`・`PriceReviewQueue.tsx`（新規）：確認待ち（人物・カテゴリ・商品名・商品ID・保存中の価格・取得した価格・変動額と率・理由・取得日時・承認／却下）をページ分割（30件）で表示。承認（緑の塗り）と却下（赤の枠線）を区別し、確認ダイアログで変更前後の価格を表示。結果を成功・失敗で表示。スマートフォンはカード表示。「承認・却下の履歴」タブ。
- `docs/price-refresh-runbook.md`：「8. 価格の確認待ちの承認・却下」。
- テスト：`price-review-store.test.ts`（隔離した Postgres〔PGlite・メモリ上〕で SQL を実行。PGlite が無い環境では DB のテストを飛ばす）、`price-review-route.test.ts`（認証・Origin・入力・実行中・エラー文・表示）、runner のテストに受け取り箱の2件。

### 注意
- 本番の準備：`/admin/db-init` でテーブル作成が必要（未作成でも価格更新・管理画面の他の表示は動く）。
- 管理画面を開くと Redis の確認待ちを DB に取り込む（書き込みは price_reviews と受け取り箱の削除だけ）。
- 承認と、既存の商品の自動更新（/api/cron/refresh）・管理画面の商品編集が同じカテゴリで同時に起きた場合、後から保存した側が items 全体を上書きしうる（既存の仕組みの性質）。価格更新（price-refresh）の実行中は承認しない。
- PGlite はリポジトリの依存に入れていない（`npm i --no-save @electric-sql/pglite@0.2.17` で DB のテストを実行）。

## Task 128：価格の確認待ち — 商品データの同時更新で上書きしない・画面の表示を読み取りのみに（未commit・本番DB/Redis 未変更・マイグレーション未適用）

### 目的
Task 127 の承認と、既存の商品の書き込み（新商品の発見・管理画面の編集など）が重なったときに、古い items で上書きして変更が失われないようにする。管理画面を開くだけで DB に書き込む仕組みをやめる。受け取り箱の上限で確認待ちが失われないようにする。

### 調査（既存の商品の書き込み経路）
すべて「行を読む → items を作り直す → 行ごと保存」で、読んでから保存までの間の他の更新を上書きしていた（後から保存した側の勝ち）。
- `storeProducts`（定期の新商品の発見 batch-processor・管理画面の再取得）、`appendProductToCategory`・`updateProductInCategory`（管理画面の手動登録・編集 product-manual）、`/api/admin/product-recovery`（復旧）→ `upsertProduct`
- 価格更新：`savePriceOnlyItems`（カテゴリ検索）・`applyPriceUpdates`（コード指定）→ `updateProductItemsOnly`
- `storeProducts` は既存行の読み取りに失敗すると、既存の商品を読まずに新しい商品だけで保存していた（既存の商品が消えうる）
- 既に対策済み：`scripts/manual-affiliate-url-fix/run.ts`（items が読んだ値と一致するときだけ UPDATE）、商品ID移行（行単位の楽観ロック）。対象外：`scripts/price-refresh/backup.ts restore`（意図的に戻す操作）
- 商品の削除は判定（verdicts）の変更で、products は書かない

### 変更
- `src/lib/product-write-guard.ts`（新規）：`ProductWriteConflictError`・`retryOnProductWriteConflict`（同時更新で書けなければ最新の行を読み直して作り直す。最大4回、少し待つ。それでも書けなければエラー＝保存しない）。
- `src/db/write.ts`：`upsertProduct`・`updateProductItemsOnly` に guard（読んだ時点の items）を追加。指定すると `items = 読んだ items` の場合だけ書く（null は「行が無い場合だけ INSERT」）。一致しなければ何も書かずに `ProductWriteConflictError`。guard なしは従来どおり。スキーマ・権限の変更なし（price_refresher は products の SELECT 権限を既に持つ）。
- `src/lib/product-store.ts`：`storeProducts`・`appendProductToCategory`・`updateProductInCategory`・`applyPriceUpdates` を「読む→作る→guard つきで保存」の再試行で包む。`updateProductInCategory` は読んだ items を直接書き換えずコピーを編集。`savePriceOnlyItems` に読んだ items（expectedItems）を追加。`storeProducts` の読み取り失敗時は「行が無い場合だけ保存」（既存の行があれば保存せず読み直す）。マージの内容・並び・判定の扱いは不変。
- `src/lib/price-refresh.ts`：カテゴリ検索の保存を、読む→価格の項目だけ反映→guard つきで保存、の再試行で包む（何度も重なれば従来どおり db_error で保存済みの商品は不変）。
- `src/app/api/admin/product-recovery/route.ts`：カテゴリごとの読む→追記→保存を再試行で包み、guard つきで保存（既存の文字化けしたコメント行はそのまま）。
- 価格の承認（`price-review-store.ts`）は DB の中で該当商品の price・priceFetchedAt だけを `jsonb_set` で変える（読んで書き戻さない）ため、他の更新と重なっても両方残る。価格更新の実行中の承認の禁止（423）は不要になったため削除。
- 画面の表示を読み取りのみに：`page.tsx` から取り込みを削除。未取り込みの件数（HLEN）・追加できなかった数（GET）を表示し、「取り込む」ボタン（`PriceReviewSyncButton`）で `/api/admin/price-review` に `{ action: 'sync' }` を POST。承認・却下の POST でも先に取り込む。
- 受け取り箱：上限を 5,000 → 20,000 件（約300バイト/件）。同じ組は上書きで数を増やさない。満杯なら新しい組は追加せず `price-refresh:review-inbox-dropped` に数え、管理画面に警告。取り込み後の削除は、読んだ値のままの項目だけ（Lua で HGET を比べてから HDEL。取り込み中に価格更新が書き直した項目は残る）。
- `docs/price-refresh-runbook.md` の 8 を更新。
- テスト：`product-write-guard.test.ts`（隔離した Postgres で、発見×管理画面の編集、発見×承認、編集×承認、手動登録×手動登録、コード指定×編集、カテゴリ検索の保存、重なり続けたら保存しない、実際の承認が発見の途中に入っても残る、等 13件）、`price-review-inbox.test.ts`（受け取り箱の上限と数え上げ 3件）、`price-review-page.test.ts`（GET の表示で DB は SELECT だけ・Redis は HLEN/GET だけ 3件）、`price-review-store.test.ts`（取り込み中に書き直された項目を消さない、表示の SQL が読み取り専用のトランザクションで動く 等）、`price-review-route.test.ts`（取り込みの POST）、`data-protection.test.ts` の3件の期待値に guard を追加。

### 注意
- 同時更新が続いて4回とも保存できなかった場合はエラーになる（定期の発見は次回、管理画面はエラー表示で再操作）。どちらの場合も他の更新は消えない。
- guard の比較は items 全体の一致（jsonb の比較）。書き込み時に読んだ items も送るため、1回の書き込みの送信量は約2倍（Neon の課金対象の転送量〔DB からの送信〕は増えない）。

## Task 129：価格の確認待ち — 本番反映前の確認と、2テーブルだけを作る手順（未commit・本番DB/Redis 未変更・マイグレーション未適用）

### 確認（本番DBは読み取り専用のトランザクションでカタログだけを読む）
- `/admin/db-init`（POST）は CREATE TABLE 23・CREATE INDEX 32・ADD COLUMN 79 の全文を毎回実行する（トランザクションなし・エラーは記録だけ）。公開予定のコード（HEAD＋今回）で実行した場合に本番で新たに作られるのは price_reviews・price_review_logs と3インデックスだけ（他の文は本番に既にあり何もしない）。U-NEXT の4テーブルは未commit の作業ツリーにしか無く、公開内容に含まれないため作られない。
- ただし db-init の ALTER TABLE は、何も変えない場合も既存テーブル（persons・works・verdicts 等）に一時的なロックを取る。→ 今回は db-init を使わず、専用の手順で2テーブルだけを作る。
- 商品の行の最大は約0.97MB（2,160行、99%点 約150KB）。同時更新の防止で書き込み時に読んだ items も送るため最大約2MB/回。

### 変更
- `scripts/price-review/setup-tables-core.ts`・`setup-tables.ts`（新規）：check（読み取りのみ）／apply（「APPLY」入力時のみ。drizzle/0020 の5文だけを1トランザクション。2テーブルの CREATE TABLE/INDEX IF NOT EXISTS 以外が1文でもあれば拒否）／verify／undo（2テーブルが空のときだけ DROP）。作成の前後で products・verdicts の指紋（DB 側の md5）が同じことを確認。エラー文は出さない（種類とコードだけ）。
- `docs/price-refresh-runbook.md` の 8 の「本番の準備」を、この手順に変更。
- テスト：`price-review-setup-tables.test.ts`（隔離した Postgres で、2テーブル・3インデックスだけ作る・2回実行しても同じ・既存データの指紋が同じ・途中で失敗したら何も作らない・空でなければ取り消さない・想定外の文やテーブルで止める 11件）。
- 本番で `check` を実行（読み取りのみ）：2テーブル・3インデックスとも未作成、products 2,160 行・verdicts 87,141 行、問題なし。

### 本番反映（2026-10-22 19:32 JST）
- ユーザーが Neon で本番ブランチのスナップショットを作成したことを確認してから実行。
- `setup-tables.ts check`（問題なし）→ `apply`：price_reviews・price_review_logs と3インデックスを作成（1トランザクション）。作成の前後で products 2,160 行・verdicts 87,141 行の指紋が同じ（既存データは不変）。`verify` OK。本番のカタログで、他のテーブル・列・インデックスの追加なし、U-NEXT の4テーブルは未作成のまま。/admin/db-init は未使用。
- PRICE_REFRESH_ENABLED=false のまま。承認・却下・価格の変更は未実行。

## Task 130：価格の確認待ち — 承認の検証と、承認できる期限の境目の統一（未commit・本番DB/Redis 未変更）

### 検証（本番は変更せず）
- 隔離した Postgres（PGlite）で承認・却下・二重承認・同時操作・期限・同時更新・履歴・途中のエラーを確認（すべて成功）。
- 本番の「成田凌」の商品行・判定・手動並び順を読み取り専用で読み、メモリ上の Postgres に写してリハーサル：承認で変わったのは対象商品の price・priceFetchedAt だけ、却下は不変、2回目の承認は already_decided、履歴あり。
- 期限の境目が「14日ちょうどは承認できる」だったため、ルール（14日以上は承認不可）に合わせて統一。

### 変更
- `src/lib/price-review-store.ts`：`priceReviewCutoffMs`・`isPriceReviewExpired`（取得日時 ≦ 現在−14日 なら期限切れ）を追加し、一覧の表示（blocker 'expired'）・承認前の確認・承認の SQL（`fetched_at_ms > 期限`）の3か所を同じ境目に。メッセージを「取得から14日以上経った価格」に。
- `src/app/admin/price-refresh/page.tsx`・`docs/price-refresh-runbook.md`：説明の文言を同じルールに。
- テスト（`price-review-store.test.ts`）：境目（14日を超えた・14日ちょうど＝承認不可で何も変わらない／14日に1ミリ秒足りない＝承認可）を一覧と承認の両方で確認、承認の SQL 単体でも同じ境目、`isPriceReviewExpired`。前回追加した、書き込むテーブルの検査・同時に2回の承認のテストを含む。

## Task 131：価格更新 — 楽天ブックスの商品のコード指定を楽天ブックス総合検索APIに（未commit・本番DB/Redis 未変更）

### 背景（調査）
- 楽天ブックスの商品のコード指定は、楽天市場商品検索APIに itemCode=book:<番号> を渡していたが、楽天ブックスの商品は返らず常に0件（販売中の商品でも）。related 40,459件のうち 34,771件（85.9%）が楽天ブックスで、カテゴリ検索に出なければ価格を更新できなかった。
- 楽天ブックスAPI（総合・書籍・CD・DVD、2017-04-04）は商品番号で検索できない（商品番号は itemUrl の中だけ）。総合検索APIを商品名で検索し、itemUrl の商品番号が完全一致する結果だけを使う方式を読み取り専用で検証：上白石萌歌の5件＋対照2件はすべて一致、無作為50件で49件一致（ISBN/JAN もすべて取得でき、ISBN/JAN での再検索は同じ商品番号の1件だけ）。一致した49件中38件は他の候補（別の版など）も返ったため、完全一致の確認が必須。
- availability が空の商品は outOfStockFlag=0 では返らない（＝購入できない）ことを確認。
- ローカルで楽天のカテゴリ検索が 503（Authentication service error）になるのは、NEXT_PUBLIC_SITE_URL 未設定で Origin が http://localhost:3000 になるため（本番・Actions は登録ドメイン）。

### 変更
- `src/lib/price-refresh.ts`（コード指定の楽天ブックス部分だけ）：
  - `booksSearchKeyword`：保存中の商品名から検索語（【】[]（）の補足・記号を除き、最大4語・40文字）。作れなければ API を呼ばず変更しない。
  - `matchBooksResult`：結果の itemUrl の商品番号が保存中の商品と完全一致したものだけ。0件＝not_found、同じ番号なし＝mismatched、在庫状況が 1〜5（在庫あり〜予約受付中）以外（空＝品切れ・販売終了、6＝メーカーに在庫確認）や価格なし＝unavailable。いずれも価格・取得日時を変えない。
  - `lookupPricesByCode`：book: のコードは楽天ブックス総合検索API（keyword・hits=30・outOfStockFlag=1・elements=itemUrl,itemPrice,availability）。429・503・通信エラーの扱い・共通の呼び出し制御（1.1秒間隔・429で停止）・同じ実行内の重複排除は従来どおり。取得できなかった結果も共有キャッシュ（Redis・期限3日）に status つきで残し、期限内は他の人物の同じ商品で API を呼ばない。楽天市場の itemCode 指定・カテゴリ検索・30%以上の確認待ち・related のみ・保存時の同時更新の防止・上限・中断・再開は不変。
  - `LookupResult.unavailable`（購入できず反映しなかった件数）を追加。
- `src/lib/price-refresh-runner.ts`：人物の直近の結果のコード指定の要約に unavailable を追加。
- テスト：`price-refresh-books-lookup.test.ts`（新規 20件：検索語、完全一致・別の版は不採用・0件・品切れ・在庫確認・価格なし、総合検索APIへの要求、誤照合しない、品切れは変えない、30%以上は確認待ち、429・503、検索語なし、取得できなかった結果のキャッシュ、楽天市場は従来どおり）。`price-refresh.test.ts` の楽天ブックスのコード指定のテストの偽の応答を、楽天ブックス総合検索APIの形に変更（5件）。

### 検証（読み取りのみ・本番DB/Redis 未変更）
- 実装の関数と同じ要求で：上白石萌歌の5件は、ソロモンの偽証 13,376円（保存 12,505円・在庫あり）・虹とシマウマ 2,803円（取り寄せ）の2件が更新対象、3件は販売終了（空）で変更しない。対照の2件は1件更新対象・1件販売終了。無作為50件：一致して購入可 29・販売終了 20・同じ番号なし 1（誤照合 0）。価格が変わる 17件、30%以上は 0件。
- ローカルの dry-run（上白石萌歌・井口眞緒・佐藤優羽）：コード指定の候補 22件、楽天API の見込み 58〜166回。

### 将来の改善点（今回は変更しない）
- 販売終了・品切れの商品の扱いが、カテゴリ検索とコード指定で異なる。カテゴリ検索（`refreshPersonPrices`・楽天ブックスは outOfStockFlag=1）は販売終了の商品も検索結果の価格で更新する（例：上白石萌歌の「まばたき」は availability が空＝販売終了だが、2026-10-22 の manual-test でカテゴリ検索により価格の取得日時が付いた）。一方、コード指定は availability が 1〜5 の商品だけを更新する。揃える場合は、カテゴリ検索でも在庫状況を見て、購入できない商品の価格を更新しない（または表示側で区別する）変更を別途検討する。
- availability 6（メーカーに在庫確認）は購入できると確認できないため反映していない。必要なら購入可能に含めるか検討する。
- 同じ商品番号が見つからない約2%は、検索語に人物名を加えた再検索（Step 2）で減らせる見込み。

## Task 132：推し活お買い物診断（/oshi-shopping）— 公開準備（判定が不確かな商品・価格の確認待ち・販売終了の除外、古い価格を表示しない）（未commit・本番DB/Redis 未変更）

### 調査
- 実装（Task 101〜105）は完成済みで未commit。公開に必要なファイル：診断のページ・部品・ライブラリ・テスト、`src/lib/rakuten-credit.ts`（未追跡）と `src/app/layout.tsx` のフッターのクレジット、`src/lib/rakuten-click-track.ts`（一般商品はランキングに数えない）、`src/components/ProductCard.tsx`（priceStale の表示。priceStale を付けないページは表示が変わらない）。最新の commit にこれだけを足した状態で tsc・テスト・build が通ることを確認（トップ・人物ページの未commit の変更〔U-NEXT・価格の古さ表示〕は不要）。
- 旧商品IDの重複（グッズ＋中古の257組・162人）：判定が商品ID単位のため、どちらの商品の判定か分からない。診断はグッズを対象にするため混入しうる。
- 価格：診断は保存中の価格を表示していた（price-freshness の既定 legacy では取得日時不明の価格も表示）。取得日時があるのは価格更新を試した人物だけで、ほとんどの人物は全商品が取得日時不明。

### 変更
- `src/lib/oshi-shopping/core.ts`：`ambiguousProductIds`（同じ人物で同じIDが別の商品〔同一性キーが違う〕に付いている）を除外。`priceReviewIds`（価格の確認待ち）・`unavailableIds`（価格更新が楽天ブックスで品切れ・販売終了を確認）を除外。価格の表示は strict（取得から30日以内の価格だけ「M/D時点」つきで表示、取得日時不明・古い価格は「価格は楽天で確認」）。予算の判定は保存中の価格。除外件数を `excluded` で返す（表示には使わない）。判定・商品データは変更しない。
- `src/lib/oshi-shopping/data.ts`：確認待ち（`price_reviews` の pending、読み取りのみ。読めなければ除外なし）と、価格更新の共有キャッシュ（Redis `price-lookup:book:*` の status=unavailable、MGET 読み取りのみ。読めなければ除外なし）を読む。選定結果のキャッシュの版を 2 に。
- `src/app/oshi-shopping/page.tsx`：関連商品欄の説明に、関連の確認が不確かな商品・販売終了を確認した商品を除いていること、価格の扱い（取得時点・30日超／不明は非表示・予算は取得時点の価格で判定・最新は楽天で確認）を追記。
- テスト：`oshi-shopping-core.test.ts` +4（旧IDの重複は除外・同じ商品の複数カテゴリは除外しない・確認待ち／販売終了の除外・価格の表示と予算）、`oshi-shopping-data.test.ts`（新規2：読み取りだけで除外・読めない場合も従来どおり）。

### 検証（本番DBは読み取りのみ）
- 実データ（旧IDの重複が多い3人・上白石萌歌・井口眞緒 × 用途4 × 予算5）：表示した商品はすべて related・判定が不確かな商品なし・楽天のリンクのみ・予算内。重複の除外：河田陽菜6・小坂菜緒6・佐々木久美5・井口眞緒1。価格更新をしていない人物は表示した価格がすべて「価格は楽天で確認」。
- ローカルの本番ビルド（最新の commit＋公開対象のファイルのみ）と Playwright（390/360/1280px）：フォーム・結果（上白石萌歌・河田陽菜・井口眞緒）・人物不明・条件不足で、横はみ出し0・コンソールエラー0、結果は noindex・canonical は本体、商品欄のリンクは楽天のみ（target=_blank・rel=sponsored）、PR表記・クレジット1回。
- tsc OK、テスト 135ファイル・2,264件 OK、next build OK。

### 残り
- 価格更新をしていない人物は価格がすべて非表示になる（予算は取得時点の価格で判定）。定期の価格更新を始めると価格の表示が増える。
- 販売終了の判定は、価格更新のコード指定で確認した商品だけ（カテゴリ検索は販売終了も更新するため、例：上白石萌歌「まばたき」は販売終了だが価格・取得日時あり）。
- 本番の環境変数 `OSHI_SHOPPING_GENERAL_ITEMS`（一般商品の選定リスト）が未設定なら一般商品欄は「準備中」。
- トップ・人物ページからの導線、sitemap への追加は未実施（提案のみ）。

### 追記：本番の一般商品の読み込みと、診断への導線（未commit・本番DB/Redis/環境変数 未変更）
- **一般商品の選定リスト**：`OSHI_SHOPPING_GENERAL_ITEMS` はファイルのパスではなく、選定リストの JSON そのもの（32件・約2.2KB）を値に入れる方式（Vercel 上でファイルは読まない）。Vercel の Production には未設定（`vercel env ls` で確認。値は読んでいない）。
  - `src/lib/oshi-shopping/general-items.ts`：値の前後の空白・値全体を囲む引用符（.env の書き方のまま貼った場合）を外し、`base64:` 形式も読む（Vercel の画面・シェルで JSON の引用符が崩れないように）。値はあるのに読めない・一部が不正なら件数だけを警告ログに出す（値・itemCode は出さない）。
  - `scripts/oshi-shopping-general/env-value.ts`（新規）：ローカルの選定リスト（tmp/oshi-shopping-general/general-items.json、git 管理外）をアプリと同じ検証に通し、`base64:` 形式の値を tmp/oshi-shopping-general/vercel-env-value.txt（git 管理外・権限600）に書く。画面には件数・長さだけ。読み戻しの一致を確認。32件すべて有効（live 7・display 9・collection 9・gift 7）、ローカルの .env.local の値と同じ内容。
- **導線**：
  - `src/components/oshi-shopping/OshiShoppingEntryCta.tsx`（新規）：サブスク診断の導線カードと同じ C案の見た目（kicker「SHOPPING DIAGNOSIS」、<aside>）。
  - トップ（`src/app/page.tsx`）：サブスク診断の導線の直後に「推し活お買い物診断」（無料・登録不要）。
  - 人物ページ（`src/app/person/[slug]/page.tsx`）：関連商品ピックアップの直後に、関連商品がある人物だけ「この推しのアイテムを診断」（人物を選択済みの `/oshi-shopping?p=<人物名>`）。
  - `src/lib/oshi-shopping/params.ts`：`buildOshiShoppingStartPath`。`src/app/oshi-shopping/page.tsx`：人物だけを指定したURLは「条件が足りない」と出さず人物を選択済みで表示（登録されていない名前なら案内）。結果と同じく noindex。
  - `src/app/sitemap.ts`：`/oshi-shopping`（本体のみ）。
  - トップ・人物ページの別セッションの未commit の変更（U-NEXT・価格の古さ表示）は含めず、公開用の変更は最新の commit に導線の追加だけを当てて作る。
- テスト：`oshi-shopping-params.test.ts` +4（引用符・base64・壊れた値・ファイルのパスは「準備中」、人物を選択済みのURL）。

## Task 133：推し活お買い物診断 — 本番公開（commit 00528d2）と、一般商品のキャッシュを Redis に（修正は未commit）

### 本番公開（2026-10-23）
- Vercel Production に `OSHI_SHOPPING_GENERAL_ITEMS`（base64: 形式・Production のみ）をユーザーが設定 → 26ファイルを commit `00528d2` で main へ push → oshi-search-tjju の本番デプロイ成功（GitHub Actions は起動なし）。
- 確認：/oshi-shopping・トップ・人物ページ・/oshi-vod・/vod/u-next・/photobooks・/about 等 200、sitemap に /oshi-shopping、フッターのクレジット1回、トップのカード・人物ページのボタン（人物を選択済み）から診断・結果まで動作、結果は noindex、商品欄のリンクはすべて楽天のアフィリエイトURL（target=_blank・rel=sponsored）、390/1280px で横はみ出し・ページエラーなし、管理画面は未ログインで 307／管理APIは 401。

### 問題：一般商品が表示されない・少ないことがある
- 本番のログで `IchibaItem/Search HTTP 429` → 共通の停止（60秒）。停止中の表示は一般商品を取得できず「一時的に取得できませんでした」。楽天の制限は1秒1回より厳しい場合があり（1.1秒間隔・表示の間隔20秒でも 429）、公式に数値の記載はない。
- 原因：取得できた一般商品が本番ではほとんどキャッシュされていなかった（2回目以降も約9.5秒＝毎回7件前後のAPI呼び出し。ローカルは2回目以降0.6秒）。一般商品は Suspense で後から描画する部分で unstable_cache に保存しており、Vercel では関数の終了で保存が失われていたと判断。毎回の連続呼び出しが 429 を招いていた。

### 修正（未commit）
- `src/lib/oshi-shopping/rakuten-lookup.ts`：Redis（Upstash）があるときは一般商品を `oshi-shopping:general-item:v1:<itemCode>`（取得できた商品24時間・販売終了等の null 6時間）に保存し、保存の完了を待ってから返す。キャッシュにある商品はAPIを呼ばない（MGET 1回）。無い商品だけを共通の使用権で取得、失敗した商品は保存しない。キャッシュを読めなければAPIで取得。打ち切りの理由（429・使用権待ち等）を件数とともにログに出す（認証情報は出さない）。Redis が無い環境は従来どおり unstable_cache。
- テスト：`oshi-shopping-lookup.test.ts` +4（キャッシュにある商品はAPIなし、無い商品だけ取得し保存後に返す・失敗は保存しない、キャッシュを読めない場合、打ち切りの理由のログ）。
- tsc OK、テスト 140ファイル・2,368件 OK。
- 最終確認での追加：キャッシュが空のときに同時に開かれた表示が同じ商品を取り直さないよう、無い商品は1件ずつ順に取得し、送信の直前にキャッシュを再確認（別の表示が保存済みなら API を呼ばない）、取得できた結果はすぐに保存（最後にまとめて保存しない）。429・503・通信エラー・使用権を取れない・時間切れは保存しない（「商品未発見」として扱わない）。保存・読み取りの失敗では診断はエラーにならない。テスト +3（途中で別の表示が保存した商品は呼ばない、保存失敗でも表示、itemCode の違う応答は採用しない）。

## Task 134：価格の定期更新に向けた安全対策と、少人数の通常実行（limited-full）（未commit・本番DB/Redis 未変更・定期実行は無効のまま）

### 変更
- `scripts/price-refresh/limits.ts`（新規）：1回の上限と最短更新間隔を環境変数から決める純粋関数。既定は人物30人・楽天API 400回（最大800）・カテゴリ200・最短更新間隔3日（1〜14日）。`PRICE_REFRESH_LIMITED=1`（limited-full）は既定3人・最大10人・楽天API 最大400回。
- `scripts/price-refresh/run.ts`：上限を limits.ts で決め、最短更新間隔を実行に渡す。limited-full は人物の指定を受け付けない（定期実行と同じ順番の先頭から）。dry-run で人物を指定しなければ、次の実行で処理する人物・順番・状態・楽天APIの見込み（累計と上限内か）を表示（Redis の進み具合を読み取りのみ）。429 で終えた回は alert を出し Actions を失敗にする（以前は成功扱い）。limited-full でも人物ごとの結果を出力。
- `src/lib/price-refresh-runner.ts`：処理する人物と順番を `selectRunOrder`（純粋関数）にして、実行と dry-run で同じものを使う（動作は従来どおり）。
- `.github/workflows/price-refresh.yml`：mode に `limited-full`、入力 `max_persons`（既定3）・`max_api_calls`（既定400）・`min_interval_days`（既定3）を追加し環境変数で渡す。schedule の既定は人物30人・楽天API 400回・3日。limited-full は `PRICE_REFRESH_ENABLED` 不要（full は従来どおり必要）。**schedule はコメントのまま（無効）。**
- `src/lib/price-refresh.ts`：コード指定は10件ごとに楽天APIの使用権を返し、2秒空けて取り直す（価格更新の実行中でも推し活お買い物診断・新商品の取得・管理画面が使用権を取れるように）。429・503 の連続・時間切れの扱いは区切りをまたいで従来どおり。
- `src/lib/oshi-shopping/rakuten-lookup.ts`：一般商品のキャッシュは取得できた商品を最長7日保持し、24時間を過ぎたら取り直す。取り直せない（429・使用権を取れない等）ときは前回の取得結果を表示（取得日時は商品ごとに持ち、表示の「〜時点」に反映。失敗に数えない）。
- `docs/price-refresh-runbook.md`：「9. 少人数の通常実行（limited-full）と、定期実行までの段階」。
- テスト：`price-refresh-limits.test.ts`（新規7：既定値・800を超えない・limited-full の上限・間隔の範囲・順番と3日の除外・人物指定）、`price-refresh-books-lookup.test.ts` +3（25件で使用権3回・429で残りを呼ばない・503の連続は区切りをまたいで数える）、`oshi-shopping-lookup.test.ts` +1（古いキャッシュの取り直しと、取り直せないときの表示）。

### 確認
- tsc OK、テスト 141ファイル・2,382件 OK。ローカルの dry-run（limited-full 3人・10人＋上限150回）で予定・見込み・上限での区切りを表示（ローカルは Redis が無いため全員「未実行」扱いの順番）。
- 利用制限（公式ページ）：Neon Free はストレージ 1GB/プロジェクト・コンピュート 100 CU-時間/月・転送 5GB/月（超えるとコンピュートが次の請求期間まで停止）。Upstash Free は 500K コマンド/月・データ 250MB・帯域 10GB/月。

## Task 135：価格更新 — 確認待ちの重複カウントと、確認待ちにした商品の取り直しをなくす（本番DB/Redis 未変更・定期実行は無効のまま）

### 目的
10人の limited-full（10/23）で、オードリーの写真集（bk-13516177、704円→990円・+40.6%）が、同じ回のカテゴリ検索 (A) とコード指定 (B) の両方で確認待ちになり、ログ・集計では2件、Redis の受け取り箱では同じキーへの上書きで1件になっていた。(B) は (A) で確認待ちにした商品を除かずに候補にしていたため、楽天APIを1回余分に使っていた（商品の価格は変わっておらず、データの整合性の問題ではない）。

### 変更
- `src/lib/price-refresh.ts`：`lookupExcludeKey(category, id)` を追加。`selectLookupCandidates` に `excludeKeys` を追加し、そのカテゴリのその商品だけ候補から除く（上限の枠は他の商品に回る。別のカテゴリの同じIDは除かない）。
- `src/lib/price-refresh-runner.ts`：
  - 人物ごとの確認待ちを受け取り箱と同じキー（人物・カテゴリ・商品ID・変更前の価格・取得した価格）で1件にまとめてから、直近の結果・実行の要約・受け取り箱・ログに使う。取得した価格が違う確認待ちは別に残す。
  - (B) の候補から、同じ回の (A) で確認待ちにした商品を除く。続きから再開する人物は、前回の途中までに確認待ちにした商品（直近の結果に残っているもの・取得から3日以内）も除く。3日を過ぎたもの、前回を最後まで終えた人物（新しい巡回）の確認待ちは除かずに取り直す（価格の変化と、承認できる期限14日の確認のため）。
  - 除いた分だけ (B) の候補の読み込み件数を増やす（枠を減らさない）。
- 変えていないもの：30%以上の変動を反映しない判定、承認・却下（人物ごとに1商品だけ更新）、受け取り箱・DB 取り込みの仕組み、別の人物の処理（人物ごとに除く商品を作り直す）、429・503 の停止、上限での区切り、自動停止。

### 設計上の判断
- 別の人物の同じ商品（例：若林正恭にも同じ bk-13516177）は除かない。人物ごとに確認・承認する設計を維持（共有のコード指定キャッシュ3日により、楽天APIは呼ばずに同じ価格で人物ごとの確認待ちになる）。
- 回をまたいだ同じ内容の確認待ちは、受け取り箱（同じキーは上書き）と DB（同じ組は1行・取得日時だけ更新）で従来どおり1件。却下済みの組は再表示しない。

### テスト
- `price-refresh.test.ts` +1：除く商品はそのカテゴリのその商品だけ・枠は他の商品に回る・指定なしは従来どおり。
- `price-refresh-runner.test.ts` +8：(A) の確認待ちを (B) の候補から除く、同じ組は1件（直近の結果・要約・受け取り箱）、価格が違えば別、別の人物は除かず人物ごとに残す、確認待ちなしなら従来どおり、再開時は前回の確認待ち（3日以内）を除き古いものは取り直す、新しい巡回は除かない、429 で終える・確認待ちは残る。既存の「人物ごとの上限50件」のテストは、同じ確認待ちを繰り返す前提だったため、カテゴリごとに別の確認待ちを返すように直した（上限の確認内容は同じ）。
- tsc OK、テスト 141ファイル・2,391件 OK（修正前の既存テストは全件そのまま通過）。

## Task 136：価格の分割自動更新 — 定期実行を1日4回で開始する準備（本番DB/Redis 未変更・未commit・PRICE_REFRESH_ENABLED は false のまま）

### 目的
本番の limited-full（3人・10人・修正後の3人）で、価格以外の変更0件・対象外の人物への影響0件・429/503 なしを確認したため、
定期実行を段階的に開始する（最初の3日間は1日4回、安定したら1日8回）。

### 変更
- `.github/workflows/price-refresh.yml`：`schedule` を有効化し `37 1,7,13,19 * * *`（JST 10:37・16:37・22:37・4:37）。
  1回の上限は従来の env の schedule の既定値のまま（人物30人・楽天API 400回・最短更新間隔3日・作業時間20分・コード指定60件）。
  実行は `vars.PRICE_REFRESH_ENABLED == 'true'` のときだけ（変数を設定するまで schedule は何もしない＝緊急停止のスイッチ）。
- `src/lib/__tests__/price-refresh-workflow.test.ts`（新規5）：定期実行の時刻（1日4回）、新商品の発見（UTC 3時）と重ならないこと、
  PRICE_REFRESH_ENABLED の条件（定期実行・全件の手動実行）、定期実行の上限（30人・400回・3日・20分・60件、limits.ts での実際の値）、
  定期実行で limited-full・dry-run・人物の指定にならないこと、同時実行の防止・ジョブの時間の上限・OpenAI の鍵を渡さないこと。
- `docs/price-refresh-runbook.md`：「5. 定期実行の開始」を1日4回からの手順に、契約（Neon Launch Plan・Upstash 従量課金）と追加費用の見込みを追記。

### 変えていないもの
価格更新の処理（30%以上の変動は確認待ち・価格と取得日時以外は変えない・429/503/価格以外の変更での停止・止まったカテゴリからの再開）、
新商品の取得・管理画面・他の定期実行（vercel.json）。

### 開始前の確認
- 全人物（366人・商品97,327件・判定87,910件）のバックアップ `tmp/price-refresh-backups/2026-10-23T11-51-43-110Z/`（手動の表示順・人物・確認待ち・履歴を含む）と
  スナップショット `all-before-schedule.json`。`backup.ts restore`（違いの表示だけ）で違い0件。
- tsc OK、テスト 142ファイル・2,396件 OK。

### 自動更新で価格が入らない商品（10/23 時点・公開中 41,058件）
- 特定できない29件（短縮URL等）：対象外のまま（推測で特定しない）。
- 検索のみ（楽天市場で itemCode が保存されていない）5,677件：カテゴリ検索の結果に出たときだけ更新（処理済みの人物で約3%が残る）。
- コード指定で取得できない（販売終了・照合できない等）商品は取得日時不明のまま残り、毎回コード指定の候補の先頭になる（見つからなかった結果は3日キャッシュ）。現状は1人0〜4件で影響なし。

## Task 137：ファビコンを Instagram のプロフィールアイコンと同じ画像に（本番DB/Redis 未変更）

### 目的
Google 検索結果で灰色の地球マーク（ファビコン未設定時の表示）になっていたため、公式 Instagram のプロフィールアイコンと同じ画像をファビコンにする。

### 変更
- 元画像（1254×1254・RGB、ユーザー提供。どこからも参照していないため本番公開前に `public/` から削除）を縮小だけして（sharp・lanczos3。色・デザイン・文字・切り抜きは変更なし）、App Router のファイル規約で配置：
  - `src/app/favicon.ico`：16・32・48px の PNG を内包した ICO（Turbopack は ICO 内の PNG が RGBA でないと読めないため、不透明のアルファだけ追加）
  - `src/app/icon.png`：192×192（Google 推奨の「48の倍数・48px以上の正方形」）
  - `src/app/apple-icon.png`：180×180
- `layout.tsx` の metadata は変更なし（`icons` を書くとファイル規約と二重になるため書かない）。サイトのデザイン・SEO 設定・robots.ts も変更なし。

### 確認
- 以前はファビコン関連のファイル・metadata の指定が1つもなかったため、競合はない。
- `next start` で `<link rel="icon">`（ico 48x48・png 192x192）と `apple-touch-icon` が出力され、`/favicon.ico`・`/icon.png`・`/apple-icon.png` が 200。
- robots.txt はアイコンを Disallow しておらず、proxy の matcher（`/admin`・`/api/admin`）の対象外。
- 32px では「推」の字が読める。16px では字が潰れるが、紺地と青い円弧でアイコンとして見分けられる（デザインを変えないため、そのまま）。
- tsc OK、`npm run build` OK。

---

## Task 138：動画メーカー「まず見る3作 ショートV1」— 同じ作品の重複禁止と「再選定」の修正（未commit・本番DB/Redis 未変更）

### 目的
大橋和也で「君がトクベツ / リベンジ・スパイ / 君がトクベツ」と同じ作品が2回選ばれ、「再選定」を押しても3作品が変わらなかった。動画メーカー全体の共通処理として、重複を禁止し、再選定で直前と別の3作品を選べるようにする。

### 原因（実データで確認）
- 推しサーチには「君がトクベツ」がドラマ版（tmdb-tv-296060）と映画版（tmdb-movie-1469230）の別IDで登録され、どちらも2025年・Disney+見放題。選定（oshi-video-maker `first3Selection.ts` の `pickFirst3`）は作品カード単位で、作品名の重複を見ていなかった。
- `pickFirst3` は入力だけで決まる固定の順位付けで、直前の選定結果を受け取らない。再選定の依頼はWorkerまで届き selection.json も書き直されていた（selectedAt は更新）が、同じデータからは毎回同じ3作品になっていた（キャッシュではない）。
- 加えて、生成済み（data.json あり）の人物は管理画面の「再選定」も無視していた（ボタンは表示されるが何も変わらない）。台本も data.json を常に優先していた。
- 既存の選定ファイル233件を調べ、同名重複は大橋和也の1件だけ。

### 変更したファイル
oshi-video-maker（選定ルールの正本）
- `src/compositions/prototypes/first3/first3Selection.ts` — `normalizeFirst3Title`（NFKC・大文字小文字・空白・記号・先頭の「劇場版」を除いて比較。語が違う続編・シリーズ違いは別作品のまま）。`pickFirst3` で同じ作品名は既存の優先順で先に来る1件だけ使い、異なる作品が3件に満たなければ null。再選定の履歴 `rotation`（各回の3作品、最大10回）を渡すと「最近選ばれていない作品」から順に使う（各グループの中は既存の評価基準：最新作 → 直近3年で見放題の多い順 → それ以前）。種別の偏り補正で最近選んだ作品へ戻さない。`isSameFirst3Set`・`countDistinctFirst3Eligible`。
- `scripts/prototypes/first3/captureFirst3Pages.ts` — 選定処理に `rotation` を通す。作品確認の打ち切り条件を1作品目の公開年基準に（再選定で有力な候補を確認せずに打ち切らない。履歴なしでは従来と同じ）。selection.json に `rotation`・`reselect`（結果の文言）を保存。生成時（first3Produce の STEP2）も selection.json の `rotation` で選ぶ（台本・CapCut音声と同じ3作品になる）。作品不足の件数は異なる作品の数。
- `scripts/first3/first3ServerSource.ts` — `rotation` を受け取る。
- `scripts/worker/first3ScriptQueue.ts` — 管理画面の再選定は生成済みの人物でも行う（自動の選び直しは従来どおり生成済みを除く）。`select(person, manual)`。
- `scripts/worker/first3ScriptPrep.ts` — 再選定はいま台本に使っている3作品を履歴に足して選ぶ。自動の選び直しは保存済みの履歴のまま（7日ごとの自動選び直しで元に戻らない）。結果の文言 `reselectNote`（変更・変えられなかった理由・作品不足）。
- `scripts/capcutStore.ts` — 生成後に再選定した場合（selection.json に reselect があり data.json より新しい）は selection.json から正式台本・音声生成用台本を作る。報告に `reselectNote`。作品不足の文言に「同じ作品名は1作品」。
- テスト: `src/lib/__tests__/first3Reselect.test.ts`（新規8件。大橋和也の実データの形）、`first3ScriptPrep.test.ts`（生成済みでも手動の再選定は行う、に更新）。

oshi-search
- `src/app/api/worker/heartbeat/route.ts`・`src/server/video-jobs/job-store.ts` — `reselectNote` を検証して保存。
- `src/server/video-jobs/script-prep-store.ts`・`src/app/api/admin/video-jobs/first3-prepare/route.ts` — 追加した依頼数を返し、未処理の同じ再選定があれば `alreadyPending`。
- `src/app/admin/video-maker/VideoMakerClient.tsx` — 台本カードに再選定の結果（変えられなかった場合は⚠と理由）を表示。連続で押して前の依頼が未処理ならその旨を表示。

### 設計上の判断・注意点
- 同名判定は「正規化した作品名の完全一致」だけ（部分一致にしない）。民王 / 民王R、僕の可愛いは… / 俺の可愛いは… は別作品。
- 再選定は単純なランダムではなく、履歴に基づく順番の入れ替え（LRU）。別の候補が1つでもあれば直前と同じ組み合わせにはならない。異なる作品がちょうど3件なら変わらず、理由を表示。2件以下は選ばず（水増し・AIでの補完なし）、作品不足として表示。
- 実データ確認（本番API読み取りのみ）：大橋和也 通常=君がトクベツ / リベンジ・スパイ / ふしぎ駄菓子屋 銭天堂、再選定1回目=銭天堂 / 俺の可愛いはもうすぐ消費期限!? / 民王R、2回目・3回目も直前と別。ほか9人は従来と同じ3作品。
- 台本形式（7区分・約18秒・CapCut向け）は変更なし。保存済みCapCut音声がある人物を再選定すると台本が変わるため「録り直し」状態になる（既存の確認ダイアログどおり）。
- 反映：oshi-search・oshi-video-maker はどちらの順で反映しても安全（`reselectNote` は任意項目）。Worker は再起動が必要。大橋和也の現在の selection.json は旧ロジックの結果のまま残っている。
- tsc OK（両リポジトリ）、oshi-video-maker テスト151件すべて成功。
## Task 138 追記：本番反映（2026-10-24）
- oshi-search: commit 35f0940（Task 138 の6ファイルのみ。開発ログは Task 138 の節だけ）を main へ push → Vercel Production Ready（oshi-search.jp）。HEAD+この変更だけの状態で tsc・next build を確認済み。
- oshi-video-maker: commit da948a6（Task 138 の8ファイルのみ。リモートなし）。HEAD+この変更だけで tsc・first3テスト30件成功。他の未commitの変更はすべて Worker 起動（10/19）より前のもので、再起動で新たに有効になったのは今回の修正だけ。
- Worker: ジョブの合間（藤原丈一郎の完了直後）に `launchctl kickstart -k gui/$(id -u)/jp.oshi-search.video-worker` で再起動。
- 本番確認（管理画面と同じAPI）: 大橋和也を再選定 → 銭天堂 / 俺の可愛いはもうすぐ消費期限!? / 民王R、続けて再選定 → 僕の可愛いはまだまだ発展途上!? / ジモダン / 関西ジャニーズJr.の目指せ♪ドリームステージ！。正式台本・音声用台本とも新しい3作品に更新、重複なし。処理前にもう一度押すと alreadyPending。
- CapCut音声の安全性: 保存済み音声のある人物（テスト用slugに森本慎太郎の音声を複製）で再選定 → 音声・字幕・完成動画7ファイルは変更・削除なし、状態は stale（録り直しの表示）。本番確認の前後で Worker の assets/audio-capcut・out/posts の1651ファイルに差分なし。
- `.git/refs/remotes/origin/main 2`（iCloud の重複コピー。fetch を失敗させていた）を退避して fetch を復旧。

---

## Task 139：動画メーカー「まず見る3作 ショートV1」— 1作品だけ変更（おすすめに自動変更・候補から手動選択）

### 目的
「再選定」は3作品すべてが変わるため、2作品は残して1作品だけ変えたい場合に対応する。既存の再選定は「3作品まとめて再選定」として残す。

### 変更したファイル
oshi-search
- `src/app/admin/video-maker/First3WorkSlots.tsx`（新規）— 選定中の3作品と各作品の「変更」。変更を開くと「おすすめ作品に自動変更」「候補作品から手動選択」（作品名・公開年・種別・見放題の配信先、作品名で検索。変更前の作品・他の2作品と同名・見放題なしは選べない）。保存済みCapCut音声があれば録り直しが必要になる旨を表示。
- `src/app/admin/video-maker/VideoMakerClient.tsx` — 台本カードに上の一覧を表示。依頼前の確認ダイアログ（音声ありなら録り直しの説明つき）。「再選定」→「3作品まとめて再選定」。
- `src/app/api/admin/video-jobs/first3-prepare/route.ts` — `action: 'replace_one'`（personName・slot・workId=null でおすすめ）。
- `src/app/api/admin/video-jobs/first3-candidates/route.ts`（新規）— 手動選択の候補（読み取りのみ）。
- `src/server/video-jobs/first3-source.ts` — `getFirst3ManualCandidates`（人物ページの「出演作品」と同じ作品カードのうちドラマ・映画＋見放題の配信先。作品カードの作成は既存の処理を共通化）。
- `src/server/video-jobs/script-prep-store.ts` — `replaceOneAction`・`createReplaceOneRequest`。
- `src/app/api/worker/heartbeat/route.ts`・`src/server/video-jobs/job-store.ts` — `works`（台本に使っている3作品）・`fixedWorks`。
- `src/lib/video-first3-script.ts` — `normalizeFirst3Title`（oshi-video-maker と同じ判定。手動選択で他の2作品と同名を選べなくする）。
- テスト: `src/server/video-jobs/__tests__/script-prep-replace.test.ts`（新規）、`src/lib/__tests__/video-first3-script.test.ts`。

oshi-video-maker（commit 7cd8deb）
- `first3Selection.ts` — `pickFirst3Replacement`（残す2作品・変更前と同名を除き、既存の優先順で1作品。枠ごとの履歴で押すたびに別の候補）。
- `scripts/worker/first3ScriptPrep.ts` — `applyFirst3Replace`（純粋関数。残りの2作品は作品ID・順番・内容をそのまま。手動選択はドラマ・映画・見放題あり・他の2作品と同名でないことを作品ページと同じ値で確認）、依頼の処理（通信エラーは3回まで再試行）。
- `scripts/worker/first3ScriptQueue.ts` — 依頼の形式 `parseReplaceAction`・依頼の保存（Worker再起動後も続ける）・変更できなかった結果。1作品だけ変更した3作品は自動で選び直さない。
- `scripts/prototypes/first3/captureFirst3Pages.ts` — selection.json に作品ID・`fixedWorkIds`・`slotHistory`。生成時は `fixedWorkIds` の3作品をこの順番で使う（見放題が無くなっていれば作品を替えずに生成を止める）。
- `scripts/capcutStore.ts`・`videoWorker.ts`・`first3ServerSource.ts`・`searchApiClient.ts` — 台本に使っている3作品（ID付き）の報告、変更できなかった結果の報告、候補の取得。
- テスト: `src/lib/__tests__/first3ReplaceOne.test.ts`（新規8件）。

### 設計上の判断・注意点
- 依頼テーブル（video_script_requests）に列を足さず、action に `replace_one|{1〜3}|{作品ID}` を入れる（本番のスキーマ変更なし。両リポジトリで同じ形式をテスト）。
- 変更できない場合（候補不足・同名・見放題なし・通信エラー）は selection.json を書き換えず、理由だけを画面に表示する（他の作品は変えない）。成功時は一時ファイルから置き換えるため、途中で止まっても前の選定が残る。同じ依頼が処理待ちなら追加しない。
- 以前の選定結果には作品IDが無いため、作品名＋種別で候補から特定する（見つからなければ推測せず変更しない）。
- 1作品だけ変更すると3作品は固定（生成時もこの3作品、7日ごとの自動の選び直しなし）。「3作品まとめて再選定」で固定は解除される。
- 台本は既存の仕組みどおり selection.json から作るため、正式台本・音声生成用台本は変更した1作品の行だけ変わる（7区分・約18秒・CapCut向けのまま）。保存済み音声・字幕・完成動画・生成履歴は削除・上書きしない（台本が変わると「録り直しが必要」の表示になるだけ）。
- 反映順: oshi-video-maker（Worker再起動）→ oshi-search。旧Workerは未知の依頼を処理済みにするため、先にWorkerを更新する。
- 手動選択も自動選定と同じ候補の条件（ドラマ・映画で配信中、本人出演・ゲスト等でない、ドラマは役の表示あり）を使う。本番確認で、本人出演のライブ映画（大橋和也「COUNTDOWN CONCERT 2025-2026 STARTO to MOVE」、種別は映画・見放題あり）を手動で選べてしまったため追加。一覧では理由つきで選べない表示、Worker も拒否する。

---

## Task 140：動画メーカー「候補作品から手動選択」— 別の人物の候補が表示される不具合の修正

### 原因（本番で再現して確認）
- 候補API（`/api/admin/video-jobs/first3-candidates`）は人物ごとに正しい作品を返していた（道枝駿佑・大橋和也・高橋恭平・長尾謙杜で確認）。
- 管理画面の人物詳細の台本カード（`CapcutCard`）に React の key が無く、人物を切り替えても同じ部品が使い回されていた。`First3WorkSlots` が最初の人物で読み込んだ候補一覧を状態として持ち続け、「読み込み済みなら再取得しない」ため、以降どの人物でも最初の人物の候補（例：大橋和也の20件）が表示されていた。開いていたパネルも切り替え後に残っていた。
- Worker は手動選択の作品が「その人物の候補の条件」を満たすか確認していたため、別の人物の作品は「対象外」として拒否され、誤った作品は保存されていなかった（高橋恭平に「君がトクベツ」を選んだ依頼が拒否されたログを確認）。ただし理由の文言が分かりにくかった。

### 変更したファイル
oshi-search
- `src/app/admin/video-maker/VideoMakerClient.tsx` — `First3WorkSlots` に人物名の key（人物を切り替えたら作り直す）。
- `src/app/admin/video-maker/First3WorkSlots.tsx` — 候補一覧を「どの人物の一覧か」と一緒に保持し、人物が変わったら一覧・検索・開いている枠・方法の選択をリセット。応答が届く前に人物を切り替えた場合・応答の人物名が違う場合は使わない。キャッシュしない（no-store）。選べる候補が無ければ「変更可能な候補作品がありません」。
- `src/app/api/admin/video-jobs/first3-prepare/route.ts` — 手動選択の作品が、その人物の出演作品（人物ページの「出演作品」と同じデータ）に無ければ 400 で拒否し、依頼を作らない。
- テスト: `src/app/api/admin/video-jobs/__tests__/first3-prepare-replace.test.ts`（新規）。

oshi-video-maker（commit 560506f）
- `scripts/first3/first3ServerSource.ts`・`scripts/worker/first3ScriptPrep.ts` — 手動選択の作品がその人物の出演作品の作品IDに無ければ「○○の出演作品ではありません」で拒否（3作品・台本は変えない）。テスト追加。

### 設計上の判断・注意点
- 出演関係は既存の人物ページと同じデータ（`getPublishedWorksOrThrow(人物名)` → 作品カード）だけを使う。グループ名や作品名から出演者を推測せず、出演関係を新たに作らない。
- 人物の識別は既存の動画メーカーと同じく人物名（persons の name。依頼・Worker の slug も人物名から作る）。

---

## Task 141：動画メーカー「まず見る3作」— 作品変更後に録り直し・再生成しても「使用可能」に戻らない不具合

### 原因（道枝駿佑の実データで確認）
- 「使用可能」＝保存済みCapCut音声の scriptHash が現在の正式台本のハッシュと一致し、取り込みチェックに合格。「台本変更あり・再作成必要」（stale）＝一致しない。動画の生成（ジョブ作成）は「使用可能」の人物だけ受け付ける。
- 11:40 に3作目を「恋するキャスター → 消えた初恋」に変更（selection.json）。11:49 に録り直した WAV・SRT（字幕は「3作目は 消えた罰恋」＝新しい台本の音声）を取り込んだが、保存された scriptHash は**変更前の台本**（恋するキャスター）のものだった。
- 取り込んだのは Worker ではなく、10/6 から起動したままの oshi-video-maker の管理画面サーバー（`npm run ui` = localhost:4321、受信フォルダを5秒ごとに取り込む）。Task 138・139 より前のプログラムのまま動いており、「完成動画の data.json を常に優先する」古い処理で現在の台本を作ったため、古い台本のハッシュで保存した（取り込みチェックは作品名1つの違いでは不合格にならず合格）。
- その結果、音声は「台本変更あり」のままになり、動画の再生成も受け付けられなかった（10/23 以降、道枝駿佑の生成ジョブは無い）。

### 変更したファイル
oshi-video-maker（commit 58ba948）
- `scripts/capcutStore.ts` — 起動後に台本に関わるプログラム（capcutStore・captureFirst3Pages・importFirst3CapcutNarration・first3Selection・first3Script・capcutScript）の内容が変わったプロセスは、CapCut受信フォルダを取り込まない（最新のプロセスが取り込む）。data.json の `selectionRevision` で「どの選定結果から作った動画か」を判定（生成途中に作品を変えても、古い生成の完了で新しい台本を上書きしない）。「台本変更あり」に保存済み音声の台本との違い（行）を表示。完成動画が現在の台本に対応しているか（`videoStatus`）を報告。
- `scripts/prototypes/first3/captureFirst3Pages.ts`・`src/compositions/prototypes/first3/first3Data.ts` — data.json に `selectionRevision`（生成開始時の selection.json の selectedAt）。
- テスト: `src/lib/__tests__/first3RemakeState.test.ts`（新規。A〜G の状態の移り変わり。F は以前の日時比較では失敗することを確認）。

oshi-search
- `src/app/admin/video-maker/VideoMakerClient.tsx`・`src/app/api/worker/heartbeat/route.ts`・`src/server/video-jobs/job-store.ts` — 「動画: 現在の台本で生成済み / 作品変更後は未生成 / 未生成」を表示。

### 設計上の判断・注意点
- 「使用可能」の意味（現在の台本に対応する音声が保存済み＝生成できる）は変えない。無条件に使用可能へ書き換えない。完成動画の状態は別の表示にした（生成の受け付け条件は従来どおり）。
- 起動したままの localhost:4321 を再起動した（Worker と同じく、今後はデプロイ時に再起動が必要。再起動していなければ取り込みをせず Worker が取り込む）。
- 過去の WAV・SRT（_inbox/_done）・完成動画・生成履歴は削除しない。

---

## Task 142：Instagram管理「ストーリーズテンプレート」（全スライドにリンクCTA）

### 目的
- 3枚構成のストーリーズを、テンプレートを選ぶ → 各スライドを見る → 本文・CTAをコピーする、の流れで手動作成できるようにする。
- ストーリーズは最後まで見られるとは限らないため、3枚目だけにリンクを置かない。1枚目（フック・自然なCTA）／途中（説明とつながるCTA）／最後（最も明確なCTA）の3段階で、すべてのスライドにリンクCTAを持たせる。

### 変更したファイル
- `src/lib/instagram-story-templates.ts`（新規）— 静的テンプレート定義。`StoryTemplate { id, title, purpose, isPR, slides: StorySlide[] }`、`StorySlide { text, linkCTA, ctaRole, linkPosition, recommendedAsset }`。`linkPosition` は `{ placement: 'bottom-center', bottomOffsetMinPx: 300, bottomOffsetMaxPx: 450 }`。1080×1920 の簡易レイアウト `STORY_LAYOUT`（上部UI 0–220／本文 240–760／画像 800–1420／リンクステッカー 1470–1620／下部UI 1720–1920）、`getLinkStickerZone`・`describeLinkPosition`・`formatStoryTemplateForCopy`（まとめてコピー用）。4テンプレート（めんどい解決／サブスク診断／できること／応援広告・推しアド＝isPR）。
- `src/app/admin/instagram-stories/page.tsx`・`StoryTemplatesClient.tsx`（新規）— カード一覧 → 選択したテンプレートの目的と各スライド（1080×1920 配置プレビュー、本文、リンクCTA、リンク推奨位置、おすすめ素材、本文をコピー／CTAをコピー）、「N枚まとめてコピー」。PRテンプレートはバッジ・注意書き・プレビューにPR表示。
- `src/app/admin/instagram/page.tsx` — 入口カード「ストーリーズテンプレート」を1件追加（CARDS 配列への追加のみ）。
- テスト: `src/lib/__tests__/instagram-story-templates.test.ts`（新規。全スライドにCTA、役割の順序、指定CTA、PR、リンク位置が本文・画像・Instagram UIと重ならないこと、まとめてコピー）。

### 設計上の判断・注意点
- DB・Instagram API・予約投稿・自動投稿・動画生成には接続しない（静的定義の閲覧とクリップボードコピーのみ）。認証は既存の middleware（`/admin/:path*`）で保護される。
- テンプレート追加は `STORY_TEMPLATES` に1件追加するだけ。`slides` は配列なので4枚以上にも対応（役割は先頭=hook、末尾=final、間=detail をテストで検証）。
- 推しアドは1枚目からリンクを置くため、1〜3枚目すべての本文の末尾に「※PR」を入れている（コピーする本文そのものに含める）。

## Task 142 追記：リンク先URL（linkUrl）と推しアド全スライドのPR表記
- `StoryTemplate.linkUrl`（全スライド共通の既定値）と `StorySlide.linkUrl?`（スライド単位の上書き、null＝未設定）を追加。`resolveSlideLinkUrl` で解決。管理画面に「リンク先URL」表示と「URLをコピー」、まとめてコピーにも `リンク先URL：` を出力（未設定なら「未設定」）。
- URLはコード上で確認できる正式ページだけ：本番オリジン `https://oshi-search.jp`（robots.ts・sitemap と同じ値を `STORY_LINK_ORIGIN` に固定。プレビューの NEXT_PUBLIC_SITE_URL に引きずられないため）＋ `/search`（推し・有名人を検索）／`OSHI_VOD_PATH`／`SUPPORT_ADS_PATH`／`/`。
  - めんどい解決：全スライド /search、サブスク診断：全スライド /oshi-vod、できること：1枚目 /（トップ）・2〜3枚目 /search、推しアド：全スライド /support-ads（はじめての応援広告ガイド）。
  - 推しアドの AccessTrade 計測リンク（oshi-ad-link.ts）はバナーHTMLとして改変禁止で保持されているもので、ストーリーズのリンクには使わない。

---

## Task 143：ストーリーズテンプレート「推しからサブスク診断」を完成イメージのプレビューに

### 目的
- 「ここに本文／ここに画像」の配置図では投稿時の見た目を判断しにくいため、「推しからサブスク診断」だけ、Canva 等でそのまま再現できる完成イメージのプレビューにする。1枚目からリンクを押したくなる見せ方にする。

### 変更したファイル
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx`（新規）— 1080×1920 の座標のまま描き、container query 単位（cqw）で枠幅に合わせて縮小する完成イメージ。推しサーチ本体の C案トークン（#F6F5F1・黒の太字・オレンジ #FF5A00・薄いブルー/グリーン、角ばった枠とずらし影）。本文ブロック 240–760・画像ブロック 800–1420・CTA は `getLinkStickerZone`（1470–1620）に配置し `data-story-zone` を付ける。
  - 1枚目：ラベル「推しから選べる」、見出し「推しから／サブスク診断してみない？」、補足「作品数だけじゃなく／料金までまとめて比較」、診断入口画面のモックアップ、オレンジ塗りの大きなCTA（黒のずらし影）＋「1タップで診断ページへ」ラベル。
  - 2枚目：見出し「気になる人を／選ぶだけ。」、「1人だけでもOK／または／3人まとめてもOK」の選択画面モックアップ、白地・黒枠のCTA。
  - 3枚目：見出し「この人を見るなら／どのサブスク？」、出演作品数×配信サービス×料金、診断結果カード（「例」「画面イメージ（例）」表記、サービスA〜C・◯◯作品・¥◯,◯◯◯ で実データ風の数字は出さない）、黒塗り＋オレンジ影のCTA。
  - 任意で Instagram UI（上部 0–220／下部 1720–1920）とリンクステッカー位置のガイドを重ねて表示。
- `src/app/admin/instagram-stories/StoryTemplatesClient.tsx` — デザインがあるスライドは完成イメージ（最大 280px 幅）、それ以外は従来の配置図。プレビューのクリック／「拡大プレビュー」で 9:16 の拡大表示（前へ・次へ・Esc で閉じる・ガイド切替）。ガイド表示のチェックボックスを追加。
- テスト: `src/lib/__tests__/instagram-story-design.test.tsx`（新規。デザインは推しからサブスク診断のみ、全スライドに本文・画像・CTAブロックと各CTA、結果モックに実データ風の数字なし、ガイドの表示切替）。

### 設計上の判断・注意点
- テンプレートの本文・CTA・リンク先URL（`src/lib/instagram-story-templates.ts`）は変更していない。完成イメージ内の短い補足（「料金までまとめて比較」等）はプレビュー用の見せ方で、コピーされる本文は従来どおり。
- ほかの3テンプレートは従来の配置図のまま（`STORY_DESIGNS` に登録すれば同じ仕組みで完成イメージにできる）。
- ローカル dev（一時的なセッション秘密鍵、.env は未変更）＋ Playwright で 1280px / 390px を確認：各ブロックが範囲内、子要素のはみ出し・文字切れなし、横スクロールなし、スマホは1列、コピー（本文・CTA・URL・3枚まとめて）の内容、拡大プレビューの開閉。
- 1・2枚目のモックアップ内ボタン（「診断する」「選んだ人で診断する」）は `MockButton muted`（白地・細いグレー枠・グレーの小さめの文字、オレンジ装飾なし）。画面内のボタンと分かる程度に弱め、実際に押してほしい下のリンクステッカーCTAと視線が競合しないようにした。

---

## Task 144：ストーリーズテンプレートの画像保存（PNG 1080×1920・3枚まとめてZIP）

### 目的
- `/admin/instagram-stories` の完成イメージを、そのまま Instagram ストーリーズへアップできる PNG で保存する（リンクスタンプは Instagram アプリ側で CTA の位置に重ねる）。

### 変更したファイル
- `src/app/admin/instagram-stories/story-image-export.ts`（新規）— `renderStorySlidePng`：画面外に幅 1080px で `StoryDesignFrame`（`showGuide=false`）を描き、その DOM を SVG の foreignObject に入れて 1080×1920 の canvas に等倍で描画 → PNG。ページから受け継ぐ文字の値（line-height は倍率に戻す）と Tailwind preflight 相当の基本 CSS を SVG 内にそろえる。`<img>` があれば data URL に埋め込んでから描く（取得失敗はエラー）。`downloadBlob`・`storyPngFileName`。
- `src/lib/zip-store.ts`（新規）— 依存なしの無圧縮 ZIP（CRC-32 付き）。PNG は圧縮済みのため STORE で十分。
- `src/app/admin/instagram-stories/StoryTemplatesClient.tsx` — 各スライドの「拡大プレビュー」の横に「PNGで保存」（`instagram-story-{n}.png`）、「3枚まとめてコピー」の横に「3枚まとめて保存」（`instagram-stories.zip`）。処理中は「保存中...」で無効化、失敗時は「画像の保存に失敗しました」。完成イメージがあるテンプレート（現状は推しからサブスク診断）だけに表示（配置図は投稿用画像ではないため）。
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx` — 見た目は変えずに、保存画像がプレビューと一致するよう3点修正：①枠線の太さを `ub()`（+0.02px）にして、SVG 内で 4px が 3px に切り捨てられるのを防ぐ ②等幅フォントに実在書体名（Osaka-Mono 等）を先に並べ、総称 monospace が SVG 内で別書体になるのを防ぐ ③ずらし影を box-shadow から背面の箱（`HardShadow`）に変更（Safari は SVG 画像内の box-shadow を描かない）。
- テスト: `src/lib/__tests__/zip-store.test.ts`（新規。CRC-32、ZIP 構造・各ファイルの中身）。

### 確認（ローカル dev＋Playwright、Chromium と WebKit）
- 1〜3枚目それぞれ・3枚まとめて保存できる。PNG は 1080×1920、ZIP 内の3枚は個別保存と同一画像。
- ガイド表示 ON のまま保存しても、紫の点線・ガイド文字・灰色の Instagram UI は入らない（上下の UI 範囲は背景色のみ）。CTA デザインは残る。
- 画面のプレビュー（幅 1080px）と保存 PNG の差：Chromium 0.08〜0.24%、WebKit 0.23〜0.33% の画素（文字の縁のアンチエイリアス程度）。修正前後でプレビュー自体の見た目は画素単位で同一。
- 現状のデザインは外部画像を使っていない（CSS で描いたモックアップと絵文字のみ）。

### 注意点
- iPhone の Safari での保存（ダウンロード）は未確認。

---

## Task 145：ストーリーズ「推しからサブスク診断」の縦バランス調整

### 目的
- 保存画像が上に寄って見えるため、縦方向の位置だけを調整する（文言・文字サイズ・配色・横幅・CTAのデザインは変更しない）。

### 変更したファイル
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx` — 3枚の本文ブロックを `TEXT_ZONE`（`STORY_LAYOUT.text` の上端 +30px＝270〜760）に変更。

### 設計上の判断・注意点
- CTA は Instagram の返信欄と重ならないことを優先し、位置を変えない（ユーザー確認済み）。3枚とも CTA はリンクステッカー位置 1470〜1620、中心 y=1539 で同じ高さ。CTA の下端は下端から約300px（うち下部約200pxは Instagram の返信欄など）。
- 本文の開始を Instagram 上部UI（〜220）から 50px 離し、本文→画面の間隔を 110/75/80px → 80/45/50px にして、画面→CTA の 50px とそろえた。2枚目の本文が最も長く、これ以上下げると画面モックと詰まる。
- 画面モック以下（y≥780）は変更前と画素単位で同一。本文部分は変更前を 30px 下げた画像と画素単位で同一（文字・色は不変）。プレビューと保存PNGは同じ `StoryDesignFrame` から描くため配置は一致（差 0.08〜0.24% はアンチエイリアス程度）。
- 他テンプレート（配置図）と `STORY_LAYOUT`・リンク位置データは変更していない。

## Task 138：正式アイコンを黄色のデザインに変更（本番DB/Redis 未変更）

### 目的
推しサーチの正式アイコンを新しい黄色のデザイン（黄色地・紺の「推」・赤い星）に変え、Instagram と Google 検索・ブラウザタブ・スマートフォンで同じアイコンにする。

### 変更
- 元画像 `oshi-search-yellow-final/黄色い「推」アプリアイコン.png`（1254×1254・RGB、ユーザー提供。`public/oshi-search-yellow-final.png` と同一内容）から、Task 137 と同じ方法（sharp・lanczos3 の縮小のみ。色・デザイン・文字・切り抜きは変更なし）で作り直して差し替え：
  `src/app/favicon.ico`（16・32・48px、ICO 内は RGBA）、`src/app/icon.png`（192×192）、`src/app/apple-icon.png`（180×180）。
- 元画像はコミットしていない（どこからも参照しない。`public/` のものはローカルにあるだけで本番には出ない）。
- metadata・SEO 設定・robots.txt・サイトのデザインは変更なし。

### 確認
- 16px でも「推」の形と赤い星が見分けられる（黄色地に紺で、Task 137 の紺地アイコンより小さいサイズでの視認性が高い）。
- tsc OK、`npm run build` OK。

## Task 148：動画生成（/admin/video-maker）の完了ジョブに「Instagram投稿文」（表示・編集・コピー）（未commit・DB/Worker 無変更）

### 目的
動画生成後、そのまま Instagram Reels 投稿まで進めるよう、完了ジョブの詳細に投稿文を表示してコピーできるようにする。まず「推し活お買い物診断 ショートV1」（oshi-shopping-intro-v1）。

### 変更したファイル
- 新規 `src/lib/video-instagram-caption.ts`：`getInstagramCaption(templateId, { name, groupName })`（テンプレートIDごとの投稿文テンプレートの表。未設定は null）、`captionGroupName`（人物選択データの currentGroupName → group の順。activityStatus=graduated は付けない）、`toHashtag`（空白だけ詰める。それ以外の記号〔! ＝ / ☆ . 等〕を含む名前はタグにしない＝記号を消して別の名前にしない）。
- `src/app/admin/video-maker/VideoMakerClient.tsx`：`InstagramCaptionSection`（動画・ダウンロード・再生成の下、Instagramリールの上）。textarea で編集（保存しない・「元の投稿文に戻す」）、「投稿文をコピー」→「コピーしました ✓」（2.5秒で戻る。クリップボードAPIが使えない環境は選択してコピー）、既存の文字数・ハッシュタグ数の基準（instagram-caption-rules）で表示。投稿文が未設定のテンプレートは欄を出さない。人物名はジョブの person_name、グループは page.tsx が渡している人物選択データ（DB）から。
- テスト：`src/lib/__tests__/video-instagram-caption.test.ts`（6件）。

### 確認（ローカル dev・DB は読み取りのみ、本番と同じDBのジョブを表示）
- 本番の管理画面で作られた目黒蓮×推し活お買い物診断×CapCut のジョブ（completed）：「今回は目黒蓮さんで診断してみました。」「#推し活 #推し活グッズ #推しサーチ #目黒蓮 #SnowMan」。コピーで全文（278文字）がクリップボードに一致、編集後のコピー・元に戻す、「コピーしました ✓」は約2.5秒で戻る。
- 別人物（画面の中だけ person_name を松村北斗に差し替え）：「今回は松村北斗さんで…」「#松村北斗 #SixTONES」、他の文は同じ。
- まず見る3作の完了ジョブには欄が出ず、既存の投稿文欄はそのまま。動画・ダウンロード・再生成・Instagramリールの部品もそのまま。375px で横はみ出しなし、タップでコピー可。
- tsc OK、vitest 148ファイル・2,427件 OK。

## Task 148 追記：卒業・脱退済みの人物にもグループのハッシュタグを付ける

- `src/lib/video-instagram-caption.ts`：`captionGroupName` から activityStatus=graduated の除外を削除。人物についての投稿のため、DBに登録されているグループ名（currentGroupName → group）があれば活動状態に関係なく付ける。登録が無ければ付けない（推測しない）。記号を含む名前をタグにしない扱いは同じ。
- テスト：山下美月（乃木坂46・卒業）→ `#山下美月 #乃木坂46`（7件 OK、tsc OK）。
- 管理画面（ローカル dev）：目黒蓮 `#目黒蓮 #SnowMan`、松村北斗 `#松村北斗 #SixTONES`、山下美月 `#山下美月 #乃木坂46`（松村北斗・山下美月は画面の中だけジョブの人物名を差し替え。グループはDBの人物データ）、コピーは全文一致。

---

## Task 146：ストーリーズ「応援広告・推しアド（PR）」の3枚組完成デザイン

### 目的
- Instagram ストーリーズから推しサーチの応援広告ガイド（https://oshi-search.jp/support-ads）へ誘導する3枚組を、サブスク診断と同じく完成イメージ（PNG 1080×1920 保存・ZIP）にする。

### 変更したファイル
- `src/lib/instagram-story-templates.ts` — `support-ads-oshiad` の本文・CTA・おすすめ素材を新しい文案に更新（1枚目「推しの記念日、いつもと違う形でお祝いしない？」／2枚目「応援広告って知ってる？」／3枚目「応援広告、いくらかかるの？」、CTA「応援広告を見てみる ↓」「仕組み・始め方を見る ↓」「費用・始め方を確認 ↓」）。全スライドの本文末尾に「※PR」。リンク先は従来どおり /support-ads。
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx` — `SupportAdSlide1〜3` を追加し `STORY_DESIGNS` に登録。`LabelRow` に `pr`（ラベル行に黒枠の「PR」バッジ）、`Headline` に `mt` を追加（どちらも既定値は従来どおり）。サブスク診断1枚目の「1タップで…」ラベルを `CtaHint` に切り出し（出力は画素単位で同一）。
  - 1枚目：お祝いの応援広告イラスト（CSSで描いたポスター・紙吹雪・誕生日／周年・記念日／ライブ記念）＋オレンジCTA。
  - 2枚目：駅の掲載イメージ（駅ポスター・駅サイネージのイラスト）、下帯に「誕生日・周年・ライブ記念など、特別な日の応援に。」＋白地・黒枠CTA。
  - 3枚目：応援広告ガイドの画面イメージ（費用の目安7日間：駅ポスターB1 4万〜8万円／駅サイネージ 5万〜50万円／屋外ビジョン 30万円〜、掲載までの流れ6ステップ、出典「推しアド公式の費用ガイド（更新日）の目安。媒体・時期・空き状況で変わります。」）＋オレンジCTA＋「1タップで応援広告ガイドへ」（3枚で最も目立つ）。
- テスト：`instagram-story-templates.test.ts`（推しアドのCTA）、`instagram-story-design.test.tsx`（デザイン対象、全スライドのPRバッジ・CTA、費用・流れが content.ts と一致、画像を使わない）。

### 設計上の判断・注意点
- 費用・流れは `src/lib/support-ads/content.ts`（推しアド公式で確認済み）と同じ値だけを表示し、`FLOW_STEPS`・`COST_GUIDE_UPDATED_AT` は直接参照、価格はテストで priceNote と照合。content.ts を更新したら3枚目の価格も合わせること。
- 人物写真・他社広告画像・推しアドのバナー（AccessTrade の計測用外部画像）は使わない。人物は描かず「推しの名前」のプレースホルダー。イラスト・画面には「イメージ（イラスト）」「画面イメージ」と表示。
- 配置はサブスク診断と共通（本文 270〜760、画像 800〜1420、CTA 1470〜1620・中心 y=1539）。PNG とプレビューの差は Chromium 0.30〜0.49%、WebKit 0.40〜0.45%（文字の縁のみ）。

---

## Task 147：推しアド（PR）ストーリーズ1枚目の文言を具体的に

### 目的
- 1枚目で「応援広告とは何か・誕生日や周年に使えること・初心者でも分かりそうなこと」が一目で伝わるようにする。

### 変更したファイル
- `src/lib/instagram-story-templates.ts` — 1枚目の本文を「推しの誕生日や周年、駅広告でお祝いできるって知ってる？／“応援広告”は、推しへのお祝いを広告として出せる推し活。／費用や始め方もチェックできます。／※PR」に変更（CTA「応援広告を見てみる ↓」は同じ）。
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx`（SupportAdSlide1）— ラベル「はじめての応援広告」、見出しは大きさを保つため3行（推しの誕生日や周年、／駅広告でお祝い／できるって知ってる？、「駅広告」にマーカー、68px）、補足は「“応援広告”」をオレンジ。小補足「費用や始め方もチェックできます。」はイラスト下部の帯に（2枚目の帯と同じ形）。タグを 誕生日／デビュー周年／駅に掲載 に。

### 設計上の判断・注意点
- 配置は共通のまま（本文 270〜757、画像 800〜1420、CTA 中心 y=1539）。2・3枚目と他テンプレートは変更なし。

---

## Task 149：推しアド（PR）ストーリーズ1枚目を駅広告ビジュアル中心に再デザイン

### 目的
- 「えっ、推しの誕生日を駅広告で祝えるの？」と最初の1〜3秒で伝わるよう、小さな説明図ではなく大きな駅広告の掲載イメージを主役にする。

### 変更したファイル
- `src/lib/instagram-story-templates.ts` — 1枚目の本文を「推しの誕生日や周年、駅広告でお祝いできるって知ってた？／「応援広告」は、推しへのお祝いを広告として出せる推し活。／誕生日・周年・デビュー記念にも。／※PR」に変更。CTA は「応援広告を見てみる ↓」のまま。
- `src/app/admin/instagram-stories/StoryDesignPreview.tsx`（SupportAdSlide1 のみ）
  - 見出し3行：「推しの誕生日や周年、」「駅広告でお祝い」「できるって知ってた？」。2行目だけ 94px＋「駅広告」をオレンジ＋オレンジの太い下線、ほかは 58px の黒。補足は2行（「応援広告」をオレンジ）。
  - メインビジュアル `StationAdVisual`（幅960×高さ660、y=780〜1440）：駅の壁面（タイル目地・天井照明）、駅名標「◯◯駅」、中央に照明で照らされた大きな誕生日ポスター（HAPPY BIRTHDAY／推しの名前／2026.◯◯.◯◯）、左右に奥行き用の広告枠、紙吹雪、斜めのラベル（誕生日・周年・デビュー記念）、床の帯に「誕生日・周年・デビュー記念にも。」、右上に「掲載イメージ」。人物は描かない。
  - 旧1枚目用の紙吹雪（Confetti）は未使用になったため削除。2枚目の BirthdayPoster・IllustrationCard はそのまま。

### 設計上の判断・注意点
- CTA は2・3枚目と同じ高さ（1470〜1608、中心 y=1539）に据え置き、スワイプ時に位置が動かないようにした。CTA 下端は画像下端から約312px（依頼の目安340pxよりわずかに下、当初のリンクステッカー範囲300〜450px内）。本文・ビジュアルは上250px〜下端から480px（y=1440）の範囲に収めた。
- 2・3枚目とサブスク診断の保存PNGは変更前と画素単位で同一。
