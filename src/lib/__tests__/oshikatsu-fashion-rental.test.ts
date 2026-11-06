import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  FASHION_PURPOSES,
  FASHION_RENTAL_PATH,
  FASHION_SERVICES,
  FASHION_NEEDS_CHECK,
  servicesForPurpose,
} from '@/lib/oshikatsu-services/fashion-rental';
import {
  OSHIKATSU_AD_BLOCKED,
  OSHIKATSU_AFFILIATE_PRESETS,
  OSHIKATSU_CATEGORY_PAGE_PATHS,
  OSHIKATSU_PAGE_SERVICE_KEYS,
} from '@/lib/oshikatsu-affiliate/constants';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const ids = (list: { id: string }[]) => list.map((s) => s.id);
const byId = (id: string) => FASHION_SERVICES.find((s) => s.id === id)!;

describe('掲載データ', () => {
  test('メチャカリ・airCloset の2社', () => {
    expect(ids(FASHION_SERVICES)).toEqual(['mechakari', 'aircloset']);
  });

  test('公式リンク・出典は各社の公式サイトのドメインだけ', () => {
    const domains: Record<string, RegExp> = {
      mechakari: /^https:\/\/mechakari\.com\//,
      aircloset: /^https:\/\/(www|help)\.air-closet\.com\//,
    };
    for (const [id, re] of Object.entries(domains)) {
      const s = byId(id);
      expect(s.officialUrl).toMatch(re);
      for (const src of s.sources) expect(src.url, src.url).toMatch(re);
    }
  });

  test('メチャカリの料金は特定商取引に基づく表記の通常料金（トップページの別表示・キャンペーン価格は載せない）', () => {
    const m = byId('mechakari');
    expect(m.plans.map((p) => [p.name, p.price])).toEqual([
      ['ライトプラン', '3,476円（税込）/月'],
      ['ベーシックプラン', '6,578円（税込）/月'],
      ['プレミアムプラン', '10,978円（税込）/月'],
    ]);
    expect(m.shipping).toContain('返却手数料 418円（税込）/回');
    expect(m.priceNote).toContain('通常料金');
    expect(JSON.stringify(m)).not.toMatch(/5,980|3,160/);
  });

  test('airClosetの料金は1ヵ月コースの正規価格と明記し、旧料金と思われる金額は載せない。配送料は330円・沖縄県990円/配送', () => {
    const a = byId('aircloset');
    expect(a.plans.map((p) => [p.name, p.price])).toEqual([['ライト', '7,980円（税込）/月'], ['レギュラー', '10,980円（税込）/月']]);
    for (const p of a.plans) expect(p.detail).toContain('1ヵ月コースの正規価格');
    expect(a.priceNote).toContain('3・6・12ヵ月コース');
    expect(a.shipping).toContain('330円（税込）/配送（沖縄県は990円）');
    expect(JSON.stringify(a)).not.toMatch(/10,800|7,800/);
  });

  test('airClosetの補償：10%までと断定しない。通常使用の汚れと重大な破損・紛失を分け、規約と適用条件で異なる旨と公式リンクを載せる', () => {
    const a = byId('aircloset');
    expect(JSON.stringify(a)).not.toMatch(/10[%％]まで|最大で|必ず10/);
    expect(a.damage).toContain('通常の使用による汚れ・微細な傷は費用なし');
    expect(a.damage).toContain('紛失・盗難は弁償金');
    expect(a.damage).toContain('規約と適用条件によって異なる');
    expect(a.damageLinks.map((l) => l.url)).toEqual(['https://www.air-closet.com/compensation/', 'https://www.air-closet.com/member-agreement/monthly/']);
    expect(byId('mechakari').damageLinks.map((l) => l.url)).toEqual(['https://mechakari.com/agreement.html']);
  });

  test('契約・解約：自動更新・1か月だけの利用・長期コースの途中解約金・返却期限を載せる（確認できない項目は要確認）', () => {
    const m = byId('mechakari');
    const a = byId('aircloset');
    expect(m.autoRenew).toContain('1か月単位の自動更新');
    expect(a.autoRenew).toContain('自動更新');
    expect(m.oneMonth).toContain('要確認');
    expect(a.oneMonth).toContain('1ヵ月コースあり');
    expect(m.longTerm).toContain('記載はなし');
    expect(a.longTerm).toContain('途中解約金');
    expect(m.returnDeadline).toContain('要確認');
    expect(a.returnDeadline).toContain('7日以内');
    expect(m.sizes).toBe(FASHION_NEEDS_CHECK);
    expect(a.newOrUsed).toContain(FASHION_NEEDS_CHECK);
  });

  test('希望の服・色・サイズが必ず借りられるとは書かない', () => {
    for (const s of FASHION_SERVICES) expect(s.availability).toMatch(/とは限らない|約束する記載はなく/);
  });

  test('推し色・ブランド・サイズ・在庫を保証する表現、料金の優劣を断定する表現を使わない', () => {
    const files = ['src/lib/oshikatsu-services/fashion-rental.ts', 'src/components/oshikatsu/FashionExplorer.tsx', 'src/app/oshikatsu/fashion-rental/page.tsx', 'src/components/oshikatsu/FashionEntryCta.tsx'];
    for (const f of files) {
      const src = read(f).replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/必ず借り|必ず届|在庫あり|確実に借|最安|一番安|業界最安|お得|格安|本人着用|着用モデル/);
    }
    // 推し色などが借りられるとは限らないことをページで明記している
    expect(read('src/app/oshikatsu/fashion-rental/page.tsx')).toContain('推し色の服・特定のブランド・サイズが借りられるとは限りません');
  });

  test('ライブ参戦服だけでなく普段使いにも使えるサービスとして紹介する', () => {
    const page = read('src/app/oshikatsu/fashion-rental/page.tsx');
    expect(page).toContain('ライブにも普段にも');
    expect(page).toContain('普段の服として着回せます');
  });
});

describe('読みやすさ・公式サイトへの導線', () => {
  test('PCでは本文幅を1080pxまで広げる（カードの2列は900px以上）', () => {
    expect(read('src/app/oshikatsu/fashion-rental/page.tsx')).toContain('max-w-[1080px]');
    expect(read('src/app/oshikatsu/fashion-rental/fashion-rental.css')).toMatch(/@media \(min-width: 900px\) \{\s*\.fr-page \.gm-cards \{ grid-template-columns: 1fr 1fr;/);
  });

  test('料金プランの直後と下部の両方に「〇〇の公式サイトで確認する」。広告があるときは上は「PRリンクを見る」（ページ内リンク・広告タグは1か所だけ）', () => {
    const ex = read('src/components/oshikatsu/FashionExplorer.tsx');
    expect(ex.match(/の公式サイトで確認する/g)?.length).toBe(2); // 下部（通常リンク）・上部（通常リンク）
    expect(ex).toContain('>PRリンクを見る ↓</a>');
    expect(ex.match(/<OshikatsuAdTag/g)).toHaveLength(1);
    expect(ex).toContain('placement="card_plan"');
    expect(ex).toContain('href={`#fr-${s.id}-cta`}');
    // 公式URLは掲載データ（officialUrl）をそのまま使う
    expect(ex).not.toMatch(/href="https?:\/\//);
  });

  test('注意したい条件・追加費用の概要は常に表示し、詳しい条件は開閉できる（details/summary）', () => {
    const ex = read('src/components/oshikatsu/FashionExplorer.tsx');
    const card = ex.slice(ex.indexOf('function ServiceCard'), ex.indexOf('export default function FashionExplorer'));
    const firstDetails = card.indexOf('<details');
    expect(card.indexOf('s.cautionSummary')).toBeGreaterThan(0);
    expect(card.indexOf('s.cautionSummary')).toBeLessThan(firstDetails);
    expect(card.indexOf('s.availability')).toBeLessThan(firstDetails);
    for (const k of ['s.autoRenew', 's.longTerm', 's.returnDeadline', 's.damage', 's.damageLinks']) expect(card.indexOf(k), k).toBeGreaterThan(firstDetails);
    expect(card.match(/<details/g)).toHaveLength(3);
    for (const s of FASHION_SERVICES) expect(s.cautionSummary.length).toBeGreaterThanOrEqual(4);
    // 概要は既存の内容の言い換え（主要な金額が元の項目と一致）
    expect(byId('mechakari').cautionSummary.join()).toContain('418円');
    expect(byId('aircloset').cautionSummary.join()).toContain('330円');
    expect(byId('aircloset').cautionSummary.join()).toContain('途中解約金');
  });
});

describe('目的別の絞り込み', () => {
  test('5つの目的。公式サイトに記載がある（一部を含む）サービスだけ', () => {
    expect(FASHION_PURPOSES.map((p) => p.id)).toEqual(['self_select', 'stylist', 'new_items', 'buy_later', 'no_deadline']);
    expect(ids(servicesForPurpose('self_select'))).toEqual(['mechakari', 'aircloset']);
    expect(byId('aircloset').purposes.self_select?.fit).toBe('partial');
    expect(ids(servicesForPurpose('stylist'))).toEqual(['aircloset']);
    expect(ids(servicesForPurpose('new_items'))).toEqual(['mechakari']);
    expect(ids(servicesForPurpose('buy_later'))).toEqual(['mechakari', 'aircloset']);
    expect(ids(servicesForPurpose(''))).toEqual(['mechakari', 'aircloset']);
  });
});

describe('アフィリエイト管理', () => {
  test('ジャンル「ファッションレンタル」の掲載先と2社。初期は A8.net・未申請・広告OFF で登録（広告URL・成果条件は持たない）', () => {
    expect(OSHIKATSU_CATEGORY_PAGE_PATHS.fashion_rental).toBe(FASHION_RENTAL_PATH);
    expect([...(OSHIKATSU_PAGE_SERVICE_KEYS.fashion_rental ?? [])]).toEqual(ids(FASHION_SERVICES));
    const presets = OSHIKATSU_AFFILIATE_PRESETS.filter((p) => p.category === 'fashion_rental');
    expect(presets.map((p) => [p.serviceKey, p.aspId, p.partnershipStatus])).toEqual([
      ['mechakari', 'a8', 'not_applied'],
      ['aircloset', 'a8', 'not_applied'],
    ]);
    expect(JSON.stringify(presets)).not.toMatch(/a8\.net|a8mat|isAdEnabled":true/);
    // 推しトク・駿河屋の広告停止はそのまま
    expect(Object.keys(OSHIKATSU_AD_BLOCKED).sort()).toEqual(['oshitoku', 'surugaya']);
  });

  test('既存の初期案件（グッズ制作・グッズ買取）は変更しない', () => {
    expect(OSHIKATSU_AFFILIATE_PRESETS.filter((p) => p.category !== 'fashion_rental').map((p) => [p.serviceKey, p.partnershipStatus, p.aspId])).toEqual([
      ['cherish_palette', 'approved', 'a8'],
      ['shimauma_plus', 'pending', 'a8'],
      ['kaitori_ouji', 'not_applied', 'none'],
      ['justy', 'pending', 'a8'],
      ['oshitoku', 'not_applied', 'none'],
      ['surugaya', 'not_applied', 'none'],
    ]);
  });
});

describe('人物・グループページとの連動', () => {
  test('グループページ：過去のライブ映像コーナーの下・関連商品の前。グッズ買取の案内の位置は変えない', () => {
    const src = read('src/app/groups/[groupSlug]/page.tsx');
    const live = src.indexOf('━━━ 5.5 過去のライブ映像を探す');
    const fashion = src.indexOf('<FashionEntryCta placement="group_page" />');
    const products = src.indexOf('━━━ 6. 関連商品 ━━━');
    const buyback = src.indexOf('<BuybackEntryCta groupNames={[groupName]} placement="group_page" />');
    const related = src.indexOf('━━━ 7. 関連グループ ━━━');
    expect(fashion).toBeGreaterThan(live);
    expect(products).toBeGreaterThan(fashion);
    expect(buyback).toBeGreaterThan(products);
    expect(related).toBeGreaterThan(buyback);
  });

  test('人物ページ：関連商品・グッズ買取の案内の下、出演作品の前', () => {
    const src = read('src/app/person/[slug]/page.tsx');
    const products = src.indexOf('<section id="products"');
    const buyback = src.indexOf('<BuybackEntryCta');
    const fashion = src.indexOf('<FashionEntryCta placement="person_page" />');
    const works = src.indexOf('━━━ 出演作品 ━━━');
    expect(buyback).toBeGreaterThan(products);
    expect(fashion).toBeGreaterThan(buyback);
    expect(works).toBeGreaterThan(fashion);
  });

  test('案内はサイト内リンクだけ（広告・外部リンク・人物の画像や情報を使わない）。<aside> で描画', () => {
    const src = read('src/components/oshikatsu/FashionEntryCta.tsx');
    expect(src).toContain('<aside');
    expect(src).toContain('categoryId="fashion_rental"');
    expect(src).not.toMatch(/OshikatsuAdTag|ServiceOutboundLink|<img|https?:\/\/|personName|groupNames/);
  });
});

describe('GA4・サイトマップ', () => {
  test('絞り込みは oshikatsu_fashion_filter、外部リンクは既存の oshikatsu_service_click（fashion_rental）。通常リンクでは affiliate_click を送らない', () => {
    const ex = read('src/components/oshikatsu/FashionExplorer.tsx');
    expect(ex).toContain("sendGaEvent('oshikatsu_fashion_filter'");
    expect(ex).toContain("const CATEGORY = 'fashion_rental'");
    expect(ex).toContain('isAffiliate={false}');
  });

  test('サイトマップに比較ページ（絞り込みURLは含めない）', () => {
    const sm = read('src/app/sitemap.ts');
    expect(sm).toContain('${BASE_URL}/oshikatsu/fashion-rental`');
    expect(sm).not.toContain('fashion-rental?');
  });
});
