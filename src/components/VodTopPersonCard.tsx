import Link from 'next/link';

// /vod/[provider] の「配信作品がある人物」セクション用の簡易人物カード。
// 既存 PersonCard.tsx と同じ視覚言語（丸背景アバター・角丸カード）を踏襲しつつ、
// このページ固有の「対象サービスでの確認済み作品数」を表示する軽量版。
export default function VodTopPersonCard({
  name,
  group,
  workCount,
}: {
  name: string;
  group: string;
  workCount: number;
}) {
  const initial = name[0];
  return (
    <Link href={`/person/${encodeURIComponent(name)}`} className="block">
      <div
        className="rounded-2xl p-4 text-center transition-all duration-200 hover:-translate-y-1"
        style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
      >
        <div
          aria-hidden="true"
          data-initial={initial}
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2 text-white text-lg font-bold select-none"
          style={{ background: 'var(--ds-primary)' }}
        />
        <p className="font-bold text-sm leading-snug truncate" style={{ color: 'var(--ds-text)' }}>{name}</p>
        {group && (
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ds-muted)' }}>{group}</p>
        )}
        <p className="text-[11px] mt-1.5 font-semibold" style={{ color: 'var(--ds-primary)' }}>
          {workCount}作品
        </p>
      </div>
    </Link>
  );
}
