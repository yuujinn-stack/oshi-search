/**
 * H「観るもの・買うもの、まとめて」のキャプション・ハッシュタグ生成（純粋関数。DB・外部APIに触れない）。
 * 予約・一括予約は既存の予約画面（/admin/instagram-schedule）と予約APIをそのまま使う。
 */

/** H案のハッシュタグ（#推しサーチ #推し活 #人物名）。人物名の空白は除く */
export function buildWatchAndBuyHashtags(personName: string): string {
  return ['#推しサーチ', '#推し活', `#${personName.replace(/\s+/g, '')}`].join(' ');
}

/** H案のキャプション（予約前に管理画面で編集できる初期値） */
export function buildWatchAndBuyCaption(personName: string): string {
  return [
    `${personName}を追うなら、`,
    '観るものも、買うものもまとめてチェック。',
    '',
    '出演作品・配信先・関連商品を',
    '人物名からまとめて探せます。',
    '',
    '気になる人ができたら',
    'プロフィールのリンクから「推しサーチ」へ。',
    '',
    '※配信情報・商品情報は確認時点の情報です。',
    '',
    ...buildWatchAndBuyHashtags(personName).split(' '),
  ].join('\n');
}
