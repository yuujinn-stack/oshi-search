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
  createdAt?: number;
  updatedAt?: number;
}
