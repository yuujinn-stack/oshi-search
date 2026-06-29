export const dynamic = 'force-dynamic';

import { getAllImportedPersons } from '@/lib/imported-persons';
import { getAllWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import PeopleProgressClient from './PeopleProgressClient';

export type PersonProgress = {
  name: string;
  group: string;
  genre: string;
  aliases: string[];
  importedAt: number;
  dataFetchStatus: string;
  lastDataFetchedAt?: number;
  errorMessage?: string;
  totalWorks: number;
  publishedWorks: number;
  reviewWorks: number;
  hiddenWorks: number;
  vodWorks: number;
  csvWorks: number;
  aiWorks: number;
  totalProducts: number;
  lastUpdatedAt?: number;
};

export default async function PeopleProgressPage() {
  const persons = await getAllImportedPersons();

  const progressList = await Promise.all(
    persons.map(async (person): Promise<PersonProgress> => {
      const [works, products] = await Promise.all([
        getAllWorks(person.name),
        getAllStoredProducts(person.name),
      ]);

      const totalWorks = works.length;
      const publishedWorks = works.filter((w) => w.status === 'auto_published').length;
      const reviewWorks = works.filter((w) => w.status === 'needs_review').length;
      const hiddenWorks = works.filter((w) => w.status === 'hidden').length;
      const vodWorks = works.filter(
        (w) => (w.vodProviders ?? []).filter((p) => p.providerName !== 'unknown').length > 0,
      ).length;
      const csvWorks = works.filter((w) => w.source === 'manual_csv').length;
      const aiWorks = works.filter(
        (w) => w.source === 'openai_suggestion' || w.source === 'ai_supplement',
      ).length;
      const totalProducts = Object.values(products).reduce(
        (sum, cat) => sum + (cat?.products.length ?? 0),
        0,
      );
      const lastUpdatedAt =
        works.reduce((max, w) => Math.max(max, w.updatedAt ?? 0), 0) || undefined;

      return {
        name: person.name,
        group: person.group,
        genre: person.genre,
        aliases: person.aliases,
        importedAt: person.importedAt,
        dataFetchStatus: person.dataFetchStatus,
        lastDataFetchedAt: person.lastDataFetchedAt,
        errorMessage: person.dataFetchErrorMessage,
        totalWorks,
        publishedWorks,
        reviewWorks,
        hiddenWorks,
        vodWorks,
        csvWorks,
        aiWorks,
        totalProducts,
        lastUpdatedAt: lastUpdatedAt || undefined,
      };
    }),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-800">人物別進捗</h1>
          <p className="text-sm text-gray-500 mt-1">
            {progressList.length}人 の取得状況・作品数・商品数を一覧表示します（既存データのみ）
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 flex-wrap text-xs">
          <a href="/admin/work-check" className="text-indigo-600 hover:underline">
            作品管理 →
          </a>
          <a href="/admin/people/import" className="text-indigo-600 hover:underline">
            人物登録 →
          </a>
          <a href="/admin/rakuten-search" className="text-indigo-600 hover:underline font-medium">
            楽天商品検索 →
          </a>
          <a href="/admin/product-check" className="text-gray-400 hover:underline">
            商品確認
          </a>
          <a href="/admin/groups" className="text-gray-400 hover:underline">
            グループ管理
          </a>
          <a href="/api/admin/logout" className="text-gray-400 hover:text-red-500">
            ログアウト
          </a>
        </div>
      </div>
      <PeopleProgressClient data={progressList} />
    </div>
  );
}
