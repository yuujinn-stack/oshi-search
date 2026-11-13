# 動画生成 Instagram版・TikTok版（SNS別CTA）公開・検証・ロールバック手順

対象: Task 189（動画の最後のCTAだけを SNS 別に差し替える機能）。
**この手順書は実施の許可ではない。** コミット・push・デプロイ・Worker の再起動は、実施を決めてから行う。

---

## 0. 前提と影響範囲

| 項目 | 内容 |
|---|---|
| DB | 変更なし（出力先SNSの指定はジョブの `template_input.snsOutput`、結果は `result.snsOutputs`。列・テーブルは増やさない） |
| Redis | SNS別CTA設定を1件だけ保存。本番（`VERCEL_ENV=production`）はキー `video-maker:sns-cta-settings:v1`、Preview は `…:v1:preview`、ローカル等は `…:v1:local` 等（同じ Redis でもキーが別なので、Preview で保存しても本番は変わらない）。未保存なら既定値 |
| 環境変数 | 追加なし（推しサーチ・Worker とも）。Worker の `SNS_CTA_AUDIO_DIR` は確認用（本番の Worker には設定しない） |
| Vercel Blob | TikTok 版を `video-jobs/{ジョブID}/sns-tiktok-{乱数}.mp4` に保存（既存の final.mp4・ig-reel.mp4 と同じストア・同じ発行方式） |
| Instagram 版 | 既定は「テンプレートのCTAのまま」= final.mp4 そのもの（バイト単位で同一）。ig-reel.mp4 も従来どおり final.mp4 から作る |
| 従来のジョブ | 出力先SNSの指定が無いジョブ（古い画面・API・従来のジョブの再生成）は、Worker が従来とまったく同じ処理をする |

TikTok 版の作り方（テンプレート別）:
- 最後の CTA シーンを差し替える: 推し活で損してるかも？・サイト誘導リール・総合メディア紹介・登録グループ紹介（リール）・推し活お買い物診断・推し布教カード紹介・推しでサブスク比較・サブスク比較機能紹介・まず見る3作・気になる人紹介・推し活あるある（音声なしのみ）
- 動画の最後に付け足す: フォロー獲得リール（最後のシーンが内容のまとめ・締めの1文で、誘導は「推しサーチ / oshi-search.jp」の札だけのため。内容を消さない）
- 対象外: ストーリーズ用（story_*）、旧 oshi-short-v1、推し活あるあるの CapCut 版
- SRT を出力しないテンプレート（まず見る3作・気になる人紹介・推しでサブスク比較・サブスク比較機能紹介・推し活あるある）は、Instagram 版・TikTok 版とも SRT なし（従来の仕様どおり）

---

## 1. Git の変更範囲（2つのコミットに分けて、1回のデプロイで公開）

本番は「別の作業フォルダ（worktree）で origin/main からコミットし、`origin/main` へ push → Vercel が自動で本番デプロイ」で公開している。
`~/dev/oshi-search`（main）は origin/main より21コミット遅れていて、他のタスクの未コミット変更も多いため、**ここでコミット・push しない**。

本番の基準（origin/main `45c3dce`）で作った2つのコミット（`~/dev-backup/2026-11-13-tiktok-cta/commit-split-origin-main/`）:
1. `0001-feat-video-maker-warn-when-queued-video-jobs-are-not.patch` — Task 177（Worker 停止の警告。3ファイル）
2. `0002-feat-video-maker-generate-Instagram-and-TikTok-versi.patch` — Task 189（TikTok 対応。20ファイル。本番側の「総合メディア紹介」の作成経路にも出力先SNSを渡す1行ずつを含む）

確認済み（origin/main に当てた状態）: 1つ目だけで tsc 0件・video-worker-stall 5件成功。2つとも当てて tsc 0件・vitest 190ファイル 2,908件成功・`next build` 成功（129ページの静的生成まで）。
本番側の変更（総合メディア紹介など）と重なった3か所は「両方の項目を残す」で解消済み。

公開時の手順（**実施は許可を得てから**）:
```
cd ~/dev/oshi-search
git fetch origin                                   # origin/main が 45c3dce から進んでいないか確認（進んでいたら当て直しの確認が必要）
git worktree add ~/dev/oshi-search-tiktok-cta -b feat/tiktok-cta origin/main
cd ~/dev/oshi-search-tiktok-cta
git am ~/dev-backup/2026-11-13-tiktok-cta/commit-split-origin-main/000*.patch
npm ci && npx tsc --noEmit && npx vitest run   # 念のため
git log --oneline -3                               # 2コミットが origin/main の上にある
git push origin HEAD:refs/heads/main               # fast-forward のみ（force しない）→ Vercel が本番デプロイ
```
- 開発ログ（docs/development-log.md）は他のタスクの記録が多く混ざるため、この2コミットには含めていない（必要なら別途）。
- oshi-video-maker（Worker）はリモートが無く、作業フォルダ `~/dev/oshi-video-maker` のコードを Worker が直接使う。Task 189 の Worker 側のファイル一覧は `~/dev-backup/2026-11-13-tiktok-cta/commit-split/worker189-files.txt`（正式な CTA 音声 `assets/audio/shared/sns-cta/59d1c4bc.wav`・`.json` を含む。`_inbox/` は含めない）。他の未コミット変更（assets/audio の音声・.gitignore 等）とは重ならない。Worker が起動（11/10）した後に変わったコードは Task 189 のファイルだけ。

## 2. Preview と本番の Redis

調査結果（Vercel の環境変数の名前と適用環境だけを確認。値は見ていない）:
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`（このアプリが使う Redis）と `DATABASE_URL` は **Production と Preview で同じ1件の設定**（同じ Redis・同じ DB）。`KV_*`・`REDIS_URL` もあるがコードからは使っていない。
- `VIDEO_WORKER_SECRET` は Production だけ（Preview には Worker 用 API が使えない）。ローカルの `.env.local` には Redis の設定が無い。

今回の対応（コードだけ。本番のデータ・Vercel の設定は変更していない）:
- SNS別CTA設定のキーを環境で分けた。本番は従来のキーのまま、Preview は `video-maker:sns-cta-settings:v1:preview`。Preview の管理画面には「この環境（Preview）の設定です。本番の設定とは別に保存され、本番には影響しません」と表示。テストで「Preview で保存・既定に戻すをしても本番のキーの値は変わらない」ことを確認。

残る共有（今回の機能の前からあるもの）:
- Preview の管理画面で動画のジョブを作ると、本番 DB にジョブが入り、本番の Worker が処理する（Preview でジョブを作らないこと）。
- 他の機能の Redis のキー（閲覧数・ランキング・管理画面の使用状況等）も Preview と本番で共有。

完全に分ける場合の作業（**実施は別途判断**。本番の値は変更・削除しない）:
1. Vercel Marketplace で Preview 用の Upstash Redis を新しく作る（本番の Redis には触れない）。
2. Vercel の環境変数で、既存の `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` の適用環境から Preview だけを外す（値は変えない。Production のままにする）。外す前に、Production にチェックが残ることを画面で確認する。
3. 同じ名前の変数を Preview だけに、新しい Redis の値で追加する。
4. Preview を作り直し（再デプロイ）、Preview の管理画面で SNS別CTA設定を保存し、Upstash の管理画面で新しい Redis にキーが入り、本番の Redis には入らないことを確認。本番の画面・計測が従来どおり動くことを確認。
5. DB も分ける場合は Neon のブランチを作り、`DATABASE_URL` を同じ手順で Preview だけに設定する（Task 188 の注意と同じ）。
- 戻し方: Preview 用の変数を消し、既存の変数の適用環境に Preview を戻す。

---

## 3. TikTok 用 CTA の CapCut 音声の登録

正式な文言: **「気になったら、推しサーチで検索！」**（キー `59d1c4bc`）

読み上げの設定（既存の Instagram 動画と同じ）:
- 声: **傲慢な王女**（既存の CapCut 音声はすべてこの声。`src/config/capcutNarrationConfig.ts`）
- 速さ: **1.0倍で録音する**。推し活あるある・推しでサブスク比較・サブスク比較機能紹介はテンプレートの設定が 1.18倍のため、TikTok 版を作るときに自動で 1.18倍にする（声の高さは変えない）。録音を2本作る必要はない。
- 音量: 書き出したままでよい。TikTok 版を作るときに、CTA の直前（約8秒）のテンプレートの声と同じ大きさ（Integrated Loudness）に自動で合わせる（ピークは既存の上限 -1.5 dBTP 以内）。
- 読み（CapCut に入力する文）: `きになったら、おしサーチでけんさく！`（「推しサーチ」を「おしサーチ」と読ませる。表示・字幕は「推しサーチ」のまま）

手順:
1. CapCut で上の読みを「傲慢な王女」・1.0倍で読み上げ、1文だけの音声にする（前後の無音は自動で除くので多少あってよい。15秒以内）。
2. WAV で書き出す。ファイル名: `sns-cta__59d1c4bc.wav`（CapCut が `.WAV` を付けて `….wav.WAV` になった場合、受信フォルダの自動取り込みでは拾われないため、名前を直すか 4 の CLI でそのファイルを指定して登録する）
3. 書き出し先: `~/dev/oshi-video-maker/assets/audio/shared/sns-cta/_inbox/`（CapCut 受信フォルダ `assets/audio-capcut/_inbox` とは別）
4. 取り込み:
   - 新しい Worker が動いていれば、次のジョブの合間に自動で取り込む（`assets/audio/shared/sns-cta/59d1c4bc.wav` に保存、元のファイルは `_imported/` へ、失敗は `_inbox/_failed/` へ移り Worker のログに理由）。
   - Worker を再起動する前に登録する場合（本番の Worker・API には影響しない）:
     ```
     cd ~/dev/oshi-video-maker
     npx tsx scripts/sns/snsCtaAudio.ts --wav=<書き出したWAV> --text="気になったら、推しサーチで検索！"
     ```
5. 登録の確認:
   ```
   npx tsx scripts/sns/snsCtaAudio.ts --list
   # 59d1c4bc  1.9秒前後  <日時>  気になったら、推しサーチで検索！  のように出る
   ```
   推しサーチの管理画面（新しい Worker の生存報告が届いた後）: 出力先SNS で CapCut ナレーションを選ぶと「🟢 … 登録済みです（○秒）」。
6. 録り直す場合: 同じ名前で受信フォルダに置き直せば上書きされる（以前に取り込んだ元の WAV は `_imported/` に日時付きで残る。前後の無音を除いた登録済みの `assets/audio/shared/sns-cta/59d1c4bc.wav` は上書きされる）。

---

## 4. 登録後の再検証（ローカルだけ。本番の API・Worker・DB は使わない）

テンプレートごとの最新の生成済み動画（`out/` の下）をコピーし、登録した音声で TikTok 版を作り直して自動で確認する。元の出力フォルダは変更しない。

```
cd ~/dev/oshi-video-maker
npx tsx scripts/sns/snsVerify.ts --work=/tmp/sns-verify-$(date +%Y%m%d-%H%M)
#   --mode=capcut   CapCut 音声の動画だけ（約4分） / --mode=none 音声なしだけ / 省略で両方（約8分）
#   --templates=oshi-sonkamo-v1,site_vod_service_search   テンプレートを絞る
```

結果: 作業フォルダの `report.md`（テンプレート・方式ごとに OK / NG と数値）。自動で確認する項目:
1. Instagram 版 = final.mp4・narration.srt とバイト単位で同一
2. 切り替え前の映像が final.mp4 と同じ（差 4 未満。再エンコードの差は約 1.5〜2）・切り替えのフレームから CTA
3. 切り替え前の音声が final.mp4 とずれていない（±10ミリ秒・一致度 0.98 以上）
4. 切り替え後、CTA の声までテンプレートの声が残らない（前の文のはみ出しを残す場合はその後が無音）
5. 登録した音声が、字幕の開始時刻どおりの位置に置かれている（波形の照合。±0.02秒）
6. CTA の字幕と声の聞こえ始め・聞こえ終わり（目安。±0.15秒）
7. 読み終わりの後 0.3秒以上で動画が終わる
8. CTA の声の音量が直前の声と ±2 LU 以内

目で確認すること（各フォルダの画像と、`tiktok.mp4` の再生）:
- `check-1-before.png`（切り替え直前）→ `check-2-cta-start.png`（CTA の最初のフレーム）→ `check-3-typed.png`（入力が終わった後）→ `check-4-last.png`（最後）
- 声: 前の部分と同じ声（傲慢な王女）・同じ速さ・同じ大きさに聞こえる。「推しサーチ」を「おしサーチ」と読んでいる
- 字幕: `tiktok.srt` の「気になったら、」「推しサーチで検索！」の区切りは読みの拍数からの見積もり（区切りの位置だけ実際の声と最大 0.2〜0.3秒ずれることがある。全体の開始・終了は声に合わせてある）
- アニメーション: 検索窓が出る → 0.27〜0.77秒で「推しサーチ」を入力 → 検索ボタンが1回だけ軽く大きくなる → 最後まで検索窓を表示。文字が震えない
- TikTok アプリで下書き（非公開）に `tiktok.mp4` を入れてプレビューし、文字・検索窓が右側のボタン・下部のキャプションに重ならない（実測: 文字・検索窓は横 90〜919px・縦 411〜1260px）

確認用の仮音声で 2026-11-13 に実行した結果: 75/75 合格（音声付き 37・音声なし 38）。

---

## 5. 本番での最終テスト（実際の管理画面と Worker。3パターン）

前提: 1〜4 が終わっている（推しサーチ反映・Worker 再起動・CTA 音声の登録）。生成は1本ずつ。待機中・生成中のジョブが無いときに行う。

### 準備
- Worker のログ（`~/Library/Logs/oshi-video-maker/worker.log`）の起動行が `動画生成Worker(phase-r1a.2-sns)`。
- 管理画面の「出力先SNS」が表示され、初期値が「Instagram ＋ TikTok（両方）」。テンプレートを選んだときに「Worker が TikTok 版に未対応」の注意が出ない。
- 比較用に、テストするテンプレート・人物で以前に作った完了ジョブ（Instagram 版の基準）を1つ控える。

### A. Instagram のみ（最重要: 従来どおりであること）
1. 対応テンプレート（例: 推し活で損してるかも？・音声なし）を選び、出力先「Instagramのみ」で生成。
2. 確認:
   - ジョブが完了し、従来の欄（動画・ダウンロード・QA・投稿文・SRT の欄・Instagram 用動画・リール予約）がすべて従来どおり表示される。
   - 「SNS別の動画」に Instagram 版だけが出て「テンプレートのCTAのまま」。プレビューがジョブの動画と同じ。
   - 「Instagram版をダウンロード」したファイルと、従来の「⬇ ダウンロード」のファイルが同一（`md5 <ファイル1> <ファイル2>` が一致）。
   - 以前の完了ジョブと比べて、CTA（文言・ナレーション・字幕）・長さ・画面の構成が同じ（撮影した画面の内容は日によって変わる）。
   - Instagram 用動画（ig-reel.mp4）が作られ、リール予約の操作が従来どおりできる。
   - Worker のログに「SNS別の動画を作成中」「Instagram版: テンプレートのCTAのまま」が出て、TikTok の処理が走っていない。

### B. TikTok のみ
1. 同じテンプレートで、出力先「TikTokのみ」で生成。
2. 確認:
   - 「SNS別の動画」に TikTok 版だけが出る。最後が「気になったら『推しサーチ』で検索！」の検索窓の CTA で、旧 CTA（プロフィールのリンク等）の文字・声が無い。
   - 「TikTok版をダウンロード」「⬇ SRT」で `…_tiktok.mp4`・`…_tiktok.srt` が保存される。SRT の最後が「気になったら、」「推しサーチで検索！」。
   - Instagram 用動画（ig-reel.mp4）は作られない（Instagram に出さないため。想定どおり）。
   - CapCut 音声の動画でも1本行い、CTA の声が入っていること・同じ声・同じ大きさであることを聞いて確かめる。

### C. Instagram ＋ TikTok（両方）
1. 同じテンプレートで、出力先「Instagram ＋ TikTok（両方）」で生成（CapCut 音声の動画で1本、音声なしで1本）。
2. 確認:
   - 「SNS別の動画」に2つのプレビュー。Instagram 版は A と同じ確認（ジョブの動画と同一）、TikTok 版は B と同じ確認。
   - 「両方をまとめてダウンロード（MP4・SRT）」で4ファイル（SRT を出力しないテンプレートは2ファイル）が保存される（ブラウザが複数のダウンロードの許可を求めたら許可）。
   - 生成時間が A より約5〜10秒長い程度（動画全体を2回作っていない）。

### 失敗時の確認（任意）
- CTA 音声を登録していない文言で CapCut 版を「両方」で作ると、TikTok 版だけが「CapCut 音声が未登録です（キー …）」で失敗し、Instagram 版は使える。
- 対象外のテンプレート（ストーリーズ等）では、出力先が「両方」でも Instagram 版だけになる旨が表示され、「TikTokのみ」では生成できない旨が表示される。

### 既存機能の確認
- 出力先を指定しない操作（再生成・CapCut 音声の付け直し・自動取り込み）でも従来どおり生成される（音声付きの動画は、元の音声なし動画の出力先を引き継ぐ）。
- 他のテンプレート（まず見る3作・推しでサブスク比較・フォロー獲得リール等）で、従来のナレーション・SRT・投稿文の欄が変わっていない。

---

## 6. 安全なデプロイ順序（既存の待機中・生成中のジョブに影響させない）

互換性: 推しサーチ・Worker のどちらが先でも壊れない。古い Worker はテンプレートの対応（snsCta）を報告しないため、新しい管理画面は出力先SNSの指定を送らず従来どおりのジョブを作る。デプロイ前に作られたジョブ（指定なし）は、新しい Worker でも従来と同じ処理になる。

1. 正式な CTA 音声の登録と再検証（済み: 75/75 合格）。
2. **推しサーチを公開**（1 の手順で push → Vercel 本番デプロイが Ready になるまで待つ）。
   - Vercel のデプロイは切り替え式のため、待機中・生成中のジョブはそのまま（Worker 用 API も互換）。
   - Preview では表示だけ確認し、ジョブは作らない（Preview も本番 DB を使うため）。
3. **Worker を再起動**（生成中のジョブが無いときだけ）。
   - `launchctl kickstart -k` は Worker をすぐに止める（生成中のジョブは途中で止まり、15分後に失敗扱いになる）。必ず先に確認する:
     - 管理画面で「生成中」のジョブが無い（待機中のジョブは残っていてよい。再起動後の Worker が新しいコードで処理する）
     - `tail -3 ~/Library/Logs/oshi-video-maker/worker.log` が生成中でない（「まず見る3作の台本準備」は動画生成のジョブではないため、待機中・生成中のジョブには影響しない）
   - `launchctl kickstart -k gui/$(id -u)/jp.oshi-search.video-worker`
   - ログの起動行が `動画生成Worker(phase-r1a.2-sns)`、テンプレートの一覧が出て、エラーが無いこと。
4. **本番での確認**（5 の A → B → C を1本ずつ）。Instagram のみ（A）を最初に行い、従来の動画と同一であることを確かめてから TikTok を含む B・C へ進む。

## 7. ロールバック

- **推しサーチ**: Vercel のダッシュボードで、ひとつ前の本番デプロイを Promote（Instant Rollback）する（すぐに戻る。DB・環境変数の変更なし）。コードも戻す場合は、worktree で2コミットを `git revert` して push する。
  - 戻した後: TikTok 版の結果（`result.snsOutputs`）は管理画面に表示されなくなる（データ・Blob は残る）。新しい版で作った「従来の人物テンプレート（まず見る3作など）」のジョブを古い版で「再生成」すると、template_input の出力先SNSの指定を受け付けずに失敗する（新しく作り直せばよい）。
  - Redis の設定キー（`video-maker:sns-cta-settings:v1`・`…:preview`）は残っても影響しない。
  - `~/dev/oshi-search` の作業ツリーを `git restore` で戻さない（他のタスクの未コミット変更があるため）。
- **Worker**: 生成中のジョブが無いことを確かめてから、変更した2ファイルを戻して再起動する（この2ファイルには Task 189 以外の未コミット変更なし）。
  ```
  cd ~/dev/oshi-video-maker
  git restore scripts/worker/videoWorker.ts scripts/worker/searchApiClient.ts
  launchctl kickstart -k gui/$(id -u)/jp.oshi-search.video-worker
  ```
  戻した Worker は SNS別CTA を報告しないため、新しい推しサーチの管理画面は自動的に Instagram 版だけになる。新規ファイル（`scripts/sns/` 等）・登録した音声は残しても動作に影響しない。控え: `~/dev-backup/2026-11-13-tiktok-cta/`。
