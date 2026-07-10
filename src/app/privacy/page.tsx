import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'プライバシーポリシー',
  description:
    '推しサーチにおける個人情報、Cookie、アクセス解析、アフィリエイト広告等の取り扱いについて説明します。',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* パンくず */}
      <nav className="text-xs text-gray-400 mb-8 flex items-center gap-1.5">
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>プライバシーポリシー</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-8">プライバシーポリシー</h1>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            基本方針
          </h2>
          <p>
            推しサーチ（以下「当サイト」）は、ユーザーの個人情報の保護を重要な責務と考えています。
            本ポリシーでは、当サイトにおける個人情報の取り扱いについて説明します。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            収集する情報
          </h2>
          <p>当サイトでは、以下の情報を収集する場合があります。</p>
          <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
            <li>ページのアクセス状況・閲覧履歴（アクセス解析ツールによる）</li>
            <li>検索キーワード（当サイト内検索機能による）</li>
            <li>Cookie・ローカルストレージ等のブラウザ保存データ</li>
            <li>お問い合わせ時に任意でご提供いただく情報</li>
          </ul>
          <p className="mt-2">
            氏名・住所・電話番号・メールアドレス等の個人を直接識別できる情報は、問い合わせ対応に必要な場合を除き、収集していません。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            Cookieについて
          </h2>
          <p>
            当サイトは、サービスの改善・利便性向上を目的として Cookie を利用する場合があります。
            Cookie はブラウザの設定により無効にすることができますが、一部の機能が正常に動作しない場合があります。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            アクセス解析について
          </h2>
          <p>
            当サイトは、サービス改善のためにアクセス解析ツールを利用する場合があります。
            アクセス解析ツールは Cookie を使用してアクセス情報を収集しますが、個人を特定するものではありません。
            収集されたデータはツール提供会社のプライバシーポリシーに従って管理されます。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            アフィリエイト広告について
          </h2>
          <p>
            当サイトは楽天市場・楽天ブックス等のアフィリエイトプログラムに参加しています。
            これらのサービスによって Cookie が使用され、ユーザーの購買行動に基づいて紹介料が発生する場合があります。
            詳細は各サービスのプライバシーポリシーをご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            第三者への提供
          </h2>
          <p>
            当サイトは、以下のいずれかに該当する場合を除き、ユーザーの個人情報を第三者に提供しません。
          </p>
          <ul className="mt-2 space-y-1 list-disc list-inside text-gray-600">
            <li>ユーザーご本人の同意がある場合</li>
            <li>法令に基づき開示が必要な場合</li>
            <li>人命・身体・財産の保護のために必要な場合</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            個人情報の管理
          </h2>
          <p>
            当サイトは、収集した個人情報の漏洩・紛失・改ざん等を防ぐため、適切な管理に努めます。
            ただし、インターネット上での完全な安全性を保証するものではありません。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            外部リンク先での個人情報取扱い
          </h2>
          <p>
            当サイトからリンクしている外部サイトにおける個人情報の取り扱いについては、当サイトは責任を負いません。
            各外部サイトのプライバシーポリシーをご確認ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            お問い合わせ
          </h2>
          <p>
            個人情報の取り扱いに関するお問い合わせは、<Link href="/contact" className="text-indigo-600 hover:underline">お問い合わせページ</Link>よりご連絡ください。
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            本ポリシーの変更
          </h2>
          <p>
            当サイトは、必要に応じて本プライバシーポリシーを変更することがあります。
            変更後の内容は本ページに掲載した時点で効力を生じるものとします。
          </p>
        </section>

        <p className="text-xs text-gray-400 pt-4 border-t border-gray-100">
          制定日：2026年7月10日
        </p>
      </div>
    </div>
  );
}
