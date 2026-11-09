import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import reports from './fixtures/media-script-reports.json';
import MediaGroupCombobox, { filterMediaGroups, normalizeGroupQuery } from '@/app/admin/video-maker/MediaGroupCombobox';
import MediaReelPicker from '@/app/admin/video-maker/MediaReelPicker';

// 管理画面「推しサーチ総合紹介動画」グループ版（OSHI_GROUP_05・OSHI_GROUP_10）のグループ選択（クリックで一覧・任意の検索）
const groups = [
  { name: 'M!LK', members: ['佐野勇斗', '吉田仁人'] },
  { name: 'Snow Man', members: ['目黒蓮', '宮舘涼太'] },
  { name: 'SixTONES', members: ['松村北斗'] },
  { name: '超特急', members: ['リョウガ'] },
  { name: '乃木坂46', members: ['賀喜遥香'] },
  { name: 'King & Prince', members: ['永瀬廉'] },
  { name: 'なにわ男子', members: ['道枝駿佑'] },
];
const names = (q: string) => filterMediaGroups(groups, q).map((x) => x.group.name);

describe('filterMediaGroups（検索は任意）', () => {
  it('入力が空なら登録済みのグループを全件、元の並び順で出す（M!LK だけに絞らない）', () => {
    expect(names('')).toEqual(groups.map((g) => g.name));
    expect(names('   ')).toEqual(groups.map((g) => g.name));
  });

  it('入力で絞り込む（大文字小文字・全角半角・空白・記号・カタカナ/ひらがなの違いを無視）', () => {
    expect(names('snow')).toEqual(['Snow Man']);
    expect(names('ｓｎｏｗｍａｎ')).toEqual(['Snow Man']);
    expect(names('SNOW MAN')).toEqual(['Snow Man']);
    expect(names('mlk')).toEqual(['M!LK']);
    expect(names('m!lk')).toEqual(['M!LK']);
    expect(names('king prince')).toEqual(['King & Prince']);
    expect(names('ナニワ')).toEqual(['なにわ男子']);
    expect(names('乃木坂')).toEqual(['乃木坂46']);
  });

  it('読み（Worker の読み辞書）でも探せる: みるく・ミルク → M!LK', () => {
    const readings = { 'M!LK': 'みるく', 'Snow Man': 'スノーマン' };
    expect(filterMediaGroups(groups, 'みるく', readings).map((x) => x.group.name)).toEqual(['M!LK']);
    expect(filterMediaGroups(groups, 'ミルク', readings).map((x) => x.group.name)).toEqual(['M!LK']);
    expect(filterMediaGroups(groups, 'すのー', readings).map((x) => x.group.name)).toEqual(['Snow Man']);
  });

  it('メンバー名でも探せる（グループ名に合うものが先）', () => {
    const r = filterMediaGroups(groups, '目黒');
    expect(r.map((x) => [x.group.name, x.member])).toEqual([['Snow Man', '目黒蓮']]);
    expect(names('存在しないグループ')).toEqual([]);
  });

  it('候補は渡されたグループ一覧（推しサーチの登録データ）だけ。新しいグループも追加すればそのまま出る', () => {
    const added = [...groups, { name: '新グループ', members: ['新人'] }];
    expect(filterMediaGroups(added, '').map((x) => x.group.name)).toContain('新グループ');
    expect(normalizeGroupQuery('Ｍ!ＬＫ')).toBe(normalizeGroupQuery('m l k'));
  });
});

describe('MediaGroupCombobox の表示', () => {
  const render = (props: Partial<Parameters<typeof MediaGroupCombobox>[0]> = {}) =>
    renderToStaticMarkup(<MediaGroupCombobox groups={groups} value="" onChange={() => {}} {...props} />);

  it('未選択: クリックで開く欄（入力しなくても選べる）', () => {
    const h = render();
    expect(h).toContain('クリックしてグループを選ぶ');
    expect(h).toContain('aria-haspopup="listbox"');
    expect(h).toContain('aria-expanded="false"');
  });

  it('選択済み: 正式名称を表示', () => {
    expect(render({ value: 'King & Prince' })).toContain('King &amp; Prince');
  });

  it('取得中・取得エラー・0件を分かりやすく表示する', () => {
    expect(render({ status: 'loading' })).toContain('読み込み中');
    const e = render({ status: 'error', errorMessage: 'サーバーでグループ一覧を読み込めませんでした' });
    expect(e).toContain('取得できませんでした');
    expect(e).toContain('再読み込み');
    expect(render({ groups: [] })).toContain('選べるグループがありません');
  });
});

describe('MediaReelPicker（OSHI_GROUP_05・OSHI_GROUP_10 の両方で同じグループ選択）', () => {
  const html = (i: number, groupName: string | null, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(<MediaReelPicker mediaScript={reports[i]} groups={groups} fixedReadings={{}} value={{ groupName }} onChange={() => {}} {...extra} />);

  it('OSHI_GROUP_05・OSHI_GROUP_10: グループ選択欄があり、選んだグループで台本・サムネイルが変わる', () => {
    for (const i of [4, 9]) {
      const h = html(i, 'Snow Man');
      expect(h).toContain('vm-media-group');
      expect(h).toContain('Snow Man推し');
      expect(h).not.toContain('M!LK推し');
      expect(h).not.toContain('datalist');
    }
  });

  it('一般版（OSHI_GENERAL_*）はグループ選択欄を出さない（従来どおり）', () => {
    for (const i of [0, 1, 2, 3, 5, 6, 7, 8]) expect(html(i, null)).not.toContain('vm-media-group');
  });

  it('グループ一覧を取得できなかったときは、その旨を表示する', () => {
    const h = html(4, null, { groups: [], groupsStatus: 'error', groupsError: 'サーバーでグループ一覧を読み込めませんでした' });
    expect(h).toContain('登録済みのグループを取得できませんでした');
  });
});
