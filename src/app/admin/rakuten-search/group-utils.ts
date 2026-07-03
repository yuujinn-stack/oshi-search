import type { PersonOption } from '@/components/admin/PersonCombobox';

// currentGroupName（改名後）→ group（persons_master）の優先順で実効グループ名を返す
export function getEffectiveGroup(p: PersonOption): string {
  return p.currentGroupName ?? p.group ?? '';
}

// persons 全体からグループ一覧を生成（空・undefined を除外してソート）
export function createGroupList(persons: PersonOption[]): string[] {
  return [...new Set(persons.map(getEffectiveGroup).filter(Boolean))].sort();
}
