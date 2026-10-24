// 動画生成（/admin/video-maker）の完了ジョブに表示する「Instagram投稿文」。テンプレートIDごとに投稿文テンプレートを持ち、
// ジョブの人物名と、人物データのグループ名だけを差し込む（推測でグループ名を作らない）。
// 管理画面のフロントで生成するだけで、動画生成・Worker・ジョブのデータには影響しない（'use client' からも import 可）。
// 投稿文が未設定のテンプレートは null（管理画面では欄を出さない）。

export interface CaptionPerson {
  name: string;
  /** 人物データに登録されているグループ名（卒業・脱退済みでも登録があれば使う。無ければ null） */
  groupName: string | null;
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

/** テンプレートIDごとの投稿文テンプレート。新しいテンプレートはここに1件追加する */
const INSTAGRAM_CAPTIONS: Record<string, CaptionBuilder> = {
  'oshi-shopping-intro-v1': shoppingIntroCaption,
};

export function getInstagramCaption(templateId: string, person: CaptionPerson): string | null {
  const build = INSTAGRAM_CAPTIONS[templateId];
  return build ? build(person) : null;
}
