/**
 * 人物とグループの所属履歴（person_group_memberships）を登録する移行スクリプト（冪等）。
 *
 * 実行方法:
 *   npx dotenv -e .env.local -- tsx scripts/group-membership/apply-memberships.ts            # 確認のみ（書き込みなし）
 *   npx dotenv -e .env.local -- tsx scripts/group-membership/apply-memberships.ts --apply    # 登録
 *
 * - (人物, グループ) 単位の upsert のため、何度実行しても行は増えない（2回目以降は「変更なし」）
 * - 人物は既存レコード（persons.name）だけを対象にし、新しい人物レコードは作らない
 * - 既存の所属情報（person_meta の activityStatus / joinedAt / leftAt）を、登録グループ（persons.group）の
 *   所属行にそのまま移す（脱退日などを保持）。既存データで確認できない日付は NULL のまま（推測しない）
 * - --apply の前に、対象人物の persons / person_meta / 既存の所属行を tmp/ に JSON で書き出す（復元用）
 * - 既存テーブルの削除・人物IDの変更・作品/商品データの変更は行わない
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { persons as personsTable, personMeta as personMetaTable, groupMeta as groupMetaTable } from '@/db/schema';
import { fetchMembershipRecords, saveMembershipsForPerson } from '@/lib/group-membership-service';
import { legacyMetaMirror, type MembershipRecord } from '@/lib/group-membership';
import type { MembershipInput } from '@/lib/group-membership-store';
import type { ActivityStatus } from '@/types/person';

/**
 * 登録する所属。fromRegisteredGroup=true の行は、状態・日付を person_meta の既存値から取る
 * （expectStatus と一致しない場合は登録せずに停止する）。
 */
interface Spec {
  person: string;
  groupName: string;
  fromRegisteredGroup?: { expectStatus: ActivityStatus };
  status?: ActivityStatus;
}

const SPECS: Spec[] = [
  // King & Prince（登録グループ。既存の加入日・脱退日を保持）
  { person: '平野紫耀',   groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'withdrawn' } },
  { person: '神宮寺勇太', groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'withdrawn' } },
  { person: '岸優太',     groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'withdrawn' } },
  { person: '岩橋玄樹',   groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'withdrawn' } },
  { person: '永瀬廉',     groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'active' } },
  { person: '髙橋海人',   groupName: 'King & Prince', fromRegisteredGroup: { expectStatus: 'active' } },
  // Number_i（現役。加入日は既存データに無いため NULL）
  { person: '平野紫耀',   groupName: 'Number_i', status: 'active' },
  { person: '神宮寺勇太', groupName: 'Number_i', status: 'active' },
  { person: '岸優太',     groupName: 'Number_i', status: 'active' },
];

const sameRecord = (a: MembershipRecord | undefined, b: MembershipInput) =>
  !!a && a.activityStatus === b.activityStatus && (a.joinedAt ?? null) === (b.joinedAt ?? null) && (a.leftAt ?? null) === (b.leftAt ?? null);

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`=== 所属履歴の登録（${apply ? '書き込みあり' : '確認のみ'}）===`);

  const names = [...new Set(SPECS.map((s) => s.person))];
  const groupNames = [...new Set(SPECS.map((s) => s.groupName))];
  const [personRows, metaRows, groupRows] = await Promise.all([
    db.select().from(personsTable).where(inArray(personsTable.name, names)),
    db.select().from(personMetaTable).where(inArray(personMetaTable.personName, names)),
    db.select().from(groupMetaTable).where(inArray(groupMetaTable.groupName, groupNames)),
  ]);
  const personByName = new Map(personRows.map((p) => [p.name, p]));
  const metaByName = new Map(metaRows.map((m) => [m.personName, m]));

  const missing = names.filter((n) => !personByName.has(n));
  if (missing.length > 0) throw new Error(`既存の人物レコードが見つかりません（新規作成はしません）: ${missing.join(', ')}`);
  for (const g of groupNames) {
    const gm = groupRows.find((r) => r.groupName === g);
    console.log(`group_meta ${g}: ${gm ? `あり（slug=${gm.slug}）` : 'なし → ensureGroupMeta で既存ルールにより作成'}`);
  }

  // 人物ごとの入力を組み立てる
  const plan = new Map<string, MembershipInput[]>();
  for (const s of SPECS) {
    const person = personByName.get(s.person)!;
    const meta = metaByName.get(s.person);
    let input: MembershipInput;
    if (s.fromRegisteredGroup) {
      if (person.groupName !== s.groupName) throw new Error(`${s.person}: 登録グループが ${person.groupName}（想定 ${s.groupName}）`);
      if (meta?.activityStatus !== s.fromRegisteredGroup.expectStatus) {
        throw new Error(`${s.person}: person_meta.activityStatus=${meta?.activityStatus}（想定 ${s.fromRegisteredGroup.expectStatus}）`);
      }
      input = { groupName: s.groupName, activityStatus: s.fromRegisteredGroup.expectStatus, joinedAt: meta?.joinedAt ?? null, leftAt: meta?.leftAt ?? null };
    } else {
      input = { groupName: s.groupName, activityStatus: s.status!, joinedAt: null, leftAt: null };
    }
    plan.set(s.person, [...(plan.get(s.person) ?? []), input]);
  }

  const backup: Record<string, unknown> = { createdAt: new Date().toISOString(), persons: personRows, personMeta: metaRows, memberships: {} };
  let changes = 0;
  for (const [name, inputs] of plan) {
    const existing = await fetchMembershipRecords(name);
    (backup.memberships as Record<string, unknown>)[name] = existing;
    const person = { name, group: personByName.get(name)!.groupName };
    for (const input of inputs) {
      const cur = existing.find((r) => r.groupName === input.groupName);
      const same = sameRecord(cur, input);
      if (!same) changes++;
      console.log(`${same ? '変更なし' : cur ? '更新' : '追加'}  ${name} / ${input.groupName}: ${input.activityStatus} 加入=${input.joinedAt ?? 'NULL'} 脱退=${input.leftAt ?? 'NULL'}`);
    }
    const mirror = legacyMetaMirror(person, inputs.map((i) => ({ personName: name, groupName: i.groupName, activityStatus: i.activityStatus, joinedAt: i.joinedAt ?? null, leftAt: i.leftAt ?? null })));
    const meta = metaByName.get(name);
    for (const k of ['activityStatus', 'joinedAt', 'leftAt'] as const) {
      if (mirror[k] !== undefined && mirror[k] !== (meta?.[k] ?? undefined)) console.log(`  person_meta.${k}: ${meta?.[k] ?? 'NULL'} → ${mirror[k]}`);
    }
  }
  console.log(`変更予定: ${changes}行`);

  if (!apply) {
    console.log('確認のみのため書き込みはしていません（登録するには --apply）。');
    return;
  }

  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  const backupPath = join(process.cwd(), 'tmp', `group-membership-backup-${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`変更前の値を保存: ${backupPath}`);

  for (const [name, inputs] of plan) {
    await saveMembershipsForPerson({ name, group: personByName.get(name)!.groupName }, inputs);
  }
  console.log('登録しました。');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
