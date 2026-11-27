# 販売状況の記録と動画の紹介商品（定期更新の有効化・ロールバック手順）

作成：2026-11-27（ブランチ feat/live-history-video。本番未反映）

動画テンプレート D案（ライブDVD・Blu-ray紹介）・A案（推しグッズ5選）・B案（推しグッズ発見3選）は、動画専用の楽天APIの問い合わせをやめ、
推しサーチ全体の価格・在庫の定期更新（GitHub Actions `price-refresh`）が商品データに保存した**販売状況**だけで紹介商品を選ぶ。
定期更新が動いて販売状況が記録されるまで、D/A/B の動画は作れない（「販売状況が不明」として理由を表示して止まる）。

## 1. 何が変わるか

| 場所 | 変更 | 既存への影響 |
|---|---|---|
| `products.items[]`（Neon の JSON の中） | 項目を2つ追加：`stockStatus`（下の表）・`stockCheckedAt`（楽天で販売状況を確認した日時 ms）。列・テーブルは追加しない | サイトの表示・検索・楽天への誘導・お買い物診断はこの2項目を読まない（表示は変わらない）。新商品の発見・管理画面の編集は既存の項目を残す処理のため、記録は消えない |
| 保護トリガーの関数 `products_price_refresher_guard()` | 価格更新専用ユーザーが上の2項目も変えられるようにする（決まった値・正の数値だけ。消せない）。`scripts/price-refresh/stock-guard.ts` | サイト・既存の自動更新・管理画面（neondb_owner）には従来どおり何もしない |
| 価格更新 (A) カテゴリ検索 | 検索結果の在庫状況（楽天ブックス availability・楽天市場 販売可能フラグ）から販売状況を記録。**追加の楽天APIなし**（同じ検索結果を使う） | 価格の扱いは従来どおり（品切れでも価格は従来どおり更新。価格の確認と購入できる確認を分けて記録） |
| 価格更新 (B) コード指定 | 取得結果（購入できる・品切れ・見つからない・不一致）を記録。**追加の楽天APIなし** | 価格の扱いは従来どおり |
| 指紋（価格以外の変更の検知）・`snapshot.ts compare` | 販売状況の2項目も「価格の項目」と同じく比較から除く | 自動停止の条件は従来どおり |
| 動画（候補・台本・ジョブ作成・音声の取り込み・Worker） | 保存済みの販売状況だけで判定（楽天APIの呼び出し0件）。確認期限は初期7日（`VIDEO_PURCHASE_MAX_AGE_DAYS`、1〜30） | 管理画面の操作は同じ |

販売状況を書くのは `PRICE_REFRESH_STOCK_FIELDS=1` のときだけ（リポジトリ変数）。未設定なら価格更新は従来とまったく同じ。

### 販売状況の値（src/lib/rakuten-search-stock.ts。楽天ウェブサービスの availability の仕様に合わせる）

| stockStatus | 楽天ブックス availability | 楽天市場 | 動画で紹介 |
|---|---|---|---|
| available | 1 在庫あり・2 通常3〜7日程度で発送・3 通常3〜9日程度で発送（価格あり） | 販売可能（1）・価格あり | ○（7日以内） |
| backorder | 4 メーカー取り寄せ | — | ×（在庫ありと区別） |
| preorder | 5 予約受付中 | — | ×（在庫ありと区別） |
| unavailable | 6 メーカーに在庫確認 | 販売不可能（0）・商品コード指定で販売中の商品として返らない | × |
| unknown | 空・想定外の値・価格なし（品切れとは断定しない） | 価格なし | × |
| not_found | 総合検索で0件 | — | × |
| mismatched | 同じ商品番号が無い | 違う商品コードが返った | × |

楽天APIのエラー・429・503・タイムアウト・通信失敗では何も記録しない（前の記録のまま。古い記録は7日で期限切れ）。
価格の反映は従来どおり（楽天ブックスは在庫状況1〜5で価格を反映）で、販売状況とは別。

### 動画の判定（src/lib/goods-pick/purchase.ts）
- `available` かつ確認から7日以内 → 紹介できる
- `backorder`（メーカー取り寄せ）・`preorder`（予約受付中）・`unavailable` → 販売終了・在庫切れ／`unknown` → 不明／`not_found` → リンク切れ／`mismatched` → 商品情報の不一致 → 除外
- `available` でも7日を超えた → 期限切れで除外
- 記録なし（価格の取得日時だけの商品を含む）→ 販売状況が不明で除外。Redis の一時データ（期限3日）は判断に使わない
- 同じ商品が複数のメンバーに保存されていれば、いちばん新しい結果を使う
- 台本の確定後に商品が購入できなくなったら、ジョブ作成・音声の取り込み・Worker の生成前の各段階で理由を付けて止める（差し替えない）

## 2. 有効にする手順（本番。この順で）

1. **main に反映**（このブランチのコミット。`PRICE_REFRESH_STOCK_FIELDS` 未設定なら挙動は従来どおり）。
2. **保護トリガーの関数を更新**（Mac・オーナーの接続）
   ```bash
   npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts check   # 読み取りのみ。stockFieldsAllowed: false を確認
   npx tsx scripts/price-refresh/stock-guard.ts show                                 # 適用する SQL の確認
   PRICE_REFRESH_STOCK_GUARD_CONFIRM=APPLY npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts apply
   npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts check   # stockFieldsAllowed: true
   ```
3. **リポジトリ変数** `PRICE_REFRESH_STOCK_FIELDS` = `1`。必要なら `PRICE_REFRESH_PRIORITY_PERSONS` = SNS 動画でよく使う人物（カンマ区切り・完全一致・グループはメンバー名。例 `目黒蓮,佐野勇斗,吉田仁人`）。
4. **小規模の確認**：Actions → price-refresh → Run workflow（mode=`manual-test`、persons=`<1人>`）。ログの `status: "ok"`・`halt: null`。
   本番DB（読み取り）でその人物の商品に `stockStatus` が入ったことを確認（下の SQL）。`snapshot.ts compare` で価格・販売状況以外が不変（`"ok": true`）。
5. **定期実行**：リポジトリ変数 `PRICE_REFRESH_ENABLED` = `true`（1日4回 `37 1,7,13,19 * * *`＝JST 10:37・16:37・22:37・4:37）。
6. 数日後に動画の候補を読み込み、D/A/B が作れることを確認。

確認用 SQL（読み取りのみ）：
```sql
SELECT e->>'stockStatus' AS st, count(*), to_timestamp(max((e->>'stockCheckedAt')::numeric)/1000) AS newest
FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.items) e
WHERE e ? 'stockStatus' GROUP BY 1;
```

## 3. 定期更新の運用

- **時刻**：1日4回（UTC 1・7・13・19時37分）。既存の新規商品の発見（`/api/cron/refresh`、UTC 3:00）・VOD（UTC 4:00・5:00）と重ならない。1回の作業は20分まで（ジョブは45分で打ち切り）。
  1日8回（`37 1,4,7,10,13,16,19,22 * * *`）にする場合も UTC 3:00 とは重ならない（UTC 1:37 の回は最長 2:22 に終わる）。
- **429 対策（既存のまま）**：楽天の 429 を受けたら、その回は再試行せずに終了し、全経路共通の停止（Redis `rakuten-api:cooldown`）を記録。
  503 等が3回続いたら終了。1秒1回の共通の呼び出し制御（`rakuten-api:lease`）を動画以外の処理（お買い物診断・管理画面）と共有。
- **重複防止（既存のまま）**：Actions の `concurrency: price-refresh`（同時に1つだけ）＋ Redis のロック（`price-refresh:runner-lock`、最長約25分で自動解除）。
- **途中停止時の再開（既存のまま）**：人物ごとの進み具合（Redis `price-refresh:state` の `nextCategory`）から次回続きを処理。止まったカテゴリの商品は変更していない。
  手動の再開は不要（次の定期実行で続きから）。自動停止の印（`price-refresh:halt`）がある場合だけ、原因を確認して `scripts/price-refresh/halt.ts clear`。
- **優先する人物**：`PRICE_REFRESH_PRIORITY_PERSONS` の人物は、更新の対象（最短更新間隔3日を過ぎた人物）の中で先に処理する。間隔・上限は同じなので楽天APIの回数は増えない。

## 4. 想定される楽天APIのリクエスト数

| 経路 | 回数 |
|---|---|
| 動画（候補・台本・ジョブ作成・音声の取り込み・撮影・生成） | **0**（楽天APIを呼ばない。テストで確認） |
| 販売状況の記録 | **追加 0**（価格更新と同じ検索・取得の結果を使う） |
| 価格更新（1日4回） | 1回の上限 400回（人物30人・20分まで）→ **1日最大 1,600回**。実績（10/23）は1人あたり約21〜35回、1回で約12〜15人 |
| 価格更新（1日8回にした場合） | 1日最大 3,200回 |

販売状況の鮮度の見込み（商品のある人物 393人、1日4回で1日約50〜60人）：1巡は約7日。7日の期限に対してぎりぎりのため、
- 優先する人物（SNS 動画でよく使う人物）は最短間隔3日ごとに更新される → 動画で使う人物は常に期限内
- それ以外の人物で動画を作るときは、期限切れで止まることがある（その場合は manual-test でその人物だけ更新してから作る）
- 安定稼働と 429 の発生状況を確認後、1日8回（1巡約3〜5日）に増やすと、全員が期限内に収まる見込み
- (B) コード指定は1人1回あたり60件まで（`lookup_per_person`）。カテゴリ検索に出ない商品が多い人物は、記録がそろうまで数回かかる

## 5. ロールバック

| 段階 | 戻し方 | 影響 |
|---|---|---|
| 販売状況の記録だけ止める | リポジトリ変数 `PRICE_REFRESH_STOCK_FIELDS` を削除（または 1 以外） | 価格更新は従来どおり続く。記録済みの販売状況は残り、7日で期限切れになる（動画は作れなくなる＝安全側） |
| 定期更新を止める | `PRICE_REFRESH_ENABLED` を `true` 以外 | 既存の緊急停止と同じ |
| 保護トリガーを元に戻す | **先に** `PRICE_REFRESH_STOCK_FIELDS` を外してから、`PRICE_REFRESH_STOCK_GUARD_CONFIRM=UNDO npx dotenv -e .env.local -- npx tsx scripts/price-refresh/stock-guard.ts undo` | 関数を販売状況を許可する前の内容に戻す（2026-11-27 に本番の定義を確認したものと同じ） |
| 記録した販売状況を消す（通常は不要） | オーナーの接続で `UPDATE products SET items = (SELECT jsonb_agg(e - 'stockStatus' - 'stockCheckedAt' ORDER BY i) FROM jsonb_array_elements(items) WITH ORDINALITY AS t(e, i)) WHERE items::text LIKE '%stockStatus%';`（実行前に `backup.ts export`） | サイトの表示は変わらない |
| コード | このブランチのコミットを revert | 価格更新は従来の動き（価格だけ）に戻る |
