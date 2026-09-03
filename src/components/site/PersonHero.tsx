// 人物ページ ファーストビュー。
// 元々 src/app/person/[slug]/page.tsx にインラインで書かれていた人物情報カード＋
// 数字サマリーを切り出したもの（表示内容・データ取得元は変更していない）。
// 変更点は数字サマリーの並び順のみ：「今すぐ見られる作品数」を最優先で見せるため
// 配信中 → 出演作品 → 関連商品 → 配信サービス の順に並べ替えた
// （推しサーチの一番の価値＝配信中作品への導線を最初に伝えるため）。
import Link from 'next/link';
import type { PersonWithConfig, ActivityStatus } from '@/types/person';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { GroupMeta } from '@/types/group';
import { buildHeroBadgeTitles, normalizeTag } from '@/lib/person-display-tags';
import { ACTIVITY_LABEL, ACTIVITY_BADGE_CLS, GENRE_BADGE } from '@/lib/person-badges';

interface StatItem {
  label: string;
  value: number;
  unit: string;
  href: string;
}

interface Props {
  person: PersonWithConfig;
  personMeta: PersonMeta | null;
  groupMeta: GroupMeta | null;
  groupPagePath: string | null;
  heroBackground: string;
  stats: StatItem[];
}

export default function PersonHero({ person, personMeta, groupMeta, groupPagePath, heroBackground, stats }: Props) {
  return (
    <div className="py-8 px-4" style={{ background: heroBackground }}>
      <div className="max-w-4xl mx-auto">

        {/* 人物情報 */}
        <div className="flex items-start gap-4 mb-6">
          {/* アバター */}
          <div
            className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-4xl font-black flex-shrink-0 select-none border border-white/20"
            aria-hidden="true"
            data-initial={person.name[0]}
          />

          {/* テキスト情報 */}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">{person.name}</h1>

            {/* メイン肩書き（primaryGenre優先）+ グループリンク */}
            {(() => {
              const groupLink = personMeta?.currentGroupName || person.group || null;
              if (personMeta?.primaryGenre) {
                return (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-white/80 text-sm font-medium">{personMeta.primaryGenre}</span>
                    {groupLink && (
                      <Link
                        href={groupLink === person.group && groupPagePath ? groupPagePath : `/groups/${encodeURIComponent(groupLink)}`}
                        className="text-white/50 hover:text-white/80 text-xs transition-colors underline underline-offset-2 decoration-white/20"
                      >
                        {groupLink}
                      </Link>
                    )}
                  </div>
                );
              }
              if (groupLink) {
                return (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Link
                      href={groupLink === person.group && groupPagePath ? groupPagePath : `/groups/${encodeURIComponent(groupLink)}`}
                      className="text-white/80 hover:text-white text-sm font-medium transition-colors underline underline-offset-2 decoration-white/40 hover:decoration-white"
                    >
                      {groupLink}
                    </Link>
                    {groupMeta?.activityStatus === 'renamed' && groupMeta.renamedTo && (
                      <Link
                        href={`/groups/${encodeURIComponent(groupMeta.renamedTo)}`}
                        className="text-[11px] text-white/60 hover:text-white transition-colors"
                      >
                        （現: {groupMeta.renamedTo}）
                      </Link>
                    )}
                  </div>
                );
              }
              return <p className="text-white/70 mt-1 text-sm">ソロ活動</p>;
            })()}

            {/* バッジ群 */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {/* titles: primaryGenre・genre と重複する値を除外して正規化表示 */}
              {buildHeroBadgeTitles({
                genre: person.genre,
                primaryGenre: personMeta?.primaryGenre,
                titles: personMeta?.titles,
              }).map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/25 text-white font-medium">
                  {t}
                </span>
              ))}
              {/* genre バッジ（正規化して表示） */}
              {(() => {
                const displayGenre = normalizeTag(person.genre) ?? person.genre;
                return (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${GENRE_BADGE[displayGenre] ?? GENRE_BADGE[person.genre] ?? 'bg-gray-100 text-gray-600'}`}>
                    {displayGenre}
                  </span>
                );
              })()}
              {personMeta?.activityStatus && personMeta.activityStatus !== ('unknown' as ActivityStatus) && (
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ACTIVITY_BADGE_CLS[personMeta.activityStatus]}`}>
                  {ACTIVITY_LABEL[personMeta.activityStatus]}
                </span>
              )}
              {personMeta?.generation && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/20 text-white font-medium">
                  {personMeta.generation}
                </span>
              )}
              {personMeta?.joinedAt && (
                <span className="text-[11px] text-white/60">
                  {personMeta.joinedAt.slice(0, 7)} 加入
                </span>
              )}
              {personMeta?.leftAt && (
                <span className="text-[11px] text-white/60">
                  → {personMeta.leftAt.slice(0, 7)} 卒業
                </span>
              )}
            </div>

            {/* 旧グループ / 補足メモ */}
            {((personMeta?.formerGroupNames?.length ?? 0) > 0 || personMeta?.membershipNote) && (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {personMeta?.formerGroupNames?.map((g) => (
                  <span key={g} className="text-[11px] text-white/60">元{g}</span>
                ))}
                {personMeta?.membershipNote && (
                  <span className="text-[11px] text-white/60 italic">{personMeta.membershipNote}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stats バー（タップで該当セクションへ移動） */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {stats.map(({ label, value, unit, href }) => (
            <a
              key={label}
              href={href}
              className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2.5 text-center hover:bg-white/25 transition-colors block"
            >
              <p className="text-white/70 text-[10px] font-medium">{label}</p>
              {value > 0 ? (
                <p className="text-white font-black text-xl mt-0.5 leading-none">
                  {value.toLocaleString()}
                  <span className="text-xs font-medium ml-0.5">{unit}</span>
                </p>
              ) : (
                <p className="text-white/40 text-sm mt-1">—</p>
              )}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
