// サブスク診断（/oshi-vod）とアフィリエイトの関係を保証するテスト。
// 1. 診断の計算（作品数・月額・コスパ・2サービス最適化・80%方法）は、アフィリエイト関連の
//    モジュールに一切到達しない（＝提携の有無が順位計算に入り込む経路が無い）。
// 2. ランキング・組み合わせの表示部品も、アフィリエイトを直接参照しない（CTA部品経由のみ）。
// 3. CTAのリンク先は「oshi_vod_result の広告 → 同サービスの work_provider の広告 → 公式サイト」の順。
//    広告表示時は PR 表記が付き、公式リンクには付かない。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';

const ROOT = resolve(__dirname, '../../..');
const IMPORT_RE = /^\s*import\s+(?!type\s)(?:[\s\S]*?from\s+)?['"]([^'"]+)['"];?/gm;
const EXPORT_FROM_RE = /^\s*export\s+(?!type\s)(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"];?/gm;

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // 外部パッケージ
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(c) && c.match(/\.tsx?$/)) return c;
  }
  return null;
}

function reachableFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [resolve(ROOT, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf-8');
    for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const next = resolveSpecifier(m[1], file);
        if (next) stack.push(next);
      }
    }
  }
  return seen;
}

const isAffiliateModule = (f: string) => /affiliate/i.test(f.replace(ROOT, ''));

describe('診断の順位計算はアフィリエイト提携の有無に依存しない', () => {
  it.each(['src/lib/oshi-vod/core.ts', 'src/lib/oshi-vod/data.ts', 'src/lib/oshi-vod/image-data.ts'])(
    '%s からアフィリエイト関連モジュールへ到達しない',
    (entry) => {
      const reached = [...reachableFiles(entry)].filter(isAffiliateModule).map((f) => f.replace(ROOT + '/', ''));
      expect(reached).toEqual([]);
    },
  );

  it.each([
    'src/components/oshi-vod/OshiVodRankings.tsx',
    'src/components/oshi-vod/OshiVodRankingTabs.tsx',
    'src/components/oshi-vod/OshiVodServiceLine.tsx',
    'src/components/oshi-vod/OshiVodPairs.tsx',
    'src/components/oshi-vod/OshiVodResultHero.tsx',
    'src/components/oshi-vod/OshiVodDetailCompare.tsx',
  ])('%s はアフィリエイトを直接参照しない（CTA部品 OshiVodServiceCta 経由のみ）', (file) => {
    const src = readFileSync(resolve(ROOT, file), 'utf-8');
    expect(src).not.toMatch(/from ['"][^'"]*affiliate[^'"]*['"]/i);
    expect(src).not.toMatch(/AffiliateSlot|resolveAffiliateSlot/);
  });
});

// ── CTA のリンク先の優先順位（DBは使わず resolveAffiliateSlot をモック） ──────────
type Creative = { id: number; programId: number; name: string; type: 'raw_html'; rawCode: string; destinationUrl: null; imageUrl: null; altText: null; width: null; height: null };
const creative = (id: number, label: string): Creative => ({
  id, programId: 1, name: label, type: 'raw_html', rawCode: `<a href="https://asp.example/${id}">${label}</a>`,
  destinationUrl: null, imageUrl: null, altText: null, width: null, height: null,
});
const ads: Record<string, Creative | null> = {};
vi.mock('@/lib/affiliate-store', () => ({
  resolveAffiliateSlot: async (vodService: string, slotKey: string) => {
    const c = ads[`${vodService}:${slotKey}`] ?? null;
    return { desktop: c, mobile: c };
  },
}));

const { default: OshiVodServiceCta } = await import('@/components/oshi-vod/OshiVodServiceCta');
const { default: AffiliateSlot } = await import('@/components/site/AffiliateSlot');
const { default: VodTrackLink } = await import('@/components/site/VodTrackLink');

type Found = { kind: 'affiliate'; creativeId: number; pr: boolean; slotKey: string } | { kind: 'official'; href: string } | null;

// AffiliateSlot（async Server Component）だけを実際に評価し、最終的に描画されるリンクを特定する
async function findLink(node: ReactNode, pr = false, slotKey = ''): Promise<Found> {
  if (Array.isArray(node)) {
    for (const n of node) { const f = await findLink(n, pr, slotKey); if (f) return f; }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === AffiliateSlot) {
    const props = el.props as { slotKey: string };
    return findLink(await (AffiliateSlot as (p: unknown) => Promise<ReactNode>)(el.props), pr, props.slotKey);
  }
  if (el.type === VodTrackLink) return { kind: 'official', href: el.props.href as string };
  if (typeof el.type === 'function' && el.type.name === 'AdWrapper') {
    const rendered = (el.type as (p: unknown) => ReactNode)(el.props);
    const text = JSON.stringify(rendered, (_k, v) => (typeof v === 'function' ? undefined : v));
    return findLink(el.props.children as ReactNode, text.includes('"PR"'), slotKey);
  }
  if (el.props.creative) return { kind: 'affiliate', creativeId: (el.props.creative as Creative).id, pr, slotKey };
  return findLink(el.props.children as ReactNode, pr, slotKey);
}

const cta = (service: string, placement: 'hero' | 'detail' = 'hero') =>
  OshiVodServiceCta({ service, displayName: service, placement, rank: 1, variant: placement === 'detail' ? 'compact' : 'brand' });

describe('OshiVodServiceCta のリンク先（oshi_vod_result → work_provider → 公式サイト）', () => {
  beforeEach(() => { for (const k of Object.keys(ads)) delete ads[k]; });

  it('診断専用（oshi_vod_result）の広告があれば最優先・PR表記あり', async () => {
    ads['hulu:oshi_vod_result'] = creative(10, '診断用');
    ads['hulu:work_provider'] = creative(1, '作品ページ用');
    expect(await findLink(cta('hulu'))).toEqual({ kind: 'affiliate', creativeId: 10, pr: true, slotKey: 'oshi_vod_result' });
  });

  it('診断専用が無ければ同サービスの work_provider の広告にフォールバック（現在の Hulu）・PR表記あり', async () => {
    ads['hulu:work_provider'] = creative(1, 'Huluで今すぐ見る');
    expect(await findLink(cta('hulu'))).toEqual({ kind: 'affiliate', creativeId: 1, pr: true, slotKey: 'work_provider' });
    expect(await findLink(cta('hulu', 'detail'))).toEqual({ kind: 'affiliate', creativeId: 1, pr: true, slotKey: 'work_provider' });
  });

  it('広告が無いサービスは公式サイト（PR表記なし）。他サービスの広告は使わない', async () => {
    ads['hulu:work_provider'] = creative(1, 'Huluで今すぐ見る');
    expect(await findLink(cta('unext'))).toEqual({ kind: 'official', href: 'https://video.unext.jp/' });
    expect(await findLink(cta('のぎ動画', 'detail'))).toEqual({ kind: 'official', href: 'https://nogidoga.com/' });
  });

  it('公式URLも広告も無いサービス（amazonvideo 等）はリンクを推測で作らない（空の枠は CSS :empty で非表示）', async () => {
    expect(await findLink(cta('amazonvideo', 'detail'))).toBeNull();
    // 広告があれば従来どおり広告を表示する（アフィリエイト判定は変えない）
    ads['amazonvideo:work_provider'] = creative(5, 'Amazon');
    expect(await findLink(cta('amazonvideo', 'detail'))).toEqual({ kind: 'affiliate', creativeId: 5, pr: true, slotKey: 'work_provider' });
  });

  it('CTAの外枠に計測用の service・placement・rank が付く（diagnosis_cta_click の送信元）', () => {
    const el = cta('hulu') as ReactElement<Record<string, unknown>>;
    expect(el.props['data-vod-service']).toBe('hulu');
    expect(el.props['data-ov-placement']).toBe('hero');
    expect(el.props['data-ov-rank']).toBe(1);
    expect(el.props['data-ov-cta']).toBe('');
  });
});

// ── 詳しい比較: レンタル・購入専用ストアの月額欄 ─────────────────────────────────
describe('詳しい比較の月額欄（Prime Video レンタル・購入）', () => {
  it('amazonvideo だけ「対象外（レンタル・購入）」。Prime Video 本体は料金表示のまま', async () => {
    const { computeOshiVodDiagnosis } = await import('@/lib/oshi-vod/core');
    const { default: OshiVodDetailCompare } = await import('@/components/oshi-vod/OshiVodDetailCompare');
    const vp = (providerName: string, type: 'flatrate' | 'rent' = 'flatrate') => ({ providerId: 0, providerName, type, countryCode: 'JP', source: 'manual_csv' as const });
    const work = (id: string, providers: ReturnType<typeof vp>[]) => ({
      id, personName: 'A', title: id, normalizedTitle: id, type: 'tv' as const, source: 'tmdb' as const,
      confidenceScore: 1, status: 'auto_published' as const, vodProviders: providers, createdAt: 0, updatedAt: 0,
    });
    const result = computeOshiVodDiagnosis(
      [{ name: 'A', works: [work('w1', [vp('Amazon Prime Video'), vp('Amazon Video', 'rent')]), work('w2', [vp('Hulu'), vp('Netflix')])] }],
      { terminatedSlugs: new Set() },
    );
    const tree = OshiVodDetailCompare({ result }) as ReactElement;
    // カード（li）ごとに「カード名 → 月額欄の文字列」を取り出す
    const json = JSON.stringify(tree, (_k, v) => (typeof v === 'function' ? undefined : v));
    const cards = new Map<string, string>();
    const walk = (n: unknown, card: string | null): void => {
      if (Array.isArray(n)) { n.forEach((x) => walk(x, card)); return; }
      if (!n || typeof n !== 'object') return;
      const props = (n as { props?: Record<string, unknown> }).props;
      if (!props) return;
      const key = (n as { key?: string }).key;
      const cur = typeof key === 'string' && ['amazonvideo', 'primevideo', 'hulu', 'netflix'].includes(key) ? key : card;
      if (cur && Array.isArray(props.children) && props.children[0] && (props.children[0] as { props?: { children?: unknown } }).props?.children === '月額') {
        const dd = props.children[1] as { props: { children: unknown } };
        cards.set(cur, String(dd.props.children));
      }
      walk(props.children, cur);
    };
    walk(tree, null);
    expect(json).toContain('Prime Video レンタル・購入');
    expect(cards.get('amazonvideo')).toBe('対象外（レンタル・購入）');
    expect(cards.get('primevideo')).toBe('月額600円（税込）');
    expect(cards.get('hulu')).toBe('月額1,320円（税込）');
    expect(cards.get('netflix')).toBe('比較対象外（税込料金未確認）');
  });
});
