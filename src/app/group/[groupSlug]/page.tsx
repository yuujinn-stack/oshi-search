// 旧 /group/[groupSlug] → /groups/[slug] への永続リダイレクト
// このファイルはリダイレクトのみを行います。コンテンツは /groups/[groupSlug]/page.tsx にあります。
import { permanentRedirect } from 'next/navigation';
import { getAllGroupMetas } from '@/lib/group-meta';
import { resolveGroupFromSlug, canonicalGroupSlug } from '@/lib/group-slug';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ groupSlug: string }>;
}

export default async function GroupRedirectPage({ params }: Props) {
  const { groupSlug } = await params;
  const metas = await getAllGroupMetas();
  const meta = resolveGroupFromSlug(groupSlug, metas);
  if (meta) {
    permanentRedirect(`/groups/${canonicalGroupSlug(meta)}`);
  }
  permanentRedirect(`/groups/${groupSlug}`);
}
