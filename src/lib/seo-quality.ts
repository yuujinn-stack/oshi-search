// SEO品質判定のための純粋関数群（Priority D-3/D-6）。
//
// 方針: ここでの判定結果は「robots: { index: false, follow: true }」を付与するかどうか
// にのみ使う。ページの公開可否（表示するかどうか）そのものは変更しない
// （既存の status='auto_published' / publishedAt 等の公開条件をそのまま使う）。
// また、単一条件（例: 作品0件のみ）でnoindexにしないこと。DBアクセスは行わない。

// ─── 人物ページのnoindex判定 ──────────────────────────────────────────────────
// 意図的に未実装。人物ページには公開作品0件でもプロフィール・グループ情報・関連商品
// 等が存在しうるため、「作品0件」だけを理由にnoindexにはしない方針とした
// （hidden・非公開・未完成ステータス等、安全に判定できる既存データが無い限り
// 人物ページへの自動noindex判定は追加しない）。

// ─── 作品ページのnoindex判定 ──────────────────────────────────────────────────
// 作品ページは既に status='auto_published' && !deleted の作品のみ表示される
// （非公開・hidden・needs_reviewの作品は既存ロジックでnotFound()になるため対象外）。
// ここでは「表示はされるがタイトルが未取得・placeholder状態」という、既存データ上
// 明確に未完成と分かるケースのみを対象とする。
export function shouldNoindexWork(input: { title: string | null | undefined; workId: string }): boolean {
  const title = (input.title ?? '').trim();
  if (title === '') return true;
  // タイトルが内部ID（workId）そのもの、またはTMDb由来IDパターンのみの場合は未完成とみなす
  if (title === input.workId) return true;
  if (/^tmdb-(movie|tv)-\d+$/.test(title)) return true;
  return false;
}

// ─── 文字化け候補の検出（Priority Aの文字化け対策とは別に、管理画面での目視確認補助） ──
// 正しいタイトルを推測して自動修正することはしない。あくまで「確認候補」を検出するだけ。
// C1制御文字域（コードポイント128〜159）は正常な日本語・英語のタイトルには通常出現しない。
function hasC1ControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 128 && code <= 159) return true;
  }
  return false;
}

export function looksLikeMojibake(text: string | null | undefined): boolean {
  if (!text) return false;
  // Unicode置換文字（デコード失敗時に挿入される）
  if (text.includes('�')) return true;
  if (hasC1ControlChar(text)) return true;
  return false;
}

// ─── タイトルのSEO安全なfallback（Section 32: undefined｜推しサーチ 等を防ぐ） ────
export function safeTitleFallback(title: string | null | undefined, fallback: string): string {
  const t = (title ?? '').trim();
  return t === '' ? fallback : t;
}
