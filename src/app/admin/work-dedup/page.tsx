import WorkDedupClient from './WorkDedupClient';

export const dynamic = 'force-dynamic';

export default function WorkDedupPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-2 text-[var(--ds-fg)]">作品重複候補</h1>
      <p className="text-sm text-[var(--ds-fg-muted)] mb-6">
        タイトル正規化キー・TMDb ID・作品種別による重複候補の一覧です。
        <strong className="text-yellow-400 ml-1">
          この画面はdry-run専用です。DB・Redisの更新は行いません。
        </strong>
      </p>
      <WorkDedupClient />
    </main>
  );
}
