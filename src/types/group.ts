import type { HomeGroupCategory } from '@/lib/home-group-category';

export type GroupActivityStatus = 'active' | 'renamed' | 'disbanded' | 'hiatus' | 'unknown';

// 写真集機能用。既存DBに性別情報がないため新設。管理画面からの手動設定のみ（推測しない）。
export type GroupGender = 'female' | 'male';

export interface GroupMeta {
  groupName: string;
  slug: string;
  activityStatus: GroupActivityStatus;
  formedAt?: string;
  endedAt?: string;
  renamedFrom?: string;
  renamedTo?: string;
  formerNames?: string[];
  officialSite?: string;
  note?: string;
  gender?: GroupGender;
  /** トップページ「グループで探す」の分類（管理画面で保存した値。未設定なら undefined＝初期値の一覧で判定） */
  homeCategory?: HomeGroupCategory;
  createdAt?: number;
  updatedAt?: number;
}
