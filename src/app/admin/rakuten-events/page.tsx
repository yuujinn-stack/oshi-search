import { LogoutButton } from '@/components/admin/LogoutButton';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, listGroupNames, personsInGroup } from '@/lib/group-membership';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import { isMissingEventTable, listEvents, neonEventDb, type EventWithCounts } from '@/lib/rakuten-event/store';
import RakutenEventsClient from './RakutenEventsClient';

// 楽天イベント管理。表示（GET）は読み取りのみ。登録・編集・紐付け・確認状態の変更は /api/admin/rakuten-events（POST）で行う。
// 一般公開ページには何も表示しない（SNS投稿文の作成と、投稿前の確認のための管理機能）。
export const dynamic = 'force-dynamic';

export default async function RakutenEventsPage() {
  let events: EventWithCounts[] = [];
  let loadError: string | null = null;
  try {
    events = await listEvents(neonEventDb());
  } catch (e) {
    loadError = isMissingEventTable(e)
      ? '楽天イベントのテーブルが未作成です。scripts/rakuten-events/setup-tables.ts（check → apply）で作成してください。'
      : 'イベントを読み取れませんでした。';
  }
  const [persons, records, groupMetas] = await Promise.all([
    getAllPersonsMerged().catch(() => []),
    getAllMembershipRecords(),
    getAllGroupMetas().catch(() => []),
  ]);
  const byPerson = groupMembershipRecords(records);
  const personOptions: PersonOption[] = persons.map((p) => ({ name: p.name, group: p.group || undefined }));
  const groups = listGroupNames(persons, byPerson).sort((a, b) => a.localeCompare(b, 'ja'));
  // グループ単位の投稿文（リンク先＝公開中のグループページ）と、候補一覧のグループ名の表示に使う
  const groupInfo = Object.fromEntries(groups.map((g) => [g, {
    path: groupHrefByName(g, groupMetas),
    members: personsInGroup(g, persons, byPerson).map((p) => p.name),
  }]));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-800">楽天イベント管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            イベント候補から登録 → 公式条件を確認 → 推しサーチの楽天商品から紹介候補を選んで紐付け → 特典を確認 → SNS投稿文をコピー（投稿は手動）。
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            日時はすべて日本時間です。一般公開ページには表示しません。商品画像・写真集の表紙はSNS素材に使わないでください。
          </p>
        </div>
        <LogoutButton className="text-gray-400 hover:text-red-500 text-xs mt-1 shrink-0" />
      </div>
      {loadError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{loadError}</p>
      ) : (
        <RakutenEventsClient initialEvents={events} persons={personOptions} groups={groups} groupInfo={groupInfo} />
      )}
    </div>
  );
}
