import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'お問い合わせ',
  description:
    '推しサーチへの掲載情報修正、不具合、権利関係などのお問い合わせについてご案内します。',
};

// お問い合わせ先設定
// 公開前にメールアドレスまたはフォームURLを設定してください。
// 未設定（null）の場合は「準備中」として表示されます。
const CONTACT_CONFIG = {
  email: null as string | null,        // 例: 'contact@oshi-search.jp'
  formUrl: null as string | null,      // 例: Googleフォームや外部フォームのURL
};

export default function ContactPage() {
  const hasContact = CONTACT_CONFIG.email || CONTACT_CONFIG.formUrl;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      {/* パンくず */}
      <nav className="text-xs text-gray-400 mb-8 flex items-center gap-1.5">
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>お問い合わせ</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-800 mb-8">お問い合わせ</h1>

      <div className="space-y-8 text-sm text-gray-700 leading-relaxed">

        {/* お問い合わせ先 */}
        <section className="rounded-xl border border-gray-200 p-5 bg-gray-50">
          {hasContact ? (
            <div className="space-y-3">
              <p className="font-semibold text-gray-800">お問い合わせ窓口</p>
              {CONTACT_CONFIG.email && (
                <p>
                  メール：
                  <a
                    href={`mailto:${CONTACT_CONFIG.email}`}
                    className="text-indigo-600 hover:underline ml-1"
                  >
                    {CONTACT_CONFIG.email}
                  </a>
                </p>
              )}
              {CONTACT_CONFIG.formUrl && (
                <p>
                  <a
                    href={CONTACT_CONFIG.formUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    お問い合わせフォームはこちら →
                  </a>
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="font-semibold text-gray-800 mb-1">お問い合わせ窓口</p>
              <p className="text-gray-500">
                お問い合わせ窓口は現在準備中です。公開前に設定予定です。
              </p>
            </div>
          )}
        </section>

        {/* お問い合わせ内容 */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            こんなお問い合わせをお受けしています
          </h2>
          <ul className="space-y-2 list-disc list-inside text-gray-600">
            <li>掲載している人物情報・作品情報の誤り</li>
            <li>配信状況・ストリーミングサービス情報の修正依頼</li>
            <li>商品情報の修正・削除依頼</li>
            <li>権利者・関係者からのご連絡</li>
            <li>サイトの不具合・表示の問題</li>
            <li>その他、サイトに関するご意見・ご要望</li>
          </ul>
        </section>

        {/* 連絡時のお願い */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            お問い合わせの際にお知らせください
          </h2>
          <ul className="space-y-2 list-disc list-inside text-gray-600">
            <li>該当ページのURL</li>
            <li>修正・確認したい内容（具体的に）</li>
            <li>参考となる公式URL（あれば）</li>
            <li>お名前またはご担当者名</li>
            <li>返信が必要な場合は返信先のご連絡先</li>
          </ul>
          <p className="mt-3 text-gray-500 text-xs">
            ※ いただいた情報はお問い合わせへの対応以外には使用しません。
          </p>
        </section>

        {/* 権利者向け */}
        <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
          <h2 className="text-base font-bold text-gray-800 mb-2">
            権利者・関係者の方へ
          </h2>
          <p className="text-gray-700">
            掲載内容の修正、削除、権利に関するご連絡は、確認後できる限り速やかに対応します。
            お問い合わせの際は、権利の内容・該当箇所・対応のご希望を明記してください。
          </p>
        </section>

        {/* 対応について */}
        <section>
          <h2 className="text-base font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">
            対応について
          </h2>
          <p>
            お問い合わせへの回答は、内容を確認した上で順次対応します。
            内容によってはお時間をいただく場合があります。また、すべてのお問い合わせに個別回答をお約束するものではありません。
          </p>
        </section>

      </div>
    </div>
  );
}
