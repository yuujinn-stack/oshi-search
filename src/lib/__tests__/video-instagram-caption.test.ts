import { describe, expect, it } from 'vitest';
import { captionGroupName, getInstagramCaption, toHashtag } from '@/lib/video-instagram-caption';

// 管理画面の人物選択データ（活動状態つき）。卒業済みでもグループ名が登録されている
const yamashita = { name: '山下美月', group: '乃木坂46', activityStatus: 'graduated' };

describe('getInstagramCaption（推し活お買い物診断 ショートV1）', () => {
  it('人物名とグループ名だけを差し込む', () => {
    const t = getInstagramCaption('oshi-shopping-intro-v1', { name: '目黒蓮', groupName: 'Snow Man' })!;
    expect(t).toContain('今回は目黒蓮さんで診断してみました。');
    expect(t.split('\n').at(-1)).toBe('#推し活 #推し活グッズ #推しサーチ #目黒蓮 #SnowMan');
    expect(t.startsWith('推し活グッズ、結局どれ買えばいい？🤔\n\nそんなときに使える\n「推し活お買い物診断」を作りました✨')).toBe(true);
    expect(t).not.toContain('松村北斗');
  });

  it('別の人物では人物名・グループ名だけが変わる', () => {
    const a = getInstagramCaption('oshi-shopping-intro-v1', { name: '目黒蓮', groupName: 'Snow Man' })!;
    const b = getInstagramCaption('oshi-shopping-intro-v1', { name: '松村北斗', groupName: 'SixTONES' })!;
    expect(b).toContain('今回は松村北斗さんで診断してみました。');
    expect(b.split('\n').at(-1)).toBe('#推し活 #推し活グッズ #推しサーチ #松村北斗 #SixTONES');
    expect(a.replace(/目黒蓮/g, 'X').replace('#SnowMan', '#G')).toBe(b.replace(/松村北斗/g, 'X').replace('#SixTONES', '#G'));
  });

  it('卒業した人物もグループのタグを付ける（山下美月 → #乃木坂46）', () => {
    const t = getInstagramCaption('oshi-shopping-intro-v1', { name: '山下美月', groupName: captionGroupName(yamashita) })!;
    expect(t).toContain('今回は山下美月さんで診断してみました。');
    expect(t.split('\n').at(-1)).toBe('#推し活 #推し活グッズ #推しサーチ #山下美月 #乃木坂46');
  });

  it('グループが無い人物はグループのタグを付けない', () => {
    const t = getInstagramCaption('oshi-shopping-intro-v1', { name: '浜辺美波', groupName: null })!;
    expect(t.split('\n').at(-1)).toBe('#推し活 #推し活グッズ #推しサーチ #浜辺美波');
  });

  it('記号を含む名前はタグにしない（記号を消して別の名前にしない）', () => {
    const t = getInstagramCaption('oshi-shopping-intro-v1', { name: '佐野晶哉', groupName: 'Aぇ! group' })!;
    expect(t.split('\n').at(-1)).toBe('#推し活 #推し活グッズ #推しサーチ #佐野晶哉');
    expect(toHashtag('＝LOVE')).toBeNull();
    expect(toHashtag('M!LK')).toBeNull();
    expect(toHashtag('乃木坂46')).toBe('#乃木坂46');
    expect(toHashtag('Travis Japan')).toBe('#TravisJapan');
  });

  it('投稿文が未設定のテンプレートは null', () => {
    expect(getInstagramCaption('oshi-first3-v1', { name: '目黒蓮', groupName: 'Snow Man' })).toBeNull();
  });
});

describe('captionGroupName', () => {
  it('改名後の現グループ名を優先し、卒業・脱退済みでも登録があれば使う', () => {
    expect(captionGroupName({ group: '欅坂46', currentGroupName: '櫻坂46' })).toBe('櫻坂46');
    expect(captionGroupName({ group: 'Snow Man' })).toBe('Snow Man');
    expect(captionGroupName(yamashita)).toBe('乃木坂46');
    expect(captionGroupName({ group: '' })).toBeNull();
    expect(captionGroupName(undefined)).toBeNull();
  });
});

describe('getInstagramCaption（推しサーチ紹介 グループ推し・このサイトまだ知らないの？ OSHI_GROUP_09）', () => {
  const group = (name: string) => getInstagramCaption('OSHI_GROUP_09', { name, groupName: null, kind: 'group' })!;

  it('Number_i: 冒頭フック → 紹介文 → CTA → ハッシュタグ（指定の文面どおり）', () => {
    expect(group('Number_i')).toBe(
      [
        'Number_iを推してる人、このサイトまだ知らないの？',
        '',
        '推しサーチなら、Number_iの',
        '✅ メンバーの情報・出演作品をまとめて検索',
        '✅ ドラマ・映画などの配信先をチェック',
        '✅ 写真集・CD・関連グッズを探せる',
        '✅ 推しに合うサブスクを診断できる',
        '',
        '推し活に役立つ情報をまとめてチェックできます🔍',
        '',
        'プロフィールのリンクからチェック🔗',
        '',
        '#推し活 #推しサーチ #Number_i',
      ].join('\n'),
    );
  });

  it('Snow Man: グループ名とタグだけが変わる（空白はタグで詰める）', () => {
    const t = group('Snow Man');
    expect(t.startsWith('Snow Manを推してる人、このサイトまだ知らないの？\n\n推しサーチなら、Snow Manの\n')).toBe(true);
    expect(t.split('\n').at(-1)).toBe('#推し活 #推しサーチ #SnowMan');
    expect(t.replace(/Snow Man/g, 'G').replace('#SnowMan', '#G')).toBe(group('Number_i').replace(/Number_i/g, 'G'));
  });

  it('料金の注記・URLを入れない', () => {
    for (const t of [group('Number_i'), getInstagramCaption('OSHI_GROUP_09', { name: '目黒蓮', groupName: 'Snow Man', kind: 'person' })!]) {
      expect(t).not.toMatch(/料金|無料|※|https?:|oshi-search\.jp/);
    }
  });

  it('記号を含むグループ名はタグにしない（M!LK）', () => {
    const t = group('M!LK');
    expect(t.startsWith('M!LKを推してる人、このサイトまだ知らないの？')).toBe(true);
    expect(t.split('\n').at(-1)).toBe('#推し活 #推しサーチ');
  });

  it('人物（目黒蓮）: 人物向けの文（メンバー・CD・ライブ映像を言わない）と人物・所属グループのタグ', () => {
    const t = getInstagramCaption('OSHI_GROUP_09', { name: '目黒蓮', groupName: 'Snow Man', kind: 'person' })!;
    expect(t).toBe(
      [
        '目黒蓮を推してる人、このサイトまだ知らないの？',
        '',
        '推しサーチなら、目黒蓮の',
        '✅ 出演作品をまとめて検索',
        '✅ ドラマ・映画などの配信先をチェック',
        '✅ 写真集・関連グッズを探せる',
        '✅ 推しに合うサブスクを診断できる',
        '',
        '推し活に役立つ情報をまとめてチェックできます🔍',
        '',
        'プロフィールのリンクからチェック🔗',
        '',
        '#推し活 #推しサーチ #目黒蓮 #SnowMan',
      ].join('\n'),
    );
    expect(t).not.toMatch(/メンバー|CD|ライブ映像/);
  });

  it('ほかのテンプレート（一般版・別のグループ版・ブラックフライデー・サイト誘導）には適用しない', () => {
    for (const id of ['OSHI_GENERAL_09', 'OSHI_GROUP_05', 'OSHI_GROUP_10', 'site_bf_goods', 'site_bf_live', 'site_bf_shopping', 'site_person_search', 'oshi-first3-v1']) {
      expect(getInstagramCaption(id, { name: 'Number_i', groupName: null, kind: 'group' })).toBeNull();
    }
    // 既存の投稿文は kind を渡しても変わらない
    expect(getInstagramCaption('oshi-sonkamo-v1', { name: '目黒蓮', groupName: 'Snow Man', kind: 'person' })).toBe(
      getInstagramCaption('oshi-sonkamo-v1', { name: '目黒蓮', groupName: 'Snow Man' }),
    );
  });
});
