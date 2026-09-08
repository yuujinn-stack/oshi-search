import type { Metadata } from 'next';
import Link from 'next/link';
import PersonCard from '@/components/PersonCard';
import { getPersonsByGenreExtended } from '@/lib/persons';
import { DEFAULT_GENRE_ORDER } from '@/lib/genre-utils';
import { getCanonicalGenreLabel } from '@/lib/person-display-tags';

export const revalidate = 60;
export const dynamicParams = true;

interface Props {
  params: Promise<{ genre: string }>;
}

export async function generateStaticParams() {
  return DEFAULT_GENRE_ORDER.map((genre) => ({ genre }));
}

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { genre } = await params;
  const decodedGenre = decodeURIComponent(genre);
  const g = getCanonicalGenreLabel(decodedGenre);
  const canonicalUrl = `${SITE_ORIGIN}/genre/${encodeURIComponent(decodedGenre)}`;

  // getPersonsByGenreExtractedはcache()済みのため、ページ本体側の同一呼び出しと
  // 実処理は共有され二重発行にはならない。
  const persons = await getPersonsByGenreExtended(decodedGenre);

  // 人物0件（準備中）の場合はこれまで通りのシンプルな文言のまま、canonicalのみ追加する
  if (persons.length === 0) {
    return {
      title: `${g}の一覧`,
      description: `${g}カテゴリの人物一覧です。`,
      alternates: { canonical: canonicalUrl },
    };
  }

  const title = `${g}一覧｜出演作品・配信情報から探す`;
  const description = `${g}の人物を${persons.length}人掲載。出演作品・配信中の作品・写真集やグッズなどの関連商品をまとめて検索できます。`;
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: { title, description, type: 'website' },
  };
}

export default async function GenrePage({ params }: Props) {
  const { genre } = await params;
  const decodedGenre = decodeURIComponent(genre);
  // alias / 表記ゆれ → canonical 表示名（検索はalias含めて実施）
  const displayGenre = getCanonicalGenreLabel(decodedGenre);
  const persons = await getPersonsByGenreExtended(decodedGenre);
  const genreUrl = `${SITE_ORIGIN}/genre/${encodeURIComponent(decodedGenre)}`;

  // 実在するURLのみの2階層（ホーム › ジャンル名）。存在しない中間URLは作らない。
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: displayGenre, item: genreUrl },
    ],
  };

  // Group by group name
  const grouped = persons.reduce<Record<string, typeof persons>>((acc, p) => {
    const key = p.group || 'ソロ・個人';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  // データなし → 準備中ページ
  if (persons.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
        <nav aria-label="パンくずリスト" className="text-xs mb-6 flex items-center gap-1.5 text-gray-500">
          <Link href="/" className="hover:underline">ホーム</Link>
          <span aria-hidden="true">›</span>
          <span>{displayGenre}</span>
        </nav>
        <div className="mb-8">
          <p className="text-sm text-gray-500 mb-1">ジャンル</p>
          <h1 className="text-2xl font-black text-slate-800">{displayGenre}</h1>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
          <p className="text-4xl mb-4">🚧</p>
          <p className="font-bold text-gray-700 text-lg mb-2">このジャンルは準備中です</p>
          <p className="text-sm text-gray-500">近日中に{displayGenre}ジャンルの人物を追加予定です。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <nav aria-label="パンくずリスト" className="text-xs mb-6 flex items-center gap-1.5 text-gray-500">
        <Link href="/" className="hover:underline">ホーム</Link>
        <span aria-hidden="true">›</span>
        <span>{displayGenre}</span>
      </nav>
      <div className="mb-8">
        <p className="text-sm text-gray-500 mb-1">ジャンル</p>
        <h1 className="text-2xl font-black text-slate-800">
          {displayGenre}
          <span className="text-gray-400 font-normal text-lg ml-2">{persons.length}人</span>
        </h1>
      </div>

      <div className="space-y-10">
        {Object.entries(grouped).map(([group, groupPersons]) => (
          <section key={group}>
            <h2 className="text-sm font-bold text-primary border-l-4 border-primary pl-3 mb-4">
              {group}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {groupPersons.map((person) => (
                <PersonCard key={person.name} person={person} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
