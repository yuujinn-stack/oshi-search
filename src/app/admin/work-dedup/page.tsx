import WorkDedupClient from './WorkDedupClient';
import type { WorkDedupGroup, WorkDedupStats } from '@/lib/work-dedup';

export const dynamic = 'force-dynamic';

async function fetchCandidates(): Promise<{ groups: WorkDedupGroup[]; stats: WorkDedupStats } | null> {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:3000';
    const res = await fetch(`${base}/api/admin/work-dedup/candidates`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function WorkDedupPage() {
  const data = await fetchCandidates();

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-2 text-[var(--ds-fg)]">作品重複候補</h1>
      <p className="text-sm text-[var(--ds-fg-muted)] mb-6">
        タイトル正規化キー・TMDb ID・作品種別による重複候補の一覧です。
        <strong className="text-yellow-400 ml-1">
          この画面はdry-run専用です。DB・Redisの更新は行いません。
        </strong>
      </p>
      {data === null ? (
        <div className="text-red-400 text-sm">重複候補の取得に失敗しました。ログを確認してください。</div>
      ) : (
        <WorkDedupClient groups={data.groups} stats={data.stats} />
      )}
    </main>
  );
}
