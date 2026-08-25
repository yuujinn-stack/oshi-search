import { getAdminPhotobookRows } from '@/lib/photobook-store';
import { getAllPersonsMerged } from '@/lib/persons';
import PhotobookAdminClient from './PhotobookAdminClient';

export const dynamic = 'force-dynamic';

export default async function AdminPhotobooksPage() {
  const [rows, persons] = await Promise.all([
    getAdminPhotobookRows(),
    getAllPersonsMerged(),
  ]);

  const personOptions = persons.map((p) => ({ name: p.name, group: p.group }));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-lg font-bold text-slate-800 mb-1">写真集管理</h1>
      <p className="text-xs text-gray-500 mb-4">
        既存の商品DB（category=&quot;写真集&quot;）から自動判定した写真集の確認・手動追加・除外・公開設定・ホーム掲載設定を行います。
        OpenAI等のAIは使用していません（ルールベース判定のみ）。
      </p>
      <PhotobookAdminClient initialRows={rows} persons={personOptions} />
    </div>
  );
}
