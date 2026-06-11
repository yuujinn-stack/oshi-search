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

// 表示セクション定義
// usedKeywords: 中古カテゴリの商品をこのセクションに分類するタイトルキーワード
const DISPLAY_SECTIONS: Array<{
  label: string;
  sources: ProductCategory[];
  usedKeywords: string[];
}> = [
  { label: '本・写真集', sources: ['写真集', '本・雑誌'], usedKeywords: ['写真集', 'フォトブック', 'ムック'] },
  { label: 'CD', sources: ['CD'], usedKeywords: ['CD', 'シングル', 'アルバム', 'ALBUM', 'SINGLE', 'ベストアルバム'] },
  { label: 'Blu-ray・DVD', sources: ['Blu-ray・DVD'], usedKeywords: ['DVD', 'Blu-ray', 'ブルーレイ', 'ライブ', 'コンサート', 'ツアー'] },
  { label: 'グッズ', sources: ['グッズ'], usedKeywords: ['グッズ', 'カレンダー', 'ポスター', 'ぬいぐるみ', 'トレカ'] },
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

  // 中古カテゴリの関連済み商品を取得（全セクションで共有）
  const usedCatData = storedData['中古'];
  const usedProducts: RakutenItem[] = [];
  const usedSeen = new Set<string>();
  if (usedCatData && Array.isArray(usedCatData.products)) {
    for (const p of usedCatData.products) {
      const v = verdicts[p.id];
      if (!v || v.verdict !== 'related') continue;
      if (v.source !== 'manual' && v.score < 70) continue;
      usedSeen.add(p.id);
      usedProducts.push(p);
    }
  }

  // 表示セクションごとに「relevant」判定済み商品を統合して抽出
  const sectionResults = DISPLAY_SECTIONS.map(({ label, sources, usedKeywords }) => {
    // 新品商品: 各ソースカテゴリから判定済み商品を取得
    const hasAnyData = sources.some((cat) => !!storedData[cat]);
    const newProducts: RakutenItem[] = [];
    const newSeen = new Set<string>();
    for (const cat of sources) {
      const catData = storedData[cat];
      if (!catData || !Array.isArray(catData.products)) continue;
      for (const p of catData.products) {
        if (newSeen.has(p.id)) continue;
        const v = verdicts[p.id];
        if (!v || v.verdict !== 'related') continue;
        if (v.source !== 'manual' && v.score < 70) continue;
        newSeen.add(p.id);
        newProducts.push(p);
      }
    }

    // 中古商品: 中古カテゴリからこのセクションに該当するものを抽出
    const sectionUsed = usedProducts.filter((p) => {
      if (newSeen.has(p.id)) return false; // 新品と重複するものは除外
      const title = p.title.replace(/^【中古】\s*/, '');
      return usedKeywords.some((kw) => title.includes(kw));
    });

    const newResult: ApiResult = !hasAnyData
      ? { status: 'no_data' as const }
      : newProducts.length > 0
      ? { status: 'ok' as const, products: newProducts }
      : { status: 'empty' as const };

    return { label, newResult, usedProducts: sectionUsed };
  });

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
        {sectionResults.map(({ label, newResult, usedProducts: sectionUsed }) => (
          <section key={label}>
            <h2 className="text-base font-bold text-slate-800 mb-4">{label}</h2>

            {/* 新品 */}
            {(newResult.status === 'ok' || sectionUsed.length === 0) && (
              <ProductSectionList result={newResult} />
            )}
            {newResult.status === 'ok' && sectionUsed.length > 0 && (
              <p className="text-xs text-gray-400 mt-1 mb-4">
                新品 {newResult.products.length}件
              </p>
            )}

            {/* 中古 */}
            {sectionUsed.length > 0 && (
              <div className={newResult.status === 'ok' ? 'mt-6' : ''}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    中古
                  </span>
                  <span className="text-xs text-gray-400">{sectionUsed.length}件</span>
                </div>
                <ProductSectionList result={{ status: 'ok', products: sectionUsed }} />
              </div>
            )}
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
