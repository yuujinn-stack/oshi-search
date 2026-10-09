// 人物別の内訳（同じ作品を各人物側に表示してよい。全体の集計は重複排除済み）。
import Link from 'next/link';
import type { DiagnosisResult } from '@/lib/oshi-vod/types';
import { secLabel } from './sec-label';

export default function OshiVodPersonBreakdown({ result }: { result: DiagnosisResult }) {
  if (result.persons.length < 2) return null;
  return (
    <section aria-labelledby="ov-persons-heading" style={secLabel('PERSONS')}>
      <h2 id="ov-persons-heading" className="ov-h2">推しごとの内訳</h2>
      <details className="ov-more">
        <summary>{result.persons.length}人それぞれの結果を見る</summary>
        <ul className="ov-person-breakdown">
          {result.personBreakdown.map((p) => (
            <li key={p.name} className="ov-panel">
              <p className="ov-panel-title">
                <Link href={`/person/${encodeURIComponent(p.name)}`} className="theme-text-link">{p.name}</Link>
                {p.group && <span className="ov-muted ml-2 text-xs font-normal">{p.group}</span>}
              </p>
              <p className="ov-line-nums">
                <span>登録出演作品 {p.registeredCount}</span>
                <span>有料サブスクで見放題 {p.paidCount}</span>
                <span>無料 {p.freeCount}</span>
              </p>
              {p.topServices.length > 0 ? (
                <p className="ov-note">
                  見放題が多いサービス：
                  {p.topServices.map((t) => `${t.stat.displayName} ${t.count}作品`).join(' / ')}
                </p>
              ) : (
                <p className="ov-note">有料サブスクで見放題が確認できる作品はありません。</p>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
