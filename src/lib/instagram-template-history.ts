/**
 * 「人物 × テンプレート」のInstagram投稿履歴（純粋関数。クライアント・サーバー共通）。
 *
 * 投稿済みと判定するのは、Instagramへの投稿成功が記録されたものだけ：
 * - instagram_post_schedules の status='published' かつ media_id あり（予約からの投稿。template_id が分かる）
 * 予約しただけ（scheduled / processing）、failed、needs_review、cancelled、draft、画像生成のみは含めない。
 *
 * instagram_posts（実際に公開された投稿の履歴）にはテンプレートの列がない。予約と media_id で
 * 結び付かない投稿（管理画面 /admin/instagram-post からの手動投稿など）はテンプレートが分からないため、
 * どのテンプレートにも数えず「テンプレ不明の投稿」として人物ごとの最新日時だけを持つ（推測で割り当てない）。
 */

export interface PublishedScheduleRow {
  personName: string;
  templateId: string;
  status: string;
  mediaId: string | null;
  publishedAt: Date | string | null;
}

export interface InstagramPostRow {
  personName: string;
  mediaId: string;
  publishedAt: Date | string;
}

export interface TemplateHistory {
  /** personName → templateId → 最新の正常投稿日時（ISO） */
  byPerson: Record<string, Record<string, string>>;
  /** personName → テンプレートが分からない投稿の最新日時（ISO） */
  unknownTemplate: Record<string, string>;
}

const iso = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d).toISOString();
const later = (a: string | undefined, b: string) => (!a || b > a ? b : a);

export function buildTemplateHistory(schedules: readonly PublishedScheduleRow[], posts: readonly InstagramPostRow[]): TemplateHistory {
  const byPerson: Record<string, Record<string, string>> = {};
  const knownMediaIds = new Set<string>();
  for (const s of schedules) {
    if (s.status !== 'published' || !s.mediaId || !s.publishedAt) continue;
    knownMediaIds.add(s.mediaId);
    const m = (byPerson[s.personName] ??= {});
    m[s.templateId] = later(m[s.templateId], iso(s.publishedAt));
  }
  const unknownTemplate: Record<string, string> = {};
  for (const p of posts) {
    if (knownMediaIds.has(p.mediaId)) continue;
    unknownTemplate[p.personName] = later(unknownTemplate[p.personName], iso(p.publishedAt));
  }
  return { byPerson, unknownTemplate };
}

/** 人物 × テンプレートの最新の正常投稿日時（未投稿なら null） */
export function templatePostedAt(history: TemplateHistory | null | undefined, personName: string, templateId: string | null | undefined): string | null {
  if (!history || !templateId) return null;
  return history.byPerson[personName]?.[templateId] ?? null;
}

export interface PostedCombo {
  personName: string;
  templateId: string;
  postedAt: string;
}

/** 予定の中に含まれる「投稿済みの人物 × テンプレート」（同じ組み合わせは1件にまとめる） */
export function findPostedCombos(
  items: readonly { personName: string; templateId: string | null | undefined }[],
  history: TemplateHistory | null | undefined,
): PostedCombo[] {
  const out: PostedCombo[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const at = templatePostedAt(history, it.personName, it.templateId);
    const key = `${it.personName}\u0000${it.templateId}`;
    if (!at || seen.has(key)) continue;
    seen.add(key);
    out.push({ personName: it.personName, templateId: it.templateId!, postedAt: at });
  }
  return out;
}

export interface TemplateChip {
  templateId: string;
  /** 最新の正常投稿日時（未投稿なら null） */
  postedAt: string | null;
  /** 今回の予約で使うテンプレートか */
  selected: boolean;
}

/**
 * 人物一覧に出すテンプレートの状態（投稿済みのテンプレート＋今回選んでいるテンプレート）。
 * 並びはテンプレート定義の順（templateOrder）。定義にないテンプレートIDの投稿も末尾に出す。
 *
 * 3つの状態：✓ 投稿済みと確認できる（postedAt あり）／○ 未投稿と確認できる（postedAt なし）／？ テンプレ不明の投稿あり。
 * テンプレ不明の投稿がある人物は、どのテンプレートも「未投稿」と断定できないため ○ を返さない（✓ だけ返す）。
 */
export function personTemplateChips(
  history: TemplateHistory | null | undefined,
  personName: string,
  templateOrder: readonly string[],
  selectedTemplateIds: readonly string[],
): TemplateChip[] {
  const posted = history?.byPerson[personName] ?? {};
  const hasUnknown = !!history?.unknownTemplate[personName];
  const ids = [...templateOrder, ...Object.keys(posted).filter((id) => !templateOrder.includes(id))];
  return ids
    .filter((id) => posted[id] || (selectedTemplateIds.includes(id) && !hasUnknown))
    .map((id) => ({ templateId: id, postedAt: posted[id] ?? null, selected: selectedTemplateIds.includes(id) }));
}

/** テンプレ不明の投稿の最新日時（無ければ null）。補助表示だけに使い、投稿済み警告には使わない */
export function unknownTemplatePostedAt(history: TemplateHistory | null | undefined, personName: string): string | null {
  return history?.unknownTemplate[personName] ?? null;
}

/** テンプレート名の短縮表示（「標準（人物写真あり）」→「標準」、「H 観るもの・買うもの、まとめて」→「H」） */
export function shortTemplateLabel(label: string): string {
  const letter = label.match(/^([A-Z])\s/);
  if (letter) return letter[1];
  return label.replace(/（[^）]*）$/, '').trim();
}

/** ISO → 'YYYY/MM/DD'（JST） */
export function formatPostedDate(isoString: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isoString));
}
