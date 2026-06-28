import type { ActivityStatus } from '@/types/person';

export interface MembershipInfo {
  activityStatus?: ActivityStatus;
  leftAt?: string;
  currentGroupName?: string;
  formerGroupNames?: string[];
}

export interface PostMembershipCheckResult {
  shouldReview: boolean;
  reason?: string;
}

const POST_MEMBERSHIP_STATUSES: ActivityStatus[] = ['graduated', 'withdrawn', 'retired'];

const STATUS_LABEL: Record<string, string> = {
  graduated: '卒業',
  withdrawn: '脱退',
  retired:   '引退',
};

/**
 * 所属期間後に発売されたグループ商品候補かどうかを判定する汎用ライブラリ。
 * 商品タイトルだけでなく VOD・ニュース等のコンテンツにも使用可能。
 *
 * shouldReview=true の条件（全て満たす必要あり）:
 * 1. activityStatus が graduated / withdrawn / retired
 * 2. leftAt が存在する（脱退・卒業日が記録済み）
 * 3. content にグループ名（currentGroupName or formerGroupNames）が含まれる
 * 4. content に personName または aliases が含まれない
 */
export function checkPostMembershipGroupContent(
  content: string,
  personName: string,
  aliases: string[],
  info: MembershipInfo,
): PostMembershipCheckResult {
  const { activityStatus, leftAt, currentGroupName, formerGroupNames } = info;

  // 条件①: 対象 activityStatus か
  if (!activityStatus || !POST_MEMBERSHIP_STATUSES.includes(activityStatus)) {
    return { shouldReview: false };
  }

  // 条件②: leftAt が存在するか
  if (!leftAt) {
    return { shouldReview: false };
  }

  // 条件③: グループ名が content に含まれるか
  const groupNames = [currentGroupName, ...(formerGroupNames ?? [])].filter(Boolean) as string[];
  const matchedGroup = groupNames.find((g) => content.includes(g));
  if (!matchedGroup) {
    return { shouldReview: false };
  }

  // 条件④: 人物名・aliases が content に含まれない（含まれる場合は本人関連商品）
  const identifiers = [personName, ...aliases].filter(Boolean);
  if (identifiers.some((id) => content.includes(id))) {
    return { shouldReview: false };
  }

  const label = STATUS_LABEL[activityStatus] ?? activityStatus;
  return {
    shouldReview: true,
    reason: `卒業後グループ商品候補（${label}後・${matchedGroup}・本人名なし）`,
  };
}
