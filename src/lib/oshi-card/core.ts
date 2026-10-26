// 推し布教カードの作品候補・選択内容の検証（純粋関数・DB非依存）。
// 作品は「その人物の公開作品」だけを候補にし、未登録の作品は作らない。順序は利用者が選んだ順のまま。
import type { WorkRecord } from '@/types/work';
import { DISPLAY_WORK_TYPE_LABEL, getDisplayWorkType, type DisplayWorkType } from '@/lib/work-display-type';
import { getWorkPublicUrl } from '@/lib/work-url';
import { OSHI_CARD_MAX_WORKS } from './params';

export interface OshiCardWork {
  /** works テーブルの id（共有URLの w） */
  id: string;
  title: string;
  displayType: DisplayWorkType;
  /** 表示用の分類名（映画・ドラマ・バラエティ…。既存の作品分類） */
  typeLabel: string;
  year: number | null;
  /** 推しサーチ内の作品ページ（/work/{id}。統合先があればそちら） */
  url: string | null;
}

/** 人物の公開作品から候補を作る（id の重複を除き、公開日の新しい順＝人物ページと同じ並び） */
export function buildOshiCardCandidates(works: WorkRecord[]): OshiCardWork[] {
  const seen = new Set<string>();
  const out: OshiCardWork[] = [];
  for (const w of [...works].sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0))) {
    if (!w.id || seen.has(w.id) || !w.title?.trim()) continue;
    seen.add(w.id);
    const displayType = getDisplayWorkType(w);
    out.push({
      id: w.id,
      title: w.title.trim(),
      displayType,
      typeLabel: DISPLAY_WORK_TYPE_LABEL[displayType],
      year: w.releaseYear ?? null,
      url: getWorkPublicUrl({ workId: w.id, canonicalWorkId: w.canonicalWorkId }),
    });
  }
  return out;
}

export interface ResolvedOshiCardWorks {
  /** 候補に存在する作品だけ（指定順・最大3件） */
  works: OshiCardWork[];
  /** 候補に無い（他の人物の作品・非公開・存在しない）id */
  invalidIds: string[];
}

export function resolveOshiCardWorks(workIds: string[], candidates: OshiCardWork[]): ResolvedOshiCardWorks {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const works: OshiCardWork[] = [];
  const invalidIds: string[] = [];
  for (const id of workIds) {
    const w = byId.get(id);
    if (!w) invalidIds.push(id);
    else if (works.length < OSHI_CARD_MAX_WORKS && !works.includes(w)) works.push(w);
  }
  return { works, invalidIds };
}

/** X・LINE・端末の共有で使う文（作品名は「」で囲む） */
export function buildOshiCardShareText(person: string, works: Pick<OshiCardWork, 'title'>[]): string {
  const titles = works.map((w) => `「${w.title}」`).join('');
  return `${person}の布教カードを作りました！おすすめは${titles}。あなたの推しでも作ってみて`;
}

/** 文字幅の目安（全角＝1、半角＝0.6） */
export function textUnits(text: string): number {
  let u = 0;
  for (const ch of text) u += ch.charCodeAt(0) < 0x2000 ? 0.6 : 1;
  return u;
}

/** maxUnits を超える文字列を「…」で切り詰める（画像の作品名。サロゲートペアを壊さない） */
export function truncateUnits(text: string, maxUnits: number): string {
  if (textUnits(text) <= maxUnits) return text;
  let u = 0;
  let out = '';
  for (const ch of text) {
    const w = ch.charCodeAt(0) < 0x2000 ? 0.6 : 1;
    if (u + w > maxUnits - 1) break;
    out += ch;
    u += w;
  }
  return `${out.trimEnd()}…`;
}
