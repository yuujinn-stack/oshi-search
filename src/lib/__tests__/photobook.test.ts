import { describe, it, expect } from 'vitest';
import {
  hasPhotobookPositiveSignal,
  hasPhotobookExcludeSignal,
  isAutoDetectedPhotobook,
  normalizePhotobookTitle,
  computeDedupKey,
  selectRepresentative,
  resolvePersonGender,
  resolveGenreBucket,
  genreBucketOrder,
  distributeAvoidingConsecutivePerson,
} from '../photobook';

describe('hasPhotobookPositiveSignal', () => {
  it('「写真集」を含むタイトルはtrue', () => {
    expect(hasPhotobookPositiveSignal('賀喜遥香 1st写真集 感情の隙間')).toBe(true);
  });
  it('フォトブック・PHOTO BOOK・photobook表記もtrue', () => {
    expect(hasPhotobookPositiveSignal('◯◯ フォトブック')).toBe(true);
    expect(hasPhotobookPositiveSignal('XX PHOTO BOOK')).toBe(true);
    expect(hasPhotobookPositiveSignal('xx photobook 2024')).toBe(true);
  });
  it('単に「写真」だけでは判定しない', () => {
    expect(hasPhotobookPositiveSignal('◯◯ 生写真セット')).toBe(false);
    expect(hasPhotobookPositiveSignal('◯◯ 写真展示会パンフレット')).toBe(false);
  });
});

describe('hasPhotobookExcludeSignal', () => {
  it('カレンダー・ポスター・生写真・ブロマイド等を検出する', () => {
    expect(hasPhotobookExcludeSignal('◯◯ カレンダー 2025')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ ポスター付き')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 生写真 10枚セット')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ ブロマイド')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ トレーディングカード')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ アクリルスタンド')).toBe(true);
  });
  it('DVD/Blu-ray/CD/雑誌/グッズを検出する', () => {
    expect(hasPhotobookExcludeSignal('◯◯ DVD付き写真集')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ Blu-ray')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 雑誌9月号')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 公式グッズ')).toBe(true);
  });
  it('該当しないタイトルはfalse', () => {
    expect(hasPhotobookExcludeSignal('◯◯ 1st写真集 感情の隙間')).toBe(false);
  });

  // 実データ確認(2026)で発覚した回帰: 「是非に及ばず（初回仕様限定盤 CD＋Blu-ray Type-A）」
  // のようなCD/Blu-ray音楽商品がスキャン対象カテゴリ(CD)に含まれており、除外語ハードニングを行った。
  it('CD/Blu-rayの版・形態を表す語（初回仕様限定盤/通常盤/Type-A等）を検出する', () => {
    expect(hasPhotobookExcludeSignal('是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-A)')).toBe(true);
    expect(hasPhotobookExcludeSignal('是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-B)')).toBe(true);
    expect(hasPhotobookExcludeSignal('是非に及ばず (初回仕様限定盤A＋B＋C＋Dセット)')).toBe(true);
    expect(hasPhotobookExcludeSignal('是非に及ばず (通常盤)')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 完全生産限定盤')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 期間生産限定盤')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ 1stシングル')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ ベストアルバム')).toBe(true);
  });
  it('大文字小文字が異なるTYPE-A表記も検出する', () => {
    expect(hasPhotobookExcludeSignal('◯◯ (TYPE-A)')).toBe(true);
    expect(hasPhotobookExcludeSignal('◯◯ (type-a)')).toBe(true);
  });
  it('「通常盤」(CD)と「通常版」(書籍の版違いを表す語)は別物として扱う', () => {
    // 通常版(版)は誤統合防止のテストで確認済みの版表記であり、除外対象ではない
    expect(hasPhotobookExcludeSignal('◯◯ 1st写真集 通常版')).toBe(false);
  });
});

describe('isAutoDetectedPhotobook', () => {
  it('肯定シグナルのみで除外語なし・中古でない → true', () => {
    expect(isAutoDetectedPhotobook({ title: '賀喜遥香 1st写真集 感情の隙間' })).toBe(true);
  });
  it('肯定シグナルなし → false', () => {
    expect(isAutoDetectedPhotobook({ title: '賀喜遥香 CD アルバム' })).toBe(false);
  });
  it('肯定シグナルがあっても除外語(カレンダー)を含む → false', () => {
    expect(isAutoDetectedPhotobook({ title: '賀喜遥香 写真集 & カレンダー セット' })).toBe(false);
  });
  it('中古品は自動判定対象から除外する', () => {
    expect(isAutoDetectedPhotobook({ title: '賀喜遥香 1st写真集', isUsed: true })).toBe(false);
  });

  // 本番確認(2026)で発覚した実際の誤判定商品（一ノ瀬美空 / CD カテゴリ）の回帰テスト。
  // いずれも「写真集」等の肯定シグナルを一切含まないため、そもそも肯定シグナル不一致で
  // falseになる（除外語チェックを待たずに弾かれる）ことを確認する。
  it('実際に誤判定されたCD/Blu-ray商品(一ノ瀬美空「是非に及ばず」)はfalseになる', () => {
    expect(isAutoDetectedPhotobook({
      title: '【楽天ブックス限定先着特典】是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-A)(ポストカード(通常盤))',
    })).toBe(false);
    expect(isAutoDetectedPhotobook({
      title: '是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-B)',
    })).toBe(false);
    expect(isAutoDetectedPhotobook({
      title: '是非に及ばず (初回仕様限定盤A＋B＋C＋Dセット) (特典なし)',
    })).toBe(false);
  });
  it('主商品が写真集で、CD等の除外語を含まない場合はtrueのまま維持する（誤除外防止）', () => {
    expect(isAutoDetectedPhotobook({ title: '◯◯ ファースト写真集「タイトル」' })).toBe(true);
  });
});

describe('normalizePhotobookTitle', () => {
  it('全角半角・大文字小文字・空白の揺れを吸収する', () => {
    expect(normalizePhotobookTitle('ＡＢＣ 写真集')).toBe(normalizePhotobookTitle('ABC写真集'));
  });
  it('送料無料・特典付き・【】装飾等のショップ文言を除去する', () => {
    const a = normalizePhotobookTitle('【送料無料】賀喜遥香 1st写真集 感情の隙間');
    const b = normalizePhotobookTitle('賀喜遥香 1st写真集 感情の隙間 特典付き');
    expect(a).toBe(b);
  });
  it('通常版・限定版など版を表す語は除去しない（誤統合防止）', () => {
    const normal = normalizePhotobookTitle('◯◯ 1st写真集 通常版');
    const limited = normalizePhotobookTitle('◯◯ 1st写真集 限定版');
    expect(normal).not.toBe(limited);
  });

  // 実データ確認(2026)で発覚した回帰: 【】ブラケットの中身を一律除去すると、
  // 「【楽天ブックス限定カバー＋限定特典付き】○○1st写真集」と「○○1st写真集」(無印)が
  // 同一キーに統合されてしまい、表紙違いの可能性がある商品を誤って1件に統合していた。
  it('【】内に「限定カバー」等の表紙情報がある場合、無印タイトルとは異なるキーになる（誤統合防止）', () => {
    const limitedCover = normalizePhotobookTitle('【楽天ブックス限定カバー＋限定特典付き】中田花奈1st写真集 好きなことだけをしていたい');
    const plain = normalizePhotobookTitle('中田花奈1st写真集 好きなことだけをしていたい');
    expect(limitedCover).not.toBe(plain);
  });
  it('【T限定】等の店舗限定表記がある場合も無印タイトルとは異なるキーになる（誤統合防止）', () => {
    const tLimited = normalizePhotobookTitle('【T限定】丹生明里1st写真集『やさしい関係』');
    const plain = normalizePhotobookTitle('丹生明里1st写真集『やさしい関係』');
    expect(tLimited).not.toBe(plain);
  });
  it('除去語のみで中身が空になったブラケットは残さない', () => {
    const a = normalizePhotobookTitle('【送料無料】賀喜遥香 1st写真集');
    const b = normalizePhotobookTitle('賀喜遥香 1st写真集');
    expect(a).toBe(b);
  });
});

describe('computeDedupKey', () => {
  it('同一人物・同一タイトル(表記揺れのみ)は同じキーになる', () => {
    const k1 = computeDedupKey('賀喜遥香', '【送料無料】賀喜遥香 1st写真集 感情の隙間');
    const k2 = computeDedupKey('賀喜遥香', '賀喜遥香 1st写真集 感情の隙間');
    expect(k1).toBe(k2);
  });
  it('人物が異なれば同じタイトルでもキーが異なる', () => {
    const k1 = computeDedupKey('人物A', '1st写真集');
    const k2 = computeDedupKey('人物B', '1st写真集');
    expect(k1).not.toBe(k2);
  });
  it('通常版と限定版は別キーになる（表紙違いを誤って統合しない）', () => {
    const k1 = computeDedupKey('◯◯', '1st写真集 通常版');
    const k2 = computeDedupKey('◯◯', '1st写真集 限定版');
    expect(k1).not.toBe(k2);
  });
});

describe('selectRepresentative', () => {
  it('画像ありを画像なしより優先する', () => {
    const items = [
      { id: 'a', imageUrl: '', itemUrl: 'https://x/a', affiliateUrl: '', price: 1000 },
      { id: 'b', imageUrl: 'https://img/b.jpg', itemUrl: 'https://x/b', affiliateUrl: '', price: 1000 },
    ];
    expect(selectRepresentative(items).id).toBe('b');
  });
  it('画像・URLとも同条件なら価格が安い方を優先する', () => {
    const items = [
      { id: 'a', imageUrl: 'https://img/a.jpg', itemUrl: 'https://x/a', affiliateUrl: '', price: 2000 },
      { id: 'b', imageUrl: 'https://img/b.jpg', itemUrl: 'https://x/b', affiliateUrl: '', price: 1500 },
    ];
    expect(selectRepresentative(items).id).toBe('b');
  });
  it('価格0件(未取得)より価格ありを優先する', () => {
    const items = [
      { id: 'a', imageUrl: 'https://img/a.jpg', itemUrl: 'https://x/a', affiliateUrl: '', price: 0 },
      { id: 'b', imageUrl: 'https://img/b.jpg', itemUrl: 'https://x/b', affiliateUrl: '', price: 1500 },
    ];
    expect(selectRepresentative(items).id).toBe('b');
  });
  it('1件のみの場合はそれを返す', () => {
    const items = [{ id: 'a', imageUrl: '', itemUrl: '', affiliateUrl: '', price: 0 }];
    expect(selectRepresentative(items).id).toBe('a');
  });
});

describe('resolvePersonGender', () => {
  it('個人設定が最優先される', () => {
    expect(resolvePersonGender('male', 'female')).toBe('male');
  });
  it('個人未設定ならグループ設定を使う', () => {
    expect(resolvePersonGender(null, 'female')).toBe('female');
    expect(resolvePersonGender(undefined, 'male')).toBe('male');
  });
  it('どちらも未設定ならnull(未分類)', () => {
    expect(resolvePersonGender(null, null)).toBeNull();
    expect(resolvePersonGender(undefined, undefined)).toBeNull();
  });
  it('不正な値(想定外文字列)は無視してnull扱いにする', () => {
    expect(resolvePersonGender('unknown', undefined)).toBeNull();
  });
});

describe('resolveGenreBucket', () => {
  it('女性: 女優 > アイドル(坂道含む) > その他', () => {
    expect(resolveGenreBucket('female', ['女優'])).toBe('女優');
    expect(resolveGenreBucket('female', ['アイドル'])).toBe('アイドル');
    expect(resolveGenreBucket('female', ['坂道'])).toBe('アイドル');
    expect(resolveGenreBucket('female', ['歌手'])).toBe('その他');
  });
  it('男性: 俳優 > アイドル > その他', () => {
    expect(resolveGenreBucket('male', ['俳優'])).toBe('俳優');
    expect(resolveGenreBucket('male', ['アイドル'])).toBe('アイドル');
    expect(resolveGenreBucket('male', ['歌手'])).toBe('その他');
  });
  it('性別未分類はその他固定', () => {
    expect(resolveGenreBucket(null, ['女優'])).toBe('その他');
  });
  it('特定人物名のハードコードなし・ジャンル値だけで判定する', () => {
    expect(resolveGenreBucket('female', [])).toBe('その他');
  });
});

describe('genreBucketOrder', () => {
  it('女性は女優が最優先、男性は俳優が最優先', () => {
    expect(genreBucketOrder('female', '女優')).toBeLessThan(genreBucketOrder('female', 'アイドル'));
    expect(genreBucketOrder('male', '俳優')).toBeLessThan(genreBucketOrder('male', 'アイドル'));
  });
});

describe('distributeAvoidingConsecutivePerson', () => {
  it('同一人物の連続を避けてラウンドロビンで分散する', () => {
    const items = [
      { personName: 'A', id: 1 }, { personName: 'A', id: 2 }, { personName: 'A', id: 3 },
      { personName: 'B', id: 4 },
      { personName: 'C', id: 5 },
    ];
    const result = distributeAvoidingConsecutivePerson(items);
    expect(result.map((r) => r.personName)).toEqual(['A', 'B', 'C', 'A', 'A']);
  });
  it('全件保持する（件数が変わらない）', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ personName: `P${i % 3}`, id: i }));
    expect(distributeAvoidingConsecutivePerson(items)).toHaveLength(7);
  });
  it('空配列は空配列を返す', () => {
    expect(distributeAvoidingConsecutivePerson([])).toEqual([]);
  });
});
