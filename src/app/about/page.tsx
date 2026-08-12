import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '推しサーチについて',
  description:
    '推しサーチの目的、掲載している情報、運営者情報についてご案内します。',
};

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* パンくず */}
      <nav className="text-xs text-gray-400 mb-8 flex items-center gap-1.5">
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>推しサーチについて</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-8">推しサーチについて</h1>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            サイトの目的
          </h2>
          <p>
            推しサーチは、好きな芸能人・アイドル・俳優・アーティストなどから、その人が出演している映画・ドラマ・番組と、現在視聴できる動画配信サービスを探せるサイトです。
          </p>
          <p className="mt-2">
            「この人の出演作品を見たい」「どの動画配信サービスで見られるか知りたい」というときに、人物を起点として作品や配信先を探しやすくすることを目的としています。
          </p>
          <p className="mt-2">
            また、人物に関連するCD・Blu-ray・写真集・書籍などの商品情報もあわせて掲載しています。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            掲載している情報
          </h2>
          <ul className="space-y-1 list-disc list-inside text-gray-600">
            <li>人物・グループの基本情報</li>
            <li>出演している映画・ドラマ・番組などの作品情報</li>
            <li>現在視聴できる動画配信サービス（VOD）の情報</li>
            <li>人物に関連するCD・Blu-ray・写真集・書籍などの商品情報</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            情報の調査・更新について
          </h2>
          <p>
            作品・配信情報の調査方法や更新の考え方については、
            <Link href="/editorial-policy" className="text-indigo-600 hover:underline">情報の調査・更新方針</Link>
            のページで詳しくご案内しています。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            運営者情報
          </h2>
          <dl className="space-y-2">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-gray-800 w-24 flex-shrink-0">運営</dt>
              <dd className="text-gray-600">推しサーチ運営</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-gray-800 w-24 flex-shrink-0">サイトURL</dt>
              <dd className="text-gray-600">https://oshi-search.jp/</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-gray-800 w-24 flex-shrink-0">運営目的</dt>
              <dd className="text-gray-600">芸能人・アイドル・俳優・アーティストなどの出演作品と動画配信情報を探しやすくするため</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-semibold text-gray-800 w-24 flex-shrink-0">お問い合わせ</dt>
              <dd className="text-gray-600">
                <Link href="/contact" className="text-indigo-600 hover:underline">お問い合わせページ</Link>
                よりご連絡ください。
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            掲載内容について
          </h2>
          <p>
            掲載情報の正確性向上に努めていますが、内容の完全性・正確性・最新性を保証するものではありません。
            詳しくは<Link href="/disclaimer" className="text-indigo-600 hover:underline">免責事項</Link>をご確認ください。
          </p>
        </section>

      </div>
    </div>
  );
}
