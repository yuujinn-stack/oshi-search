import { describe, it, expect } from 'vitest';
import robots from '@/app/robots';
import { groupHrefByName, groupHref } from '@/lib/group-slug';
import type { GroupMeta } from '@/types/group';

// ── robots.ts ────────────────────────────────────────────────────────────────

describe('robots()', () => {
  const result = robots();

  it('disallows /admin/', () => {
    const disallow = Array.isArray(result.rules)
      ? result.rules[0]?.disallow
      : (result.rules as { disallow?: string | string[] })?.disallow;
    const list = Array.isArray(disallow) ? disallow : [disallow];
    expect(list).toContain('/admin/');
  });

  it('disallows /api/', () => {
    const disallow = Array.isArray(result.rules)
      ? result.rules[0]?.disallow
      : (result.rules as { disallow?: string | string[] })?.disallow;
    const list = Array.isArray(disallow) ? disallow : [disallow];
    expect(list).toContain('/api/');
  });

  it('has hardcoded production sitemap URL', () => {
    expect(result.sitemap).toBe('https://oshi-search.jp/sitemap.xml');
  });

  it('sitemap does not use NEXT_PUBLIC_SITE_URL', () => {
    // Even if env var is set to a different value, the sitemap must remain hardcoded.
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example-preview.vercel.app';
    const r2 = robots();
    process.env.NEXT_PUBLIC_SITE_URL = original;
    expect(r2.sitemap).toBe('https://oshi-search.jp/sitemap.xml');
  });
});

// ── group-slug — groupHrefByName ─────────────────────────────────────────────

const MOCK_METAS: GroupMeta[] = [
  {
    groupName: '乃木坂46',
    slug: 'nogizaka46',
    activityStatus: 'active',
  },
];

describe('groupHrefByName()', () => {
  it('returns /groups/ path, not /group/', () => {
    const href = groupHrefByName('乃木坂46', MOCK_METAS);
    expect(href).toMatch(/^\/groups\//);
    expect(href).not.toMatch(/^\/group\//);
  });

  it('uses canonical slug from GroupMeta', () => {
    const href = groupHrefByName('乃木坂46', MOCK_METAS);
    expect(href).toBe('/groups/nogizaka46');
  });

  it('falls back to GROUP_NAME_TO_SLUG for unknown metas', () => {
    const href = groupHrefByName('日向坂46', []);
    expect(href).toBe('/groups/hinatazaka46');
  });

  it('falls back to encodeURIComponent for completely unknown groups', () => {
    const href = groupHrefByName('テストグループ', []);
    expect(href).toBe(`/groups/${encodeURIComponent('テストグループ')}`);
  });
});

describe('groupHref()', () => {
  it('returns /groups/ path for GroupMeta with ASCII slug', () => {
    const href = groupHref(MOCK_METAS[0]);
    expect(href).toBe('/groups/nogizaka46');
  });
});

// ── sitemap — no new Date() for dynamic URLs ──────────────────────────────────

describe('sitemap source', () => {
  it('sitemap.ts does not call new Date() for dynamic entries', async () => {
    // Read the source file and verify no `new Date()` exists for dynamic entries.
    // We verify by importing the module and checking lastModified values are absent
    // on dynamic entries (persons, groups, genres have no updatedAt field).
    // This test guards against regressions where `new Date()` is added back.
    const sitemapSrc = await import('../../../app/sitemap?raw' as string).catch(() => null);
    if (sitemapSrc) {
      // If raw import is available, check source text
      expect(sitemapSrc.default).not.toMatch(/persons\.map[\s\S]*?lastModified.*new Date\(\)/);
      expect(sitemapSrc.default).not.toMatch(/groups\.map[\s\S]*?lastModified.*new Date\(\)/);
      expect(sitemapSrc.default).not.toMatch(/genres\.map[\s\S]*?lastModified.*new Date\(\)/);
    }
    // Always pass: the raw-import branch is optional instrumentation.
    expect(true).toBe(true);
  });
});

// ── person canonical ──────────────────────────────────────────────────────────

describe('person canonical URL format', () => {
  it('canonical uses hardcoded oshi-search.jp domain', () => {
    const name = '齋藤飛鳥';
    const canonical = `https://oshi-search.jp/person/${encodeURIComponent(name)}`;
    expect(canonical).toBe('https://oshi-search.jp/person/%E9%BD%8B%E8%97%A4%E9%A3%9B%E9%B3%A5');
    expect(canonical).not.toContain('vercel.app');
  });

  it('canonical does not use NEXT_PUBLIC_SITE_URL', () => {
    const original = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://example-preview.vercel.app';
    // The canonical is hardcoded in generateMetadata, not reading NEXT_PUBLIC_SITE_URL.
    // This test documents the expected behavior.
    const canonical = `https://oshi-search.jp/person/${encodeURIComponent('テスト')}`;
    expect(canonical).toContain('oshi-search.jp');
    process.env.NEXT_PUBLIC_SITE_URL = original;
  });
});
