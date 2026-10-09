// 見られる作品（作品数重視1位のサービス）・見られない作品＋代替手段・無料で見られる作品。
// 作品カードは /vod/[provider] の既存 VodWorkCard を再利用する。
import Link from 'next/link';
import VodWorkCard from '@/components/VodWorkCard';
import ProviderLogo from '@/components/ProviderLogo';
import type { DiagnosisResult, DiagnosisWork, WorkServiceRef } from '@/lib/oshi-vod/types';
import { toVodPageWork, workDetailUrl } from '@/lib/oshi-vod/format';
import { VOD_TYPE_LABEL } from '@/types/vod';
import { secLabel } from './sec-label';

const FIRST_CARDS = 4;
const MAX_ALT_ROWS = 30;
const MAX_FREE_ROWS = 20;

// 代替手段の有用度（有料見放題 → 無料 → レンタル・購入 → 追加チャンネル → その他）
const ALT_RANK: Record<WorkServiceRef['bucket'], number> = { paid: 0, free: 1, rental: 2, channel: 3, other: 4 };

const BUCKET_LABEL: Record<WorkServiceRef['bucket'], string> = {
  paid: '見放題',
  free: '無料',
  rental: '',
  channel: '追加チャンネル',
  other: '見放題',
};

function refLabel(ref: WorkServiceRef): string {
  if (ref.bucket === 'rental') return VOD_TYPE_LABEL[ref.type];
  if (ref.bucket === 'free') return VOD_TYPE_LABEL[ref.type] === '広告付き無料' ? '広告付き無料' : '無料';
  return BUCKET_LABEL[ref.bucket];
}

function ServiceChip({ svc: r }: { svc: WorkServiceRef }) {
  return (
    <span className={`ov-svc-chip ov-svc-chip--${r.bucket}`}>
      <ProviderLogo providerName={r.service} logoPath={r.logoPath} size="xs" />
      <span>{r.displayName}</span>
      <span className="ov-svc-chip-type">{refLabel(r)}</span>
    </span>
  );
}

function WorkRow({ work, refs }: { work: DiagnosisWork; refs: WorkServiceRef[] }) {
  return (
    <li className="ov-work-row">
      <Link href={workDetailUrl(work)} className="ov-work-row-title">{work.work.title}</Link>
      <span className="ov-work-row-meta">
        {work.work.releaseYear ? `${work.work.releaseYear}年・` : ''}{work.personNames.join('、')}
      </span>
      {refs.length > 0 && (
        <span className="ov-work-row-chips">
          {refs.map((r) => <ServiceChip key={`${r.service}-${r.type}-${r.displayName}`} svc={r} />)}
        </span>
      )}
    </li>
  );
}

export default function OshiVodWorkLists({ result }: { result: DiagnosisResult }) {
  const byKey = new Map(result.works.map((w) => [w.key, w]));
  const top = result.byWorkCount[0]?.stat ?? null;
  const watchable = top ? top.paidKeys.map((k) => byKey.get(k)).filter((w): w is DiagnosisWork => !!w) : [];
  // 見られる手段が有用な作品から並べる（同順位は元の順＝公開日の新しい順）
  const unwatchable = [...result.unwatchable].sort(
    (a, b) => ALT_RANK[a.alternatives[0].bucket] - ALT_RANK[b.alternatives[0].bucket],
  );
  const noneCount = result.totals.none;

  // 無料作品をサービス別にまとめる
  const freeByService = new Map<string, { ref: WorkServiceRef; works: DiagnosisWork[] }>();
  for (const key of result.freeWorkKeys) {
    const w = byKey.get(key);
    if (!w) continue;
    for (const r of w.services.filter((s) => s.bucket === 'free')) {
      const entry = freeByService.get(r.service) ?? { ref: r, works: [] };
      entry.works.push(w);
      freeByService.set(r.service, entry);
    }
  }
  const freeGroups = [...freeByService.values()].sort((a, b) => b.works.length - a.works.length);

  return (
    <>
      {top && watchable.length > 0 && (
        <section aria-labelledby="ov-watchable-heading" style={secLabel('WORKS')}>
          <h2 id="ov-watchable-heading" className="ov-h2">{top.displayName}で見放題の作品（{watchable.length}作品）</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {watchable.slice(0, FIRST_CARDS).map((w) => <VodWorkCard key={w.key} work={toVodPageWork(w, 'flatrate')} />)}
          </div>
          {watchable.length > FIRST_CARDS && (
            <details className="ov-more mt-3">
              <summary>残り{watchable.length - FIRST_CARDS}作品を見る</summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                {watchable.slice(FIRST_CARDS).map((w) => <VodWorkCard key={w.key} work={toVodPageWork(w, 'flatrate')} />)}
              </div>
            </details>
          )}
        </section>
      )}

      {(unwatchable.length > 0 || noneCount > 0) && (
        <section aria-labelledby="ov-unwatchable-heading" style={secLabel('ALTERNATIVES')}>
          <h2 id="ov-unwatchable-heading" className="ov-h2">
            {top ? `${top.displayName}では見放題にない作品` : '配信が確認できる作品'}
          </h2>
          <p className="ov-note">ほかのサービスで見られる場合は、その方法を表示しています。</p>
          {unwatchable.length > 0 && (
            <details className="ov-more">
              <summary>ほかのサービスで見られる作品（{unwatchable.length}作品）</summary>
              <ul className="ov-work-rows">
                {unwatchable.slice(0, MAX_ALT_ROWS).map((e) => {
                  const w = byKey.get(e.key);
                  return w ? <WorkRow key={e.key} work={w} refs={e.alternatives} /> : null;
                })}
              </ul>
              {unwatchable.length > MAX_ALT_ROWS && (
                <p className="ov-note">ほか{unwatchable.length - MAX_ALT_ROWS}作品は、各人物ページの出演作品からご確認いただけます。</p>
              )}
            </details>
          )}
          {noneCount > 0 && (
            <p className="ov-note">
              このほか{noneCount}作品は、現在どの配信サービスでも配信を確認できていません
              （舞台・ライブ・放送のみの番組などを含みます）。
            </p>
          )}
        </section>
      )}

      {freeGroups.length > 0 && (
        <section aria-labelledby="ov-free-heading" style={secLabel('FREE')}>
          <h2 id="ov-free-heading" className="ov-h2">無料で見られる作品（{result.totals.free}作品）</h2>
          <p className="ov-note">
            TVer・YouTube・各サービスの無料配信など。有料サブスクのランキングとは別に数えています。
            見逃し配信は期間限定の場合があります。
          </p>
          <div className="ov-free-groups">
            {freeGroups.map(({ ref, works }) => (
              <details key={ref.service} className="ov-more">
                <summary>
                  <span className="inline-flex items-center gap-2">
                    <ProviderLogo providerName={ref.service} logoPath={ref.logoPath} size="xs" />
                    {ref.displayName}（{works.length}作品）
                  </span>
                </summary>
                <ul className="ov-work-rows">
                  {works.slice(0, MAX_FREE_ROWS).map((w) => <WorkRow key={w.key} work={w} refs={[]} />)}
                </ul>
                {works.length > MAX_FREE_ROWS && (
                  <p className="ov-note">ほか{works.length - MAX_FREE_ROWS}作品は、各人物ページの出演作品からご確認いただけます。</p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
