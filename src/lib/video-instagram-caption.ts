// 動画生成（/admin/video-maker）の完了ジョブに表示する「Instagram投稿文」。テンプレートIDごとに投稿文テンプレートを持ち、
// ジョブの人物名と、人物データのグループ名だけを差し込む（推測でグループ名を作らない）。
// 管理画面のフロントで生成するだけで、動画生成・Worker・ジョブのデータには影響しない（'use client' からも import 可）。
// 投稿文が未設定のテンプレートは null（管理画面では欄を出さない）。

export interface CaptionPerson {
  name: string;
  /** 人物データに登録されているグループ名（卒業・脱退済みでも登録があれば使う。無ければ null） */
  groupName: string | null;
  /** 投稿の対象が人物かグループか（省略時は人物）。グループ版の動画（OSHI_GROUP_*）では name がグループ名になる */
  kind?: 'person' | 'group';
}

/** 管理画面の人物選択データ（PersonOption）からグループ名を決める */
export function captionGroupName(p: { group?: string; currentGroupName?: string } | undefined): string | null {
  if (!p) return null;
  // 人物についての投稿のため、活動状態（卒業・脱退済み等）に関係なく、DBに登録されているグループ名を使う
  // 改名後の現グループ名（欅坂46→櫻坂46 など）を優先（人物選択 PersonCombobox と同じ）
  const name = (p.currentGroupName || p.group || '').trim();
  return name || null;
}

/**
 * 名前をハッシュタグにする。空白だけを詰め（Snow Man → #SnowMan）、それ以外の記号（! ＝ / ☆ . など）を含む名前は
 * 記号を消すと別の名前になるため null（タグにしない）
 */
export function toHashtag(name: string): string | null {
  const compact = name.replace(/[\s　]+/g, '');
  if (!compact || !/^[\p{L}\p{N}\p{M}_]+$/u.test(compact)) return null;
  return `#${compact}`;
}

type CaptionBuilder = (person: CaptionPerson) => string;

const shoppingIntroCaption: CaptionBuilder = (person) => {
  const tags = ['#推し活', '#推し活グッズ', '#推しサーチ', toHashtag(person.name), person.groupName ? toHashtag(person.groupName) : null]
    .filter((t): t is string => !!t)
    .join(' ');
  return [
    '推し活グッズ、結局どれ買えばいい？🤔',
    '',
    'そんなときに使える',
    '「推し活お買い物診断」を作りました✨',
    '',
    'やることはかんたん👇',
    '',
    '① 推しを選ぶ',
    '② 用途を選ぶ',
    '③ 予算を選ぶ',
    '',
    'これだけで、推しに関連する商品を探せます🔍',
    '',
    `今回は${person.name}さんで診断してみました。`,
    '',
    '「プレゼントを探したい」',
    '「予算内で推しの商品を見つけたい」',
    '「毎回検索するのが大変」',
    '',
    'というときにも使えます。',
    '',
    '✅ 無料',
    '✅ 登録不要',
    '',
    '気になる方はプロフィールのリンクから',
    '「推しサーチ」で試してみてください🔗',
    '',
    tags,
  ].join('\n');
};

/** 推し活で損してるかも？ V1: person.name は人物名またはグループ名（グループのときはグループ名の登録が無いため groupName は null） */
const sonkamoCaption: CaptionBuilder = (person) => {
  const tags = ['#推し活', '#推しサーチ', toHashtag(person.name), person.groupName ? toHashtag(person.groupName) : null]
    .filter((t): t is string => !!t)
    .join(' ');
  return [
    `${person.name}推し、これ知らないと損かも？👀`,
    '',
    '推しサーチなら',
    '✅ 出演作品',
    '✅ どこで見られるか（配信先）',
    '✅ 写真集・CD・関連グッズ',
    'をまとめて探せます🔍',
    '',
    '✅ 無料',
    '✅ 登録不要',
    '',
    'プロフィールのリンクから',
    '「推しサーチ」でチェックしてみてください🔗',
    '',
    tags,
  ].join('\n');
};

/**
 * 推しサーチ紹介「グループ推し・このサイトまだ知らないの？」（OSHI_GROUP_09）。冒頭は動画の冒頭（台本の1文目）と同じ文。
 * 箇条書きは動画で見せる機能（検索・出演作品・配信先・関連グッズ・サブスク診断）に合わせる。料金の注記は入れない（サイト内の料金説明は別）。
 * グループのときはグループ名、人物のときは人物名を入れる（人物版は「メンバー」「CD」など人物に合わない語を使わない。ライブ映像は動画で見せないため両方とも入れない）。
 */
const oshiSearchUnknownCaption: CaptionBuilder = (person) => {
  const isGroup = person.kind === 'group';
  const tags = ['#推し活', '#推しサーチ', toHashtag(person.name), !isGroup && person.groupName ? toHashtag(person.groupName) : null]
    .filter((t, i, a): t is string => !!t && a.indexOf(t) === i)
    .join(' ');
  const features = isGroup
    ? [
        '✅ メンバーの情報・出演作品をまとめて検索',
        '✅ ドラマ・映画などの配信先をチェック',
        '✅ 写真集・CD・関連グッズを探せる',
        '✅ 推しに合うサブスクを診断できる',
      ]
    : [
        '✅ 出演作品をまとめて検索',
        '✅ ドラマ・映画などの配信先をチェック',
        '✅ 写真集・関連グッズを探せる',
        '✅ 推しに合うサブスクを診断できる',
      ];
  return [
    `${person.name}を推してる人、このサイトまだ知らないの？`,
    '',
    `推しサーチなら、${person.name}の`,
    ...features,
    '',
    '推し活に役立つ情報をまとめてチェックできます🔍',
    '',
    'プロフィールのリンクからチェック🔗',
    '',
    tags,
  ].join('\n');
};

/** テンプレートIDごとの投稿文テンプレート。新しいテンプレートはここに1件追加する */
const INSTAGRAM_CAPTIONS: Record<string, CaptionBuilder> = {
  'oshi-shopping-intro-v1': shoppingIntroCaption,
  'oshi-sonkamo-v1': sonkamoCaption,
  OSHI_GROUP_09: oshiSearchUnknownCaption,
};

export function getInstagramCaption(templateId: string, person: CaptionPerson): string | null {
  const build = INSTAGRAM_CAPTIONS[templateId];
  return build ? build(person) : null;
}
