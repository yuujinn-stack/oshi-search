import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '免責事項',
  description:
    '推しサーチの掲載情報、アフィリエイト広告、外部リンク等に関する免責事項です。',
};

export default function DisclaimerPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* パンくず */}
      <nav className="text-xs text-gray-400 mb-8 flex items-center gap-1.5">
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>免責事項</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-8">免責事項</h1>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            掲載情報について
          </h2>
          <p>
            推しサーチ（以下「当サイト」）は、芸能人・アイドル・タレント・俳優等の人物情報、出演作品情報、配信情報、関連商品情報を掲載しています。
            これらの情報は公開されている情報をもとに作成していますが、内容の正確性・完全性・最新性を保証するものではありません。
          </p>
          <p className="mt-2">
            掲載情報に誤りや変更がある場合は、できる限り速やかに修正するよう努めますが、常に最新の状態を反映しているとは限りません。
            情報の利用にあたっては、公式サイトや信頼できる情報源をあわせてご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            アフィリエイト広告について
          </h2>
          <p>
            当サイトは、楽天市場・楽天ブックス等のアフィリエイトプログラムに参加しています。
            当サイト内に掲載された商品・サービスへのリンクを経由して購入・申し込みが行われた場合、当サイトが紹介料を受け取ることがあります。
          </p>
          <p className="mt-2">
            アフィリエイトリンクの掲載は、掲載内容の客観性や正確性に影響を与えるものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            外部リンクについて
          </h2>
          <p>
            当サイトには外部サイトへのリンクが含まれています。外部サイトに移動した後の情報・サービス・プライバシーポリシーについては、移動先サイトの規約・ポリシーが適用されます。
            当サイトは外部サイトの内容について責任を負いません。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            著作権・肖像権について
          </h2>
          <p>
            当サイトに掲載されているテキスト・デザイン等のコンテンツの著作権は、当サイトまたはその提供者に帰属します。
            人物の氏名・グループ名・作品名等は、各権利者の著作物・商標です。当サイトはこれらを情報提供の目的でのみ使用しています。
          </p>
          <p className="mt-2">
            掲載内容に関して権利上の問題がある場合は、<Link href="/contact" className="text-indigo-600 hover:underline">お問い合わせページ</Link>よりご連絡ください。確認後、速やかに対応します。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            免責事項の変更
          </h2>
          <p>
            当サイトは、必要に応じてこの免責事項の内容を変更することがあります。変更後の内容は本ページに掲載した時点で効力を生じるものとします。
          </p>
        </section>

        <p className="text-xs text-gray-400 pt-4 border-t border-gray-100">
          制定日：2026年7月10日
        </p>
      </div>
    </div>
  );
}
