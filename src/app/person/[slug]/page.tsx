import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfig, getPersonsByGroup } from '@/lib/persons';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import ProductSectionList from '@/components/ProductSectionList';
import PersonCard from '@/components/PersonCard';
import type { ProductCategory, ApiResult, RakutenItem } from '@/types/rakuten';

interface Props {
  params: Promise<{ slug: string }>;
}

// バッチ実行後すぐに判定結果を反映するため毎リクエスト SSR
// ISR だとバッチ更新が最大 1 時間反映されない
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const person = getPersonWithConfig(name);
  if (!person) return {};

  const groupText = person.group ? `（${person.group}）` : '';
  const groupSuffix = person.group ? `${person.group}の最新情報やメンバー関連商品` : '関連商品';
  return {
    title: `${person.name}の写真集・グッズ・Blu-ray まとめ`,
    description: `${person.name}${groupText}の写真集・雑誌・Blu-ray・グッズを楽天でまとめて探せます。${groupSuffix}もチェック。`,
  };
}

const GENRE_BADGE: Record<string, string> = {
  '坂道': 'bg-pink-100 text-pink-700',
  '芸人': 'bg-yellow-100 text-yellow-700',
  'テレビ': 'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優': 'bg-green-100 text-green-700',
};

// 表示セクション定義（「写真集」と「本・雑誌」を統合して表示）
const DISPLAY_SECTIONS: Array<{ label: string; sources: ProductCategory[] }> = [
  { label: '本・写真集', sources: ['写真集', '本・雑誌'] },
  { label: 'Blu-ray・DVD', sources: ['Blu-ray・DVD'] },
  { label: 'グッズ', sources: ['グッズ'] },
];

export default async function PersonPage({ params }: Props) {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const person = getPersonWithConfig(name);
  if (!person) notFound();

  const related = person.group
    ? getPersonsByGroup(person.group)
        .filter((p) => p.name !== person.name)
        .slice(0, 4)
    : [];

  // Redis から保存済み商品と判定結果を並列取得
  // ユーザーページでは楽天 API / OpenAI API を一切呼ばない
  const [storedData, verdicts] = await Promise.all([
    getAllStoredProducts(person.name),
    getAllVerdicts(person.name),
  ]);

  // 表示セクションごとに「relevant」判定済み商品を統合して抽出
  const results: Record<string, ApiResult> = Object.fromEntries(
    DISPLAY_SECTIONS.map(({ label, sources }) => {
      // いずれのソースカテゴリもデータなし → バッチ未実行
      const hasAnyData = sources.some((cat) => !!storedData[cat]);
      if (!hasAnyData) return [label, { status: 'no_data' as const }];

      // 表示条件:
      //   手動採用 → 常に表示
      //   AI判定  → related かつ score >= 70 のみ表示（高確信度のみ）
      const relevant: RakutenItem[] = sources.flatMap((cat) => {
        const catData = storedData[cat];
        if (!catData) return [];
        if (!Array.isArray(catData.products)) {
          console.error('[PersonPage] unexpected catData.products format', { name: person.name, cat, type: typeof catData.products });
          return [];
        }
        return catData.products.filter((p) => {
          const v = verdicts[p.id];
          if (!v || v.verdict !== 'related') return false;
          if (v.source === 'manual') return true;   // 手動採用は常に表示
          return v.score >= 70;                      // AI判定は高確信度のみ
        });
      });

      return [
        label,
        relevant.length > 0
          ? { status: 'ok' as const, products: relevant }
          : { status: 'empty' as const },
      ];
    })
  );

  return (
    <div>
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary to-indigo-800 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <nav className="text-indigo-300 text-sm mb-6 flex items-center gap-1 flex-wrap">
            <Link href="/" className="hover:text-white transition-colors">ホーム</Link>
            <span>/</span>
            <Link href={`/genre/${encodeURIComponent(person.genre)}`} className="hover:text-white transition-colors">
              {person.genre}
            </Link>
            <span>/</span>
            <span className="text-white font-medium">{person.name}</span>
          </nav>

          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-white text-4xl font-black flex-shrink-0 select-none">
              {person.name[0]}
            </div>
            <div>
              <h1 className="text-3xl font-black text-white">{person.name}</h1>
              {person.group ? (
                <Link
                  href={`/search?q=${encodeURIComponent(person.group)}`}
                  className="text-indigo-200 hover:text-white mt-1 block text-sm transition-colors"
                >
                  {person.group}
                </Link>
              ) : (
                <p className="text-indigo-300 mt-1 text-sm">ソロ活動</p>
              )}
              <span className={`inline-block mt-2 text-xs px-3 py-1 rounded-full font-bold ${GENRE_BADGE[person.genre] ?? 'bg-gray-100 text-gray-600'}`}>
                {person.genre}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 商品セクション */}
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-10">
        {DISPLAY_SECTIONS.map(({ label }) => (
          <section key={label}>
            <h2 className="text-base font-bold text-slate-800 mb-4">{label}</h2>
            <ProductSectionList result={results[label]} />
          </section>
        ))}

        {/* VOD */}
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-4">VOD視聴先</h2>
          <div className="bg-amber-50 border-2 border-amber-200 border-dashed rounded-2xl p-8 text-center">
            <p className="text-2xl mb-2">📺</p>
            <p className="font-bold text-amber-800 mb-1">視聴先情報を準備中</p>
            <p className="text-sm text-amber-600">Hulu・U-NEXT・Amazon Prime等のリンクを順次追加予定です</p>
          </div>
        </section>

        {/* 関連メンバー */}
        {related.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-800">{person.group} のメンバー</h2>
              <Link
                href={`/search?q=${encodeURIComponent(person.group)}`}
                className="text-primary text-sm font-medium hover:underline"
              >
                全員を見る →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {related.map((p) => (
                <PersonCard key={p.name} person={p} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
