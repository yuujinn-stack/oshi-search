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

## Task: VOD CSV インポートパフォーマンス改善 (branch: feat/vod-csv-import-perf)

**目的：** `/admin/work-check` の VOD調査結果CSVインポート（`/api/admin/csv-import`）が遅い問題を解消。

**根本原因：**
- プレビューフェーズ: `getAllPersonsMerged()` → 全人物ループで `getAllWorks()` を逐次呼出し（N≈186 query）
- コミットフェーズ: 作品ごとに `withWorkFromDB`（SELECT + UPDATE）を逐次実行（M works × 2 query）

**変更ファイルと内容：**
- `src/lib/work-store.ts` — `getWorksForPersons(names[])` 追加: `inArray` で1クエリバッチロード
- `src/db/write.ts` — `batchUpsertWorkVodData(workList, wrapInTransaction)` 追加: `Promise.all` 並列 UPDATE、同期モードは `db.transaction` でラップ
- `src/app/api/admin/csv-import/route.ts` — 全面改修:
  - 第1パス（人物名収集）→ `getWorksForPersons` 1発ロード
  - コミット: インメモリで変更計算、変更ある作品のみ `batchUpsertWorkVodData`
  - unchanged skip: 内容が同じプロバイダーは書き込みスキップ
  - 同期モード削除チェックの正規化バグ修正（`toLowerCase` → `normalizeProviderName`）
  - タイミングログ追加（`[VOD CSV IMPORT] load/diff/write/total ms`）
  - レスポンスに `unchangedProviders`, `elapsedMs` 追加
- `src/app/admin/work-check/VodImportSection.tsx` — UI改善:
  - 段階的進行メッセージ（`importStage` state）
  - 処理中は全操作要素（ファイル入力・モード選択・人物選択・全ボタン）を無効化
  - `isSubmitting` ref でダブルサブミット防止
  - 完了レポートに `elapsedMs`・`unchangedProviders` を表示

**設計上の判断：**
- `batchUpsertWorkVodData` は `vodData` と `updatedAt` のみ UPDATE（aiData 等は触れない）
- 同期モードの transaction は Neon HTTP ドライバ対応（`db.transaction(async tx => { await Promise.all(...) })`）
- UI の stage ラベルはサーバー側の処理段階と概ね対応しているが、SSE ではないため正確な同期はしない
