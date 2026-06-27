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
- **DB：** Upstash Redis（`@upstash/redis`）
- **スタイル：** Tailwind CSS + CSS変数によるテーマシステム
- **デプロイ：** Vercel

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
