import { permanentRedirect, notFound } from 'next/navigation';
import { getPublicWorkById } from '@/lib/work-store';
import { getWorkPublicUrl } from '@/lib/work-url';

interface Props {
  params: Promise<{ slug: string; workId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function WorkDetailRedirectPage({ params }: Props) {
  const { workId: rawWorkId } = await params;
  const workId = decodeURIComponent(rawWorkId);
  if (!workId.trim()) notFound();
  const work = await getPublicWorkById(workId);
  if (!work) notFound();
  const newUrl = getWorkPublicUrl({ workId });
  if (!newUrl) notFound();
  permanentRedirect(newUrl);
}
