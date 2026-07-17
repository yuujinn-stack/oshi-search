import { describe, test, expect } from 'vitest';
import {
  normalizeTag,
  buildInfoGenreList,
  buildCardBadges,
  normalizeTags,
} from '../person-display-tags';

// ─── normalizeTag ─────────────────────────────────────────────────────────────
describe('normalizeTag', () => {
  test('有効なジャンル文字列をそのまま返す', () => {
    expect(normalizeTag('女優')).toBe('女優');
    expect(normalizeTag('アイドル')).toBe('アイドル');
    expect(normalizeTag('歌手')).toBe('歌手');
  });

  test('前後の空白をトリムする', () => {
    expect(normalizeTag('  女優  ')).toBe('女優');
    expect(normalizeTag('\t俳優\n')).toBe('俳優');
  });

  test('表記ゆれを canonical 表記へ正規化する', () => {
    expect(normalizeTag('役者')).toBe('俳優');
    expect(normalizeTag('ミュージシャン')).toBe('アーティスト');
    expect(normalizeTag('Youtuber')).toBe('YouTuber');
    expect(normalizeTag('youtuber')).toBe('YouTuber');
    expect(normalizeTag('ユーチューバー')).toBe('YouTuber');
    expect(normalizeTag('SNS')).toBe('インフルエンサー');
  });

  test('グループ名の略称を正式名へ変換する', () => {
    expect(normalizeTag('乃木坂')).toBe('乃木坂46');
    expect(normalizeTag('日向坂')).toBe('日向坂46');
    expect(normalizeTag('櫻坂')).toBe('櫻坂46');
    expect(normalizeTag('欅坂')).toBe('欅坂46');
    expect(normalizeTag('=LOVE')).toBe('＝LOVE');
    expect(normalizeTag('イコラブ')).toBe('＝LOVE');
    expect(normalizeTag('ノイミー')).toBe('≠ME');
    expect(normalizeTag('ニアジョイ')).toBe('≒JOY');
  });

  test('null・undefined を受け取ると null を返す', () => {
    expect(normalizeTag(null)).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
  });

  test('無効値に対して null を返す', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('undefined')).toBeNull();
    expect(normalizeTag('null')).toBeNull();
    expect(normalizeTag('不明')).toBeNull();
    expect(normalizeTag('unknown')).toBeNull();
    expect(normalizeTag('n/a')).toBeNull();
    expect(normalizeTag('-')).toBeNull();
    expect(normalizeTag('—')).toBeNull();
  });
});

// ─── normalizeTags ────────────────────────────────────────────────────────────
describe('normalizeTags', () => {
  test('配列を正規化して返す', () => {
    expect(normalizeTags(['女優', '役者', 'アイドル'])).toEqual(['女優', '俳優', 'アイドル']);
  });

  test('カンマ区切り文字列を配列に変換する', () => {
    expect(normalizeTags('歌手,アイドル')).toEqual(['歌手', 'アイドル']);
  });

  test('null・undefined を空配列で返す', () => {
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

// ─── buildInfoGenreList ───────────────────────────────────────────────────────
describe('buildInfoGenreList', () => {
  test('primaryGenre → genres → genre の優先順で返す', () => {
    const result = buildInfoGenreList({
      primaryGenre: '女優',
      genres: ['アイドル', '歌手'],
      genre: 'モデル',
    });
    expect(result).toEqual(['女優', 'アイドル', '歌手', 'モデル']);
  });

  test('重複を除去する', () => {
    const result = buildInfoGenreList({
      primaryGenre: '女優',
      genres: ['女優', 'アイドル'],
      genre: 'アイドル',
    });
    expect(result).toEqual(['女優', 'アイドル']);
  });

  test('primaryGenre のみの場合', () => {
    const result = buildInfoGenreList({ primaryGenre: '歌手' });
    expect(result).toEqual(['歌手']);
  });

  test('genres のみの場合', () => {
    const result = buildInfoGenreList({ genres: ['タレント', 'モデル'] });
    expect(result).toEqual(['タレント', 'モデル']);
  });

  test('genre のみの場合', () => {
    const result = buildInfoGenreList({ genre: 'アイドル' });
    expect(result).toEqual(['アイドル']);
  });

  test('全フィールドが空の場合は空配列を返す', () => {
    const result = buildInfoGenreList({});
    expect(result).toEqual([]);
  });

  test('無効値は除外する', () => {
    const result = buildInfoGenreList({
      primaryGenre: 'null',
      genres: ['', '不明', '女優'],
      genre: 'unknown',
    });
    expect(result).toEqual(['女優']);
  });

  test('表記ゆれを正規化する', () => {
    const result = buildInfoGenreList({
      primaryGenre: '役者',
      genres: ['ミュージシャン'],
    });
    expect(result).toEqual(['俳優', 'アーティスト']);
  });

  test('genres が null の場合もクラッシュしない', () => {
    const result = buildInfoGenreList({ genres: null, genre: '歌手' });
    expect(result).toEqual(['歌手']);
  });

  test('slice(0, 4) で先頭4件に絞れる', () => {
    const result = buildInfoGenreList({
      primaryGenre: '女優',
      genres: ['アイドル', '歌手', 'モデル', 'タレント'],
      genre: '声優',
    });
    expect(result.slice(0, 4)).toEqual(['女優', 'アイドル', '歌手', 'モデル']);
  });
});

// ─── buildCardBadges ──────────────────────────────────────────────────────────
describe('buildCardBadges', () => {
  test('activityStatus=graduated で「卒業」を付与する', () => {
    const result = buildCardBadges('アイドル', { activityStatus: 'graduated' });
    expect(result).toContain('卒業');
    expect(result).toContain('アイドル');
  });

  test('activityStatus=withdrawn で「脱退」を付与する', () => {
    const result = buildCardBadges('アイドル', { activityStatus: 'withdrawn' });
    expect(result).toContain('脱退');
  });

  test('activityStatus=active では「卒業」「脱退」を付与しない', () => {
    const result = buildCardBadges('アイドル', { activityStatus: 'active' });
    expect(result).not.toContain('卒業');
    expect(result).not.toContain('脱退');
  });

  test('maxBadges でバッジ数を制限する', () => {
    const result = buildCardBadges(
      'アイドル',
      {
        primaryGenre: '女優',
        genres: ['歌手', 'モデル', 'タレント'],
        activityStatus: 'graduated',
        generation: '1期',
      },
      3,
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  test('デフォルトは最大4件', () => {
    const result = buildCardBadges(
      'アイドル',
      {
        primaryGenre: '女優',
        genres: ['歌手', 'モデル'],
        activityStatus: 'graduated',
        generation: '1期',
      },
    );
    expect(result.length).toBeLessThanOrEqual(4);
  });

  test('primaryGenre → genres → genre → 活動状態 → generation の優先順', () => {
    const result = buildCardBadges(
      'アイドル',
      {
        primaryGenre: '女優',
        genres: ['歌手'],
        activityStatus: 'graduated',
        generation: '1期',
      },
      10,
    );
    expect(result[0]).toBe('女優');
    expect(result[1]).toBe('歌手');
    expect(result[2]).toBe('アイドル');
    expect(result[3]).toBe('卒業');
    expect(result[4]).toBe('1期');
  });

  test('重複を除去する', () => {
    const result = buildCardBadges(
      'アイドル',
      { primaryGenre: 'アイドル', genres: ['アイドル'] },
      10,
    );
    expect(result.filter((b) => b === 'アイドル').length).toBe(1);
  });

  test('meta なしでも動作する', () => {
    const result = buildCardBadges('アイドル');
    expect(result).toEqual(['アイドル']);
  });

  test('全フィールドが空の場合は空配列', () => {
    const result = buildCardBadges(undefined);
    expect(result).toEqual([]);
  });
});
