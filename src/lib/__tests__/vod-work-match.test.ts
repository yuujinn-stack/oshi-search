import { describe, it, expect } from 'vitest';
import { normalizeVodMatchTitle, matchWorksByTitle, resolveVodMatch, type VodMatchCandidate } from '../vod-work-match';

describe('normalizeVodMatchTitle', () => {
  it('全角記号・空白を安全に正規化する', () => {
    expect(normalizeVodMatchTitle('アクトレス')).toBe(normalizeVodMatchTitle('アクトレス　')); // 全角空白除去
    expect(normalizeVodMatchTitle('Ａｃｔｒｅｓｓ')).toBe(normalizeVodMatchTitle('Actress')); // 全角英数→半角
  });

  it('続編・シーズン番号・年・サブタイトルは削除しない（別作品の誤同一視を防ぐ）', () => {
    expect(normalizeVodMatchTitle('作品名')).not.toBe(normalizeVodMatchTitle('作品名2'));
    expect(normalizeVodMatchTitle('作品名 シーズン2')).not.toBe(normalizeVodMatchTitle('作品名'));
    expect(normalizeVodMatchTitle('作品名 THE MOVIE')).not.toBe(normalizeVodMatchTitle('作品名'));
    expect(normalizeVodMatchTitle('作品名 劇場版')).not.toBe(normalizeVodMatchTitle('作品名'));
    expect(normalizeVodMatchTitle('作品名2023')).not.toBe(normalizeVodMatchTitle('作品名2024'));
  });
});

describe('matchWorksByTitle', () => {
  const works = [
    { id: 'w-a', title: 'アクトレス', type: 'tv', releaseYear: 2023 },
    { id: 'w-b', title: 'アクトレス', type: 'movie', releaseYear: 2010 },
  ];

  it('タイトルのみでは両方ヒットする（次段のresolveVodMatchで曖昧判定される想定）', () => {
    const result = matchWorksByTitle(works, { workTitle: 'アクトレス' });
    expect(result.map((w) => w.id).sort()).toEqual(['w-a', 'w-b']);
  });

  it('workTypeを指定すると1件に絞り込める', () => {
    const result = matchWorksByTitle(works, { workTitle: 'アクトレス', workType: 'tv' });
    expect(result.map((w) => w.id)).toEqual(['w-a']);
  });

  it('releaseYearを指定すると1件に絞り込める', () => {
    const result = matchWorksByTitle(works, { workTitle: 'アクトレス', releaseYear: 2010 });
    expect(result.map((w) => w.id)).toEqual(['w-b']);
  });

  it('releaseYear未指定の候補側は年で除外しない（データ不足で誤って弾かない）', () => {
    const withUnknownYear = [{ id: 'w-c', title: 'アクトレス', type: 'tv', releaseYear: undefined }];
    const result = matchWorksByTitle(withUnknownYear, { workTitle: 'アクトレス', releaseYear: 2023 });
    expect(result.map((w) => w.id)).toEqual(['w-c']);
  });
});

describe('resolveVodMatch（「アクトレス」同名別作品の再現テスト）', () => {
  // 同じタイトル「アクトレス」の作品が2件存在する状態を再現:
  //   作品A: workId=work-actress-A, 早川聖来 出演, releaseYear=2023
  //   作品B: workId=work-actress-B, 別人物 出演, releaseYear=別年
  const workA: VodMatchCandidate = { personName: '早川聖来', workId: 'work-actress-A', title: 'アクトレス', workType: 'tv', releaseYear: 2023 };
  const workB: VodMatchCandidate = { personName: '別人物', workId: 'work-actress-B', title: 'アクトレス', workType: 'movie', releaseYear: 2010 };

  it('person A用に取得された情報は、person Aの作品(work-actress-A)にのみ確定する', () => {
    // work-vod-import相当: personName=早川聖来 でスコープ済みの候補（=workAのみ）
    const outcome = resolveVodMatch([workA]);
    expect(outcome.status).toBe('matched');
    if (outcome.status === 'matched') {
      expect(outcome.workId).toBe('work-actress-A');
      expect(outcome.workId).not.toBe('work-actress-B');
    }
  });

  it('逆方向: person B用の情報は work-actress-B にのみ確定し、work-actress-A へは紐付かない', () => {
    const outcome = resolveVodMatch([workB]);
    expect(outcome.status).toBe('matched');
    if (outcome.status === 'matched') {
      expect(outcome.workId).toBe('work-actress-B');
      expect(outcome.workId).not.toBe('work-actress-A');
    }
  });

  it('同タイトル・同年・別人物でも、人物情報で分離すれば一意に確定できる', () => {
    // 同年ケース: 早川聖来(2023) と 別人物(2023) それぞれ独立した作品
    const sameYearA: VodMatchCandidate = { personName: '早川聖来', workId: 'work-actress-A', title: 'アクトレス', workType: 'tv', releaseYear: 2023 };
    const sameYearC: VodMatchCandidate = { personName: '別人物C', workId: 'work-actress-C', title: 'アクトレス', workType: 'tv', releaseYear: 2023 };

    // 人物ごとにスコープされた候補（work-vod-importの実際の入力形）ではそれぞれ一意に確定する
    expect(resolveVodMatch([sameYearA])).toMatchObject({ status: 'matched', workId: 'work-actress-A' });
    expect(resolveVodMatch([sameYearC])).toMatchObject({ status: 'matched', workId: 'work-actress-C' });
  });

  it('workTitle照合のみ（人物・年が不明でtitleIndexが両方拾ってしまう状態）は自動確定せずambiguousになる', () => {
    // vod-title-import相当: personNameを指定できないCSVで、たまたま複数の異なるworkIdがヒットしたケース
    const outcome = resolveVodMatch([workA, workB]);
    expect(outcome.status).toBe('ambiguous');
    if (outcome.status === 'ambiguous') {
      expect(outcome.candidateWorkIds.sort()).toEqual(['work-actress-A', 'work-actress-B']);
    }
  });

  it('候補が0件の場合はnone（勝手に既存の別作品へ紐付けない）', () => {
    expect(resolveVodMatch([])).toEqual({ status: 'none' });
  });

  it('同一workIdに複数人物の行が存在するのは曖昧ではなく確定できる（正常なデータ構造）', () => {
    // tmdb-tv-228620アクトレスのように、同一作品に複数のメンバーが出演しているケース
    const castA: VodMatchCandidate = { personName: '早川聖来', workId: 'work-actress-A', title: 'アクトレス' };
    const castB: VodMatchCandidate = { personName: '森田ひかる', workId: 'work-actress-A', title: 'アクトレス' };
    const outcome = resolveVodMatch([castA, castB]);
    expect(outcome.status).toBe('matched');
    if (outcome.status === 'matched') {
      expect(outcome.workId).toBe('work-actress-A');
      expect(outcome.personNames.sort()).toEqual(['早川聖来', '森田ひかる']);
    }
  });
});
