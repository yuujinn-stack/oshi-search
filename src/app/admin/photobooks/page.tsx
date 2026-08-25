import { getAdminPhotobookRows } from '@/lib/photobook-store';
import { getAllPersonsMerged } from '@/lib/persons';
import PhotobookAdminClient from './PhotobookAdminClient';
import GenderManagerPanel from './GenderManagerPanel';

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
        既存の商品DBからルールベースで写真集を自動判定しています。OpenAI等のAIは使用していません。
        グループ写真集（同一商品が複数メンバーに紐づくもの）は自動的に1件へ統合して表示しています。
        手動追加・除外・公開設定・ホーム掲載設定を行えます。
      </p>
      <div className="mb-6">
        <GenderManagerPanel />
      </div>
      <PhotobookAdminClient initialRows={rows} persons={personOptions} />
    </div>
  );
}
