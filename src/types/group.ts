export type GroupActivityStatus = 'active' | 'renamed' | 'disbanded' | 'hiatus' | 'unknown';

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
  createdAt?: number;
  updatedAt?: number;
}
