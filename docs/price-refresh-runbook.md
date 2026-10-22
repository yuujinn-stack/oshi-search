# 価格の分割自動更新 運用手順（GitHub Actions）

価格更新専用モード（楽天APIだけで保存済み商品の価格を更新。OpenAI は使わない）を、GitHub Actions（公開リポジトリの標準ランナー＝無料）で
3時間ごとに 20分実行するための手順。実装：`src/lib/price-refresh-runner.ts`・`src/lib/price-refresh.ts`・`scripts/price-refresh/*`・
`.github/workflows/price-refresh.yml`。

## 0. 価格更新で変わる DB・Redis の項目（これ以外は変わらない）

| 場所 | 変わる項目 | 変わらないもの |
|---|---|---|
| Neon `products.items[]` | `price`・`priceFetchedAt`（判定が **related** で、楽天の同一性キーが一致した商品だけ。前回の価格から **30%以上** 変わる取得価格は反映せず確認対象〔管理画面「価格更新」の「価格の確認待ち」・ログの `priceReview`〕。unrelated・判定なしの商品は変えない） | 商品の件数・並び・`id`・`title`・`itemUrl`・`affiliateUrl`・`imageUrl`・`category`・`reviewCount`・`reviewAverage`（人物ページの自動の並び順に使うため変えない）・その他すべての項目 |
| Neon `products.fetched_at` | カテゴリ検索で価格を更新したカテゴリ行だけ（カテゴリを再検索した日時） | 行の追加・削除はしない（UPDATE のみ） |
| Neon その他のテーブル | なし（`verdicts`・`persons`・`batch_lock` は読み取りのみ） | 判定（related / unrelated / 手動判定）・掲載状態 |
| Redis | `price-refresh:state`（進み具合）・`price-refresh:runner-lock`・`price-refresh:halt`（自動停止の印）・`price-lookup:<code>`（取得結果、3日）・`rakuten-api:lease` / `rakuten-api:cooldown`（共通の呼び出し制御） | 既存のキー（閲覧数・人気商品・ジョブ等） |

## 1. 最小権限の DB ユーザー（Neon）— 列単位の権限＋トリガー

### 方式の比較
| 方式 | 防げること | 防げないこと | 既存の構造・コードへの影響 |
|---|---|---|---|
| A. テーブル権限（SELECT/INSERT/UPDATE） | 他テーブルの変更・DELETE | products の行の追加、items の内容すべて | なし |
| B. 列単位の権限（`UPDATE (items, fetched_at)`、INSERT なし） | 行の追加・削除、人物名・カテゴリの変更 | items（JSON）の中身の書き換え | 価格更新の保存を UPDATE のみにする（対応済み） |
| **C. B＋トリガー（推奨）** | B に加えて、items の件数・並び・価格の項目以外の変更（商品名・URL・アフィリエイトURL・ID 等）を DB が拒否 | 価格の項目の値そのもの（誤った価格） | トリガー1つと関数1つの追加。価格更新ユーザー以外（サイト・既存の自動更新・管理画面）には効かない |
| D. 更新専用の SECURITY DEFINER 関数（UPDATE 権限なし・関数の実行だけ） | C と同等以上（変更できる形を関数が決める） | 同上 | 価格更新の保存を「差分を関数に渡す」形に作り直す必要（今回は未対応） |

PostgreSQL の列単位の権限は JSON の中のキーまでは分けられないため、**C を推奨**。検証：WASM の PostgreSQL（PGlite）で下の SQL を実行し、
価格の項目だけの変更は成功、商品名・アフィリエイトURL・ID・並び・件数・価格以外の項目の追加・人物名の変更・INSERT・upsert・DELETE・
判定の変更はすべて拒否、通常のユーザーの更新は従来どおり成功（15/15）を確認済み。

### 適用前の確認（2026-10-20、本番 読み取りのみ）
- DB 名 `neondb`、PostgreSQL 18.6。サイト・既存の自動更新・管理画面の接続ユーザーは `neondb_owner`（トリガーは `price_refresher` 以外では何もしない）。
- `products`（`items` jsonb・`fetched_at`）・`persons`・`verdicts`・`batch_lock` が存在。`products` に既存のトリガーなし、同名の関数・ロールなし、行レベルセキュリティ未使用。
- products に書き込む既存の処理（自動更新・管理画面の再取得・手動登録・商品の復旧・商品ID移行スクリプト・新規商品の発見）はすべて `neondb_owner` で動くため、トリガーは冒頭で抜けて従来どおり動く（1行の更新ごとに関数の呼び出し1回分の負荷だけ）。

### 注意：ユーザーは SQL で作る
Neon のコンソール（Roles 画面）・API で作ったユーザーは自動で `neon_superuser` の権限を持つため、最小権限にならない。
**必ず下の SQL（CREATE ROLE）で作る。** パスワードは自分のパソコンで生成する（例：ターミナルで `openssl rand -base64 32`、記号を避けたい場合は `openssl rand -hex 32`）。

### SQL（Neon コンソールの SQL Editor で、オーナー＝neondb_owner で実行。全体を1つのトランザクションにしているので、途中で失敗したら何も適用されない）
```sql
BEGIN;

CREATE ROLE price_refresher WITH LOGIN PASSWORD '<自分で生成したパスワード>';
GRANT CONNECT ON DATABASE neondb TO price_refresher;
GRANT USAGE ON SCHEMA public TO price_refresher;
GRANT SELECT ON products, persons, verdicts, batch_lock TO price_refresher;
GRANT UPDATE (items, fetched_at) ON products TO price_refresher;   -- INSERT・DELETE は付けない

CREATE OR REPLACE FUNCTION products_price_refresher_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  price_keys text[] := ARRAY['price', 'priceFetchedAt'];   -- 変更してよいのはこの2項目だけ（レビュー数・平均も変更不可）
BEGIN
  IF current_user <> 'price_refresher' THEN
    RETURN NEW;   -- サイト・既存の自動更新・管理画面（neondb_owner）には影響しない
  END IF;
  IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.items) <> jsonb_array_length(OLD.items) THEN
    RAISE EXCEPTION 'price_refresher: 商品の件数は変更できません';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE (o.e - price_keys) IS DISTINCT FROM (n.e - price_keys)
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格の項目以外は変更できません';
  END IF;
  -- 変更する場合、price は正の数値、priceFetchedAt は数値だけ（消す・文字列・0以下にはできない）
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE ((n.e -> 'price') IS DISTINCT FROM (o.e -> 'price')
           AND NOT COALESCE(CASE WHEN jsonb_typeof(n.e -> 'price') = 'number' THEN (n.e ->> 'price')::numeric > 0 END, false))
       OR ((n.e -> 'priceFetchedAt') IS DISTINCT FROM (o.e -> 'priceFetchedAt')
           AND jsonb_typeof(n.e -> 'priceFetchedAt') IS DISTINCT FROM 'number')
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格は正の数値、取得日時は数値でのみ更新できます';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER products_price_refresher_guard
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_price_refresher_guard();

COMMIT;
```

### 適用後の確認（データは変わらない）
1. オーナーで：`SELECT tgname FROM pg_trigger WHERE tgrelid = 'products'::regclass AND NOT tgisinternal;` → `products_price_refresher_guard` が1行。
2. `price_refresher` の接続文字列で接続して（下の「接続文字列の作り方」）：
   - `SELECT count(*) FROM verdicts;` → 成功（読み取りできる）
   - `BEGIN; UPDATE verdicts SET verdict = verdict WHERE false; ROLLBACK;` → permission denied（判定は書けない）
   - `BEGIN; UPDATE products SET items = jsonb_set(items, '{0,title}', '"x"') WHERE person_name = '成田凌' AND jsonb_array_length(items) > 0; ROLLBACK;` → 「価格の項目以外は変更できません」で拒否（ROLLBACK するので何も変わらない）
   - `BEGIN; UPDATE products SET items = items WHERE person_name = '成田凌'; ROLLBACK;` → 成功（同じ内容。ROLLBACK するので何も変わらない）
3. サイトの表示・管理画面がいつもどおり動くこと（`neondb_owner` は影響を受けない）。

### 接続文字列の作り方
いまの DATABASE_URL（`postgresql://neondb_owner:<パスワード>@<ホスト>/neondb?sslmode=require...`）の
ユーザー名とパスワードの部分だけを `price_refresher` と生成したパスワードに置き換える。
例：`postgresql://price_refresher:<生成したパスワード>@<同じホスト>/neondb?sslmode=require`

### 失敗したとき・取り消し
- 適用中にエラー：トランザクションなので何も適用されていない。エラー文を確認して修正し、もう一度実行。
- 取り消し（オーナーで実行。サイトには影響なし）：
```sql
BEGIN;
DROP TRIGGER IF EXISTS products_price_refresher_guard ON products;
DROP FUNCTION IF EXISTS products_price_refresher_guard();
REVOKE ALL ON products, persons, verdicts, batch_lock FROM price_refresher;
REVOKE USAGE ON SCHEMA public FROM price_refresher;
REVOKE CONNECT ON DATABASE neondb FROM price_refresher;
DROP ROLE IF EXISTS price_refresher;
COMMIT;
```
- 一時的に止めるだけ：`ALTER ROLE price_refresher NOLOGIN;`（再開は `LOGIN`）。
- `backup.ts restore --apply` で戻すときは、オーナー（.env.local の DATABASE_URL）で実行する（price_refresher ではトリガーにより価格以外を戻せないため）。

## 2. 更新前の状態の保護（Neon のブランチを作らない方法）

1. **ローカルへのエクスポート（推奨・費用なし）**：テスト対象の人物の products の行と verdicts を JSON で保存（読み取りのみ）。
   `npx dotenv -e .env.local -- npx tsx scripts/price-refresh/backup.ts export "成田凌"`
   → `tmp/price-refresh-backups/<日時>/`（git 管理外。楽天の商品情報を含むため共有しない）。
   戻すときは `backup.ts restore <dir> "成田凌"`（既定は違いの表示だけ）→ 必要なら `PRICE_REFRESH_RESTORE_CONFIRM=yes ... --apply`（違いのある products の行だけ UPDATE で戻す。判定は価格更新で変わらないため対象外）。
2. **Neon の履歴からの復元（予備）**：Neon Free は直近6時間（変更量1GBまで）の履歴から復元できる。テスト直後に問題が見つかった場合の予備手段（復元の操作はコンソールの Restore。復元の方法によっては一時的なバックアップ用ブランチが作られる場合があるため、まず 1 を使う）。

## 3. GitHub の設定

1. **Environments → New environment「price-refresh」**：Deployment branches を `main` だけ。Environment secrets：
   `PRICE_REFRESH_DATABASE_URL`（1 の専用ユーザー）、`UPSTASH_REDIS_REST_URL`・`UPSTASH_REDIS_REST_TOKEN`（Vercel と同じ Upstash）、`RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`・`RAKUTEN_AFFILIATE_ID`。**`OPENAI_API_KEY` は登録しない。**
2. **Actions → Variables**：`PRICE_REFRESH_ENABLED` = `false`。小規模テストが2人とも成功するまで `true` にしない。`true` 以外のあいだは、schedule は何もせず、手動実行の `full`（全件）も実行できない（`dry-run` と `manual-test`〔人物2人まで〕だけ）。緊急停止のスイッチも兼ねる。
3. **安全性**：ワークフローは `workflow_dispatch`（書き込み権限のある人の手動実行）と、有効化後の `schedule`（既定ブランチのみ）だけで起動し、`pull_request` では起動しない。フォークからの PR には Secrets が渡されない。Secrets はログでマスクされる。ログは件数の要約だけ（ライブラリの詳細ログ・例外の内容は出さない）。外部 Action はコミットSHAで固定、checkout はトークンを保存しない、`permissions: contents: read`。

## 4. 本番での小規模テスト（まず1人、成功したら2人目）

対象：1人目 **成田凌**（商品のあるカテゴリ2・保存商品11件・推定 API 6〜24回＋コード指定3件）、2人目 **賀喜遥香**（カテゴリ6・2,174件・手動登録87件・推定 API 18〜72回＋コード指定60件）。

各人物で次を順に行い、どこかで想定外があれば先に進まない。
実行する時間帯：既存の商品の自動更新（毎日 12:00〜12:10 頃 JST）と重ならない時間にし、実行中は管理画面で同じ人物の商品の再取得・編集をしない
（既存の経路は従来どおりの間隔制御のため。重なっても価格以外の変更を検知すれば自動停止する）。
1. **保存（ローカル）**：`backup.ts export "<人物>"`、`snapshot.ts snapshot before-<人物>.json "<人物>"`。
2. **dry-run**：Actions → price-refresh → Run workflow（mode=`dry-run`、persons=`<人物>`）。ログで対象カテゴリ数・推定 API 回数・コード指定の候補数・DB 更新対象の行数を確認。
3. **更新**：Run workflow（mode=`manual-test`、persons=`<人物>`、budget_min=`20`）。ログの `status: "ok"`、`completed: 1`、`halt: null`、`failedCategories: {}`、`stopDetail: null`。
   `failedCategories` に `503`・`429` 等があれば（楽天から取得できなかったカテゴリ。保存済みの商品は変更していない）、先に進まず原因を確認する。
4. **比較（ローカル）**：`snapshot.ts snapshot after-<人物>.json "<人物>"` → `snapshot.ts compare before-<人物>.json after-<人物>.json`。
   `"ok": true`（判定・件数・ID と並び・価格以外の全項目が不変）と、`pricesChanged`・`priceFetchedAtSet`（価格・取得日時が入った件数）を確認。
   同時に `backup.ts restore <dir> "<人物>"`（違いの表示だけ）で `verdictsUnchanged: true`。
5. **表示**：本番の人物ページで、更新した商品の楽天リンク・商品名・画像が変わらず、価格だけが新しくなっていること（価格の取得日時の表示〔「M/D時点」〕は今回の公開に含めていない）。
6. **想定外の変更があったとき**：変数 `PRICE_REFRESH_ENABLED` を `false` のまま、`backup.ts restore ... --apply` で戻し、原因を調べる。

自動の安全装置：実行中、人物ごとに処理の前後で「価格以外」の指紋（カテゴリごとの件数と価格の項目を除いた内容のハッシュ、判定のハッシュ）を DB で比較し、
違えば Redis に停止の印を記録してその場で終了する（ログに `status: "halted"`。ワークフローは失敗として通知される）。印がある間は手動・定期とも何もしない。

## 5. 定期実行の開始（小規模テストが2人とも成功してから）

1. `.github/workflows/price-refresh.yml` の `schedule:` のコメントを外して main に反映
   （`37 1,4,7,10,13,16,19,22 * * *`＝3時間ごと。既存の新規商品の発見〔UTC 3時台〕と重ならない時刻）。
2. 変数 `PRICE_REFRESH_ENABLED` を `true`。
3. 最初の数回はログの `status`・`stoppedBy`（`budget` が通常。`rate_limited` が続く場合は頻度を下げる）・`halt` を確認。
4. 1週間ほど、6 の使用量を確認。`scripts/price-refresh/coverage.ts` で取得日時のある公開中の商品の割合を確認する（価格の取得日時の表示は別途公開を判断する）。

## 6. 無料枠の確認

| サービス | 確認方法 | 無料枠 | 価格更新の見込み（3時間ごと×20分） |
|---|---|---|---|
| Upstash Redis | console.upstash.com → 対象データベース → **Usage** タブ（Daily Commands のグラフ、今月の合計）。Data Browser でキー数 | 50万コマンド/月 | 約6〜7万/月（進み具合・ロック・共通の呼び出し制御・取得結果のキャッシュ・指紋は DB 側なので不要） |
| Neon | console.neon.tech → プロジェクト → **Monitoring / Usage**（Compute hours、Network transfer、Storage）。ストレージは SQL `SELECT pg_size_pretty(pg_database_size(current_database()));`（現在 105MB） | 100 CU時間・転送5GB/月・1GB | 約20 CU時間・約1GB/月 |
| GitHub Actions | リポジトリ → Actions（各実行の時間） | 公開リポジトリは無料 | 1日8回×約25分 |

- 判断の目安：今月の使用量（既存分）＋上の見込みが無料枠の **7割を超える**なら、頻度を下げる（例 `37 1,7,13,19 * * *`＝6時間ごと）か `budget_min` を減らす。
- 小規模テスト（1人）の負荷：Redis 約30コマンド、Neon 転送 1MB未満。
- 超過時：Neon はコンピュートが次の請求期間まで停止（データは消えない＝サイトも止まる）、Upstash Free は超過時の扱いが公式に明記されていない。超えない運用を前提にする。

## 7. 緊急停止・再開

状況の確認：管理画面 **/admin/price-refresh**（読み取りのみ）で、自動停止の有無・実行中か・直近の実行の要約・人物ごとの直近の結果
（更新件数・楽天から取得できなかったカテゴリと HTTP ステータス）・公開中の商品の価格の取得状況（30日以内／古い／不明）・
人物ごとの「価格を更新できていない商品」と理由の目安を確認できる。

| 状況 | 操作 | 効果 |
|---|---|---|
| 定期実行を止める | 変数 `PRICE_REFRESH_ENABLED` を `false` | 次回以降の schedule は何もしない |
| 実行中のジョブを止める | Actions → 実行中の run → Cancel workflow | 保存済みのカテゴリ以外は不変。次回は続きから（ロックは最長約25分で自動解除） |
| ワークフローごと止める | Actions → price-refresh → … → Disable workflow | 手動も含め起動しない |
| DB への書き込みを即時に止める | Neon で `ALTER ROLE price_refresher NOLOGIN;` | 接続不可（サイトは別ユーザーなので影響なし） |
| 自動停止したとき | `halt.ts status` で人物と理由を確認 → `snapshot.ts compare`・`backup.ts restore`（違いの表示）で原因を確認 → 必要なら `backup.ts restore --apply` → 問題が無ければ `PRICE_REFRESH_HALT_CLEAR_CONFIRM=yes ... halt.ts clear` | 印を消すまで手動・定期とも実行しない |
| 再開 | 変数を `true`（Disable した場合は Enable） | 進み具合の続きから |

- 楽天APIの 503 等のエラー・通信エラー・保存の失敗が **3回続いたら**（人物をまたいでも数える。取得できたカテゴリ・商品があれば数え直す）その回を自動で終了し、原因（カテゴリと HTTP ステータス）と止まった位置（人物・カテゴリ）を記録する（ログの `stopDetail`、管理画面の「楽天のエラーで終えた位置」。Actions は失敗として通知）。失敗したカテゴリは次回もう一度取得する。
- 楽天APIの 429 は、待ってから1回だけ再試行し、それでも 429 ならその回を自動で終了する。共通の停止（60秒以上）を記録し、価格更新は停止中は楽天へ送らない。既存の商品の自動更新・管理画面は従来どおりの間隔制御（共通の使用権は使わない）。
- 取得できなかった商品（429・エラー・検索結果に出ない・在庫切れ）は、価格も価格の取得日時も変更しない。
- 公開リポジトリの schedule は、リポジトリに60日間活動が無いと自動停止する（Actions 画面で Enable）。
- 管理画面での商品の編集・再取得を、価格更新の実行中に同じ人物に対して行うと、自動停止することがある（安全側の停止。確認して印を消せばよい）。

## 8. 価格の確認待ちの承認・却下（管理画面 /admin/price-refresh）

前回の価格から30%以上変わる取得価格（または前回の価格が無い商品）は自動で反映せず、確認待ちにする（このルールは変えない）。

- **保存先**：価格更新（price_refresher）は確認待ちを Redis の受け取り箱 `price-refresh:review-inbox`（上限20,000件）と人物の直近の結果に書く（price_refresher に新しいテーブルの権限は付けない）。管理画面の「取り込む」ボタン、または承認・却下のときに DB の `price_reviews` に取り込み、取り込んだ項目を受け取り箱から消す（取り込み中に価格更新が書き直した項目は消さない）。DB に入った確認待ちは、承認・却下・新しい変更案が出るまで残る。
- **画面の表示は読み取りのみ**：/admin/price-refresh を開く（GET）だけでは DB・Redis に書き込まない（未取り込みの件数を表示するだけ）。
- **受け取り箱が満杯のとき**：新しい確認待ちは追加せず、追加できなかった数を `price-refresh:review-inbox-dropped` に数えて管理画面に警告を出す。保存済みの価格は変えていないため、次にその人物の価格を更新したときに再び確認待ちになる（失われたままにはならない）。80%を超えたら管理画面に「取り込む」の案内を出す。
- **承認**：確認ダイアログで変更前後の価格を確認 → 1つのトランザクション（Serializable）で、確認待ちを承認済みにし、商品の `price`（取得した価格）と `priceFetchedAt`（楽天から取得した日時）だけを更新し、履歴（`price_review_logs`）を追加する。承認直前に DB 側で「同じIDの商品が1件だけ・保存済みの価格が変更前の価格のまま・商品ページURL／アフィリエイトURL／itemCode が検出時と同じ・判定が related」を確認し、違えば何も更新しない（確認待ちから外し、履歴に「反映せず」と残す）。取得から14日以上経った価格（14日ちょうどを含む）は承認できない（却下は可）。
- **却下**：商品は変更しない。状態と履歴だけ。同じ組（変更前の価格・取得した価格）は次の価格更新でも再表示しない。取得した価格が変わるなど別の変更案になれば、再び確認待ちになる。
- **同時更新で失われない**：商品の書き込み（新商品の発見・管理画面の編集・手動登録・復旧・価格更新）は、読んだ時点の items と一致する場合だけ保存し、違えば読み直して作り直す（src/lib/product-write-guard.ts）。承認は DB の中で該当商品の2項目だけを変えるため、承認と他の更新が重なっても、どちらの変更も残る。何度読み直しても一致しない場合は保存せずエラー（他の更新は残る）。`scripts/price-refresh/backup.ts restore --apply` は意図的に保存済みの状態へ戻す操作のため対象外。
- **変わらないもの**：商品名・商品URL・アフィリエイトURL・画像・判定・表示状態・並び順・カテゴリの再検索日時（products.fetched_at）・他の商品。
- **本番の準備（テーブルの作成）**：`/admin/db-init` は使わない（全テーブルの CREATE・ALTER 約150文を毎回実行し、既存テーブルにも一時的なロックを取るため）。Mac のプロジェクトのフォルダで
  1. `npx tsx scripts/price-review/setup-tables.ts check`（読み取りのみ。実行する5文〔2テーブル・3インデックス〕と、既存の products・verdicts の指紋を表示）
  2. `npx tsx scripts/price-review/setup-tables.ts apply`（「APPLY」と入力したときだけ。drizzle/0020_price_reviews.sql の文だけを1つのトランザクションで実行。CREATE TABLE/INDEX IF NOT EXISTS 以外の文が含まれていれば実行しない）→ 作成後に列・インデックスと、既存の products・verdicts の指紋が作成前と同じことを確認
  3. 取り消し：`npx tsx scripts/price-review/setup-tables.ts undo`（2テーブルが空のときだけ削除。既存の商品・判定は変わらない）
  - 未作成の間、管理画面は「テーブルが未作成」と表示し、承認・却下・取り込みはできない（価格更新・既存の機能は従来どおり動く）。
  - db-init にも同じ CREATE 文を入れてあるため、後で db-init を実行しても二重には作られない（IF NOT EXISTS）。
