// 他の管理画面から「ストーリーズ作成（/admin/story-maker）」をテンプレート・対象を選んだ状態で開くためのリンク（DB非依存）。
//
// - /admin/instagram-post の「楽天BF・推し別セール紹介」カードから使う（Instagram への自動投稿はしない。画像は story-maker で保存して手動投稿）。
// - 受け取る側は、知っているテンプレート・実在する人物/グループだけを採用し、それ以外は無視して通常の初期状態で開く。
// - パラメータが無いときの初期状態（テンプレート A・グループ・未選択）は従来どおり。

import { STORY_TEMPLATES, type StoryTemplateId } from './templates';

export const STORY_MAKER_PATH = '/admin/story-maker';

/** 開いた元の画面（戻るリンクの表示に使う。知っているものだけ） */
export const STORY_MAKER_FROM = { 'instagram-post': { label: 'Instagram投稿', href: '/admin/instagram-post' } } as const;
export type StoryMakerFrom = keyof typeof STORY_MAKER_FROM;

export interface StoryMakerLinkInput {
  template: StoryTemplateId;
  person?: string;
  group?: string;
  from?: StoryMakerFrom;
}

export function buildStoryMakerLink(input: StoryMakerLinkInput): string {
  const q = new URLSearchParams({ template: input.template });
  // 人物とグループは片方だけ（両方あれば人物を優先）
  if (input.person?.trim()) q.set('person', input.person.trim());
  else if (input.group?.trim()) q.set('group', input.group.trim());
  if (input.from) q.set('from', input.from);
  return `${STORY_MAKER_PATH}?${q.toString()}`;
}

export interface StoryMakerInitial {
  templateId: StoryTemplateId | null;
  targetType: 'person' | 'group' | null;
  name: string;
  from: StoryMakerFrom | null;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? '';

/** URL のパラメータを、実在するテンプレート・人物・グループだけに絞って初期状態にする */
export function parseStoryMakerInitial(raw: Raw, personNames: string[], groupNames: string[]): StoryMakerInitial {
  const t = first(raw.template);
  const templateId = STORY_TEMPLATES.some((x) => x.id === t) ? (t as StoryTemplateId) : null;
  const person = first(raw.person);
  const group = first(raw.group);
  let targetType: StoryMakerInitial['targetType'] = null;
  let name = '';
  if (person && personNames.includes(person)) { targetType = 'person'; name = person; }
  else if (group && groupNames.includes(group)) { targetType = 'group'; name = group; }
  const f = first(raw.from);
  const from = Object.hasOwn(STORY_MAKER_FROM, f) ? (f as StoryMakerFrom) : null;
  return { templateId, targetType, name, from };
}
