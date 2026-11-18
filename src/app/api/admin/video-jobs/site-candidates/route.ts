import { NextResponse, type NextRequest } from 'next/server';
import { maskSecrets } from '@/lib/mask-secrets';
import { isSiteTemplateId } from '@/lib/video-site-reel';
import { parseOshiSiteInput, TemplateInputError } from '@/lib/video-template-input';
import { VideoJobError } from '@/server/video-jobs/job-store';
import {
  SITE_SHOPPING_OPTIONS,
  loadGroupShownMembers,
  loadSiteCastWorks,
  loadSitePhotobookPersons,
  loadSiteProviderPersons,
  loadSiteProviders,
  loadSaleLiveCandidates,
  loadSaleVideoStatus,
  resolveSiteTarget,
} from '@/server/video-jobs/site-target';

export const dynamic = 'force-dynamic';

/**
 * 動画「サイト誘導リール」: 管理画面の選択肢（読み取りのみ）。
 *   kind=groupMembers&name=  グループページのメンバー欄に表示されるメンバー（人数の照合に使う）
 *   kind=castWorks&name=     人物の公開作品のうち、推しサーチに出演者が2人以上登録された作品
 *   kind=photobookPersons    写真集の一覧に掲載中の写真集がある人物
 *   kind=providers / kind=providerPersons&provider=  トップページの配信サービス・サービスのページの人物
 *   kind=shoppingOptions     お買い物診断の用途・予算（サイトの選択肢）
 *   kind=cardWorks&name=     推し布教カードで選べる作品
 *   kind=saleStatus          期間限定セールのリール: いま使うセール（開催前・開催中。無ければ sale=null）
 *   kind=saleLive            期間限定セールのリール A・B: 過去のライブ映像のコーナーがあるグループと、その現在のメンバー
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const name = q.get('name')?.trim() ?? '';
  try {
    switch (q.get('kind')) {
      case 'groupMembers': {
        const g = await loadGroupShownMembers(name);
        return g ? NextResponse.json(g) : NextResponse.json({ error: `公開中のグループではありません: ${name}` }, { status: 404 });
      }
      case 'castWorks':
        return NextResponse.json({ works: await loadSiteCastWorks(name) });
      case 'photobookPersons':
        return NextResponse.json({ persons: await loadSitePhotobookPersons() });
      case 'providers':
        return NextResponse.json({ providers: await loadSiteProviders() });
      case 'providerPersons':
        return NextResponse.json({ persons: await loadSiteProviderPersons(q.get('provider') ?? '') });
      case 'shoppingOptions':
        return NextResponse.json(SITE_SHOPPING_OPTIONS);
      case 'cardWorks': {
        const { loadOshiCardPerson } = await import('@/lib/oshi-card/data');
        const p = await loadOshiCardPerson(name);
        return NextResponse.json({ works: p ? p.candidates.map((w) => ({ id: w.id, title: w.title, year: w.year ?? null })) : [] });
      }
      case 'saleStatus':
        return NextResponse.json({ sale: loadSaleVideoStatus() });
      case 'saleLive':
        return NextResponse.json(await loadSaleLiveCandidates());
      default:
        return NextResponse.json({ error: '不正な指定です' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}

/** 選んだ対象をDBで確かめ、撮影するページの正式なパスを付けて返す（台本の生成に使う。ジョブ作成時もサーバーで同じ処理をする） */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { templateId?: unknown; siteSelection?: unknown };
  try {
    if (!isSiteTemplateId(body.templateId)) return NextResponse.json({ error: 'サイト誘導リールのテンプレートではありません' }, { status: 400 });
    const input = parseOshiSiteInput({ version: 1, siteSelection: body.siteSelection, lines: [{ id: '01-hook', text: '-', kana: '-' }, { id: '02-x', text: '-', kana: '-' }, { id: '03-cta', text: '-', kana: '-' }] });
    return NextResponse.json({ target: await resolveSiteTarget(body.templateId, input.siteSelection) });
  } catch (err) {
    if (err instanceof TemplateInputError || err instanceof VideoJobError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: maskSecrets(String(err instanceof Error ? err.message : err)) }, { status: 500 });
  }
}
