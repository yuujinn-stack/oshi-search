'use client';

/**
 * 「楽天BF・推し別セール紹介」のテンプレートカード（手動投稿用）。
 * - 選ぶと既存のストーリーズ作成（/admin/story-maker）を、楽天BFテンプレート・選択中の人物を選んだ状態で開く。
 *   商品の選択・承認・画像生成・ダウンロードは story-maker の実装をそのまま使う（この画面では画像を作らない）。
 * - この画面の投稿テンプレート（INSTAGRAM_TEMPLATES）には入れない。INSTAGRAM_TEMPLATES は自動投稿のローテーションにも使われるため、
 *   価格を載せる投稿が自動投稿・予約投稿に混ざらないようにする。Instagram への投稿は画像を保存してアプリから手動で行う。
 */

import { buildStoryMakerLink } from '@/lib/story-maker/open-link';

export default function BfSaleTemplateCard({ personName }: { personName: string }) {
  const href = buildStoryMakerLink({ template: 'bf', person: personName || undefined, from: 'instagram-post' });
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-5">
      <h2 className="text-sm font-bold text-slate-700 mb-1">手動投稿用テンプレート</h2>
      <p className="text-xs text-gray-500 mb-3">画像を作ってダウンロードし、Instagram アプリから手動で投稿するテンプレートです（下の「投稿を作成」・自動投稿・予約投稿には使いません）。</p>
      <a
        href={href}
        data-testid="bf-sale-template-card"
        className="group flex flex-col sm:flex-row gap-4 rounded-xl border-2 border-amber-500 bg-stone-900 p-4 text-stone-100 hover:bg-stone-800 transition-colors"
      >
        <div className="shrink-0 flex items-center justify-center w-24 h-[120px] rounded-lg border-2 border-amber-400 bg-stone-950 text-amber-300 text-center leading-tight">
          <div>
            <div className="text-[11px] font-bold">楽天BF</div>
            <div className="text-xl font-black">%OFF</div>
            <div className="text-[10px] text-stone-400">4:5</div>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-black text-amber-300">楽天BF・推し別セール紹介</span>
            <span className="text-[11px] font-bold rounded-full bg-amber-400 text-stone-900 px-2 py-0.5">通常投稿（フィード）1080×1350</span>
            <span className="text-[11px] font-bold rounded-full border border-stone-500 text-stone-300 px-2 py-0.5">手動投稿</span>
          </div>
          <p className="text-xs text-stone-300 leading-relaxed">
            楽天ブラックフライデーの対象と確認・承認した推しの商品を、価格と割引率つきで紹介するカルーセル（表紙・商品1〜2ページ・最終ページの3〜4枚）。
            商品の確認・承認、画像の作成・保存は「ストーリーズ作成」の画面で行います。
          </p>
          <p className="text-xs text-stone-400">
            {personName ? <>選択中の人物「<b className="text-stone-200">{personName}</b>」を引き継いで開きます。</> : '人物・グループは開いた画面で選べます。'}
          </p>
          <span className="inline-block text-sm font-bold text-amber-300 group-hover:underline">ストーリーズ作成で開く →</span>
        </div>
      </a>
    </section>
  );
}
