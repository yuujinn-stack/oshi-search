import { redirect } from 'next/navigation';
import { H_TEMPLATE_ID } from '@/lib/instagram-templates';

/**
 * H「観るもの・買うもの、まとめて」は既存のInstagram予約画面のテンプレートの1つとして使う。
 * 以前のH専用画面のURLは、Hを選択済みの予約画面へ転送する。
 */
export default function InstagramHRedirectPage() {
  redirect(`/admin/instagram-schedule?template=${H_TEMPLATE_ID}`);
}
