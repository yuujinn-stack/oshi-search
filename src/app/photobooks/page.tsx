import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPhotobookListItems,
  getPhotobookFacets,
} from '@/lib/photobook-store';
import type { PhotobookGenreBucket } from '@/lib/photobook';
import PhotobookCard from '@/components/site/PhotobookCard';
import PhotobookFilterBar from './PhotobookFilterBar';

export const revalidate = 60;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

export const metadata: Metadata = {
  title: '写真集を探す',
  description: '推し・出演者から探せる写真集・フォトブック一覧です。女性/男性、グループ、ジャンルで絞り込みできます。',
  alternates: {
    // 検索条件ごとの無限インデックスを避けるため、常にベースURLを canonical にする。
    canonical: `${SITE_ORIGIN}/photobooks`,
  },
  openGraph: {
    title: '写真集を探す | 推しサーチ',
    description: '推し・出演者から探せる写真集・フォトブック一覧です。',
    type: 'website',
    url: `${SITE_ORIGIN}/photobooks`,
  },
};

interface Props {
  searchParams: Promise<{
    gender?: string;
    person?: string;
    group?: string;
    genre?: string;
    page?: string;
  }>;
}

function parsePage(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

const VALID_GENRES: PhotobookGenreBucket[] = ['女優', 'アイドル', '俳優', 'その他'];

export default async function PhotobooksPage({ searchParams }: Props) {
  const sp = await searchParams;
  const gender: 'female' | 'male' = sp.gender === 'male' ? 'male' : 'female';
  const personName = sp.person ?? '';
  const groupName = sp.group ?? '';
  const genreRaw = sp.genre ?? '';
  const genreBucket = VALID_GENRES.includes(genreRaw as PhotobookGenreBucket)
    ? (genreRaw as PhotobookGenreBucket)
    : undefined;

  const page = parsePage(sp.page);
  if (page === null) notFound();

  const [result, facets] = await Promise.all([
    getPhotobookListItems({ gender, personName: personName || undefined, groupName: groupName || undefined, genreBucket }, page),
    getPhotobookFacets(),
  ]);

  if (result.totalCount > 0 && page > result.totalPages) notFound();

  const personOptions = facets.persons.map((p) => ({ name: p.name, group: p.group }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* パンくず */}
      <nav className="text-xs mb-6 flex items-center gap-1.5" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>写真集を探す</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--ds-text)' }}>写真集を探す</h1>
        <p className="text-sm" style={{ color: 'var(--ds-muted)' }}>推しの写真集・フォトブックをチェックできます。</p>
      </div>

      <PhotobookFilterBar
        persons={personOptions}
        groups={facets.groups}
        gender={gender}
        personName={personName}
        groupName={groupName}
        genreBucket={genreBucket ?? ''}
      />

      {result.totalCount > 0 ? (
        <>
          <p className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
            {result.totalCount}件中 {(page - 1) * result.pageSize + 1}〜{Math.min(page * result.pageSize, result.totalCount)}件
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {result.items.map((item) => (
              <PhotobookCard key={`${item.personName}-${item.productId}`} data={item} />
            ))}
          </div>

          {result.totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2 mt-8" aria-label="ページネーション">
              {page > 1 && (
                <Link
                  href={buildPageHref({ gender, personName, groupName, genreBucket }, page - 1)}
                  className="text-xs font-semibold px-4 py-2 rounded-lg"
                  style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
                >
                  ← 前へ
                </Link>
              )}
              <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{page} / {result.totalPages}</span>
              {page < result.totalPages && (
                <Link
                  href={buildPageHref({ gender, personName, groupName, genreBucket }, page + 1)}
                  className="text-xs font-semibold px-4 py-2 rounded-lg"
                  style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
                >
                  次へ →
                </Link>
              )}
            </nav>
          )}
        </>
      ) : (
        <p className="text-sm text-center py-16 rounded-xl" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-muted)' }}>
          条件に一致する写真集が見つかりませんでした。
        </p>
      )}
    </div>
  );
}

function buildPageHref(
  filters: { gender: string; personName: string; groupName: string; genreBucket?: string },
  page: number,
): string {
  const params = new URLSearchParams();
  if (filters.gender) params.set('gender', filters.gender);
  if (filters.personName) params.set('person', filters.personName);
  if (filters.groupName) params.set('group', filters.groupName);
  if (filters.genreBucket) params.set('genre', filters.genreBucket);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/photobooks?${qs}` : '/photobooks';
}
