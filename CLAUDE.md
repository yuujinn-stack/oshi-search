# oshi-search — Claude Code 開発ガイド

## 開発ログを必ず参照すること

新しい実装・修正・調査を始める前に、必ず以下を確認してください。

```
docs/development-log.md
```

このファイルには、これまでに実装した機能・変更ファイル・設計上の決定が記録されています。
既存の実装と重複・矛盾しないように、常に参照してから作業してください。

---

## 実装完了後のルール

機能を実装・修正したら、`docs/development-log.md` に以下を追記してください。

- Task番号と機能名
- 目的
- 変更したファイルと内容
- 設計上の判断・注意点

---

## プロジェクト概要

- **フレームワーク：** Next.js App Router（Server / Client Components）
- **DB（正本）：** Neon PostgreSQL（`@neondatabase/serverless` + Drizzle ORM / `drizzle-orm/neon-http`）。スキーマは `src/db/schema.ts`、本番へのテーブル追加は `/admin/db-init`（`src/app/api/admin/db-init/route.ts`）経由
- **Redis（補助用途）：** Upstash Redis（`@upstash/redis`）。閲覧数・クリック数等の計測カウンタ（`/api/track`・`/api/search-track`）、ランキング集計、ジョブキュー・ロック等の補助データのみ。人物・作品・配信情報・商品の正本ではない
- **スタイル：** Tailwind CSS + CSS変数によるテーマシステム
- **デプロイ：** Vercel

## VOD「現在視聴可能」判定・料金情報

- 公開画面の「配信中として確認済み」「今すぐ見られる」判定は `src/lib/vod-availability.ts`（`getConfirmedProviders` / `getStreamingProviders`）の共通関数を使う。ページごとに同じ判定を書き写さない
- VODサービスの月額料金は `src/lib/vod-plan-info.ts` だけで管理する（公式サイトのみを一次情報とし、`checkedAt` は実際に確認した日付。確認できないものは `isComparable=false`）
- 推しに合うサブスク診断（`/oshi-vod`）の計算は `src/lib/oshi-vod/core.ts` の純粋関数に集約。ランキングにアフィリエイト提携情報を渡さない

## テーマシステム

- `data-design="trust|oshi|dark"` を `<html>` に付与
- CSS変数 `--ds-bg`, `--ds-surface`, `--ds-primary`, `--ds-cta`, `--ds-radius` 等で制御
- `src/lib/designTheme.ts` がテーマ定義の中心

## 管理画面の人物選択

- 全管理画面共通で `src/components/admin/PersonCombobox.tsx` を使用
- 基本的な `<select>` への置き戻し禁止

## ChatGPT向けプロンプト生成

- CSVを依頼するすべてのプロンプトは `src/lib/chatGptPromptUtil.ts` の `csvDownloadSection(filename)` を末尾に追加すること
- 新しくプロンプト生成関数を作る場合も必ず適用

## 型チェック

実装後は必ず確認すること：

```bash
npx tsc --noEmit
```



## Canva / Instagram automation

Canva・Instagram投稿量産関連の新規コードは、
原則 `tools/canva-instagram/` 配下に配置する。

生成したCSVや一時出力ファイルは、
`tools/canva-instagram/output/` に保存する。

Canva・Instagram関連の作業では、
既存の `src/`、`drizzle/`、`scripts/` などは
調査・参照してよいが、
ユーザーから明示的な指示がない限り変更しない。

既存の公開サイト、管理画面、DB schema、既存データに
影響する変更は、ユーザーの明示的な許可なしに行わない。

既存の人物・作品・VOD・画像データを利用できる場合は、
新しく重複したデータ管理を作らず、既存データを参照する。

Canva一括作成用のCSV生成処理や、
Instagram投稿用データの加工処理は、
可能な限り `tools/canva-instagram/` 内で完結させる。