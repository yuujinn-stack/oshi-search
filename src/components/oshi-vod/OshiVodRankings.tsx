// 3種類のランキング（作品数重視・月額重視・コスパ重視）をタブで切り替えて表示する。
// 順位は core.ts の作品数・料金データだけで決まっており、ここでは並び順を一切変更しない。
// ランキング内には公式サイトへのボタンを置かない（広告の掲載順位のように見えないようにするため。
// 公式サイトへの導線は結論カード・組み合わせ・詳しい比較に置いている）。
import type { DiagnosisResult, RankedService } from '@/lib/oshi-vod/types';
import OshiVodServiceLine from './OshiVodServiceLine';
import OshiVodRankingTabs from './OshiVodRankingTabs';
import { secLabel } from './sec-label';

const VISIBLE = 3;

function RankingList({
  description,
  items,
  paidTotal,
  emphasis,
  emptyText,
}: {
  description: string;
  items: RankedService[];
  paidTotal: number;
  emphasis: 'count' | 'price' | 'cost';
  emptyText: string;
}) {
  const head = items.slice(0, VISIBLE);
  const rest = items.slice(VISIBLE);
  const line = (r: RankedService) => (
    <li key={r.stat.service} className="ov-rank-item">
      <OshiVodServiceLine
        stat={r.stat}
        paidTotal={paidTotal}
        rankLabel={r.tied ? `同率${r.rank}位` : `${r.rank}位`}
        emphasis={emphasis}
        showCost={emphasis === 'cost'}
      />
    </li>
  );
  return (
    <div className="ov-panel">
      <p className="ov-note mt-0">{description}</p>
      {items.length === 0 ? (
        <p className="ov-note">{emptyText}</p>
      ) : (
        <>
          <ol className="ov-rank-list">{head.map(line)}</ol>
          {rest.length > 0 && (
            <details className="ov-more">
              <summary>4位以降を見る（{rest.length}サービス）</summary>
              <ol className="ov-rank-list">{rest.map(line)}</ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function leaderName(items: RankedService[]): string | null {
  const top = items.filter((r) => r.rank === 1);
  if (top.length === 0) return null;
  return top.length > 1 ? `${top[0].stat.displayName}ほか` : top[0].stat.displayName;
}

export default function OshiVodRankings({ result }: { result: DiagnosisResult }) {
  const paidTotal = result.totals.paid;
  if (paidTotal === 0) return null;
  return (
    <section aria-labelledby="ov-rankings-heading" style={secLabel('RANKING')}>
      <h2 id="ov-rankings-heading" className="ov-h2">目的別ランキング</h2>
      <p className="ov-note mt-0 mb-3">順位は作品数・料金・配信データだけで決めています。広告の有無は順位に関係ありません。</p>
      <OshiVodRankingTabs
        tabs={[
          {
            id: 'count',
            label: '作品数重視',
            leader: leaderName(result.byWorkCount),
            content: (
              <RankingList
                description="推しの出演作品を見放題で一番多く見られる順"
                items={result.byWorkCount}
                paidTotal={paidTotal}
                emphasis="count"
                emptyText="有料サブスクで見放題が確認できる作品はありません。"
              />
            ),
          },
          {
            id: 'price',
            label: '月額重視',
            leader: leaderName(result.byMonthlyPrice),
            content: (
              <RankingList
                description="推しの作品が1作品以上見られるサービスを、月額の安い順に（料金を公式サイトで確認できたサービスのみ）"
                items={result.byMonthlyPrice}
                paidTotal={paidTotal}
                emphasis="price"
                emptyText="料金を比較できるサービスがありません。"
              />
            ),
          },
          {
            id: 'cost',
            label: 'コスパ重視',
            leader: leaderName(result.byCostPerWork),
            content: (
              <RankingList
                description="月額料金 ÷ 見られる作品数（1作品あたりの料金）が安い順（料金を公式サイトで確認できたサービスのみ）"
                items={result.byCostPerWork}
                paidTotal={paidTotal}
                emphasis="cost"
                emptyText="料金を比較できるサービスがありません。"
              />
            ),
          },
        ]}
      />
    </section>
  );
}
