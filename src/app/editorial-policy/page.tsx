import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '情報の調査・更新方針',
  description:
    '推しサーチにおける人物・作品・配信情報・商品情報の調査方法と更新の考え方についてご案内します。',
};

export default function EditorialPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* パンくず */}
      <nav className="text-xs text-gray-400 mb-8 flex items-center gap-1.5">
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>情報の調査・更新方針</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-8">情報の調査・更新方針</h1>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

        <section>
          <p>
            推しサーチは、出演作品と現在の動画配信情報を継続的に確認・整理してお届けすることを目指しています。
            このページでは、掲載している情報をどのように調査・更新しているかをご案内します。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            1. 人物・グループ情報について
          </h2>
          <p>
            人物・グループの基本情報（氏名・所属グループ等）は、運営が管理する情報をもとに掲載しています。
            出演作品の特定には、映画・番組情報データベースであるTMDb（The Movie Database）の情報を利用しています。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            2. 出演作品情報について
          </h2>
          <p>
            出演作品の情報は、TMDb（The Movie Database）等の外部データベースの情報をもとに掲載しています。
            同姓同名の別人の作品が誤って含まれることのないよう、情報整理や確認作業の補助として自動処理を利用する場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            3. 配信情報（VOD）について
          </h2>
          <p>
            動画配信サービスの情報は、TMDbの配信情報データや各動画配信サービスの公式情報をもとに、運営による確認調査を行った上で掲載しています。
            情報整理や確認作業の補助として自動処理を利用する場合があります。
            各作品には確認日を表示しており、定期的に再確認を行うよう努めています。
          </p>
          <p className="mt-2">
            ただし、配信状況は各サービス側の都合により随時変更されるため、当サイトの表示が常に最新であるとは限りません。
            視聴前に必ず各配信サービスの公式サイトでご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            4. 商品情報について
          </h2>
          <p>
            CD・Blu-ray・写真集・書籍などの商品情報は、楽天市場から商品情報を取得して掲載しています。
            価格・在庫状況は変動するため、購入前に必ず販売ページでご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            5. 情報の修正・訂正について
          </h2>
          <p>
            掲載情報に誤りや古い内容を見つけた場合は、<Link href="/contact" className="text-indigo-600 hover:underline">お問い合わせページ</Link>より内容をお知らせください。
            確認の上、修正いたします。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            6. 情報の正確性について
          </h2>
          <p>
            情報の正確性向上に努めていますが、掲載内容の完全性・正確性・最新性を保証するものではありません。
            最新の配信状況・価格・販売状況等は、必ず各公式サイトでご確認ください。
          </p>
          <p className="mt-2">
            その他の免責事項については<Link href="/disclaimer" className="text-indigo-600 hover:underline">免責事項</Link>もあわせてご確認ください。
          </p>
        </section>

      </div>
    </div>
  );
}
