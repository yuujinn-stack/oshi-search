import { describe, it, expect } from 'vitest';
import { BULK_SELECT_SIZES, countHiddenSelected, firstNIds, isFirstNSelection } from '@/lib/bulk-work-selection';
import { buildBatchVodResearchPrompt, buildVodResearchCsvRow, VOD_RESEARCH_CSV_HEADER } from '@/lib/vod-research-prompt';

// 表示一覧（フィルター・並び順を反映済み）の作品ID。60件
const all = Array.from({ length: 60 }, (_, i) => `w${String(i + 1).padStart(2, '0')}`);

describe('先頭からN件の一括選択', () => {
  it('ボタンは 5件刻みで 5〜40件', () => {
    expect([...BULK_SELECT_SIZES]).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
  });

  it.each([5, 25, 40])('%i件：表示一覧の先頭からその件数だけ選ぶ（スクロール外の作品も含む）', (n) => {
    const s = firstNIds(all, n);
    expect(s.size).toBe(n);
    expect([...s]).toEqual(all.slice(0, n));
  });

  it('切り替えると合計がその件数になる（追加にならない）', () => {
    let s = firstNIds(all, 25);
    s = firstNIds(all, 10);
    expect(s.size).toBe(10);
    s = firstNIds(all, 40);
    expect(s.size).toBe(40);
  });

  it('フィルター後の一覧（並び順どおり）に対して選ぶ。件数が足りなければ存在する分だけ', () => {
    const filtered = all.filter((id) => Number(id.slice(1)) % 3 === 0).reverse(); // 20件・逆順
    const s = firstNIds(filtered, 25);
    expect(s.size).toBe(20);
    expect([...firstNIds(filtered, 5)]).toEqual(filtered.slice(0, 5));
    expect(firstNIds([], 40).size).toBe(0);
  });

  it('個別チェックで追加・解除すると「先頭N件」の強調は外れる。戻せば再び一致', () => {
    const s = firstNIds(all, 25);
    expect(isFirstNSelection(s, all, 25)).toBe(true);
    s.delete('w03');
    expect(s.size).toBe(24);
    expect(isFirstNSelection(s, all, 25)).toBe(false);
    s.add('w03');
    s.add('w50');
    expect(isFirstNSelection(s, all, 25)).toBe(false);
    s.delete('w50');
    expect(isFirstNSelection(s, all, 25)).toBe(true);
  });

  it('全解除（表示中の作品を外す）後は 0件で強調なし', () => {
    const s = firstNIds(all, 40);
    for (const id of all) s.delete(id);
    expect(s.size).toBe(0);
    expect(isFirstNSelection(s, all, 40)).toBe(false);
  });

  it('表示一覧に無い選択中の作品を数える（一括選択で解除される前に確認するため）', () => {
    const selected = new Set(['w01', 'w02', 'w55', 'w60']);
    const filtered = all.slice(0, 10);
    expect(countHiddenSelected(selected, filtered)).toBe(2);
    expect(countHiddenSelected(selected, all)).toBe(0);
    expect(countHiddenSelected(new Set(), filtered)).toBe(0);
  });

  it('先頭件数より一覧が短いとき、全件選択も「先頭N件」として一致する', () => {
    const short = all.slice(0, 7);
    expect(isFirstNSelection(firstNIds(short, 10), short, 10)).toBe(true);
  });
});

describe('選択した25件から25件分のプロンプトを作る（既存のプロンプト生成は変更なし）', () => {
  it('25行の作品CSVが入る', () => {
    const works = all.map((id, i) => ({ id, title: `作品${i + 1}`, year: 2000 + i }));
    const picked = firstNIds(works.map((w) => w.id), 25);
    const rows = works
      .filter((w) => picked.has(w.id))
      .map((w) => buildVodResearchCsvRow({
        workId: w.id, personName: '岸優太', title: w.title, workType: 'movie',
        releaseYear: w.year, roleName: '', currentVodServices: 'なし',
      }));
    const prompt = buildBatchVodResearchPrompt(`${VOD_RESEARCH_CSV_HEADER}\n${rows.join('\n')}`, '岸優太');
    const dataLines = prompt.split('\n').filter((l) => /^w\d{2},/.test(l));
    expect(dataLines).toHaveLength(25);
    expect(dataLines[0].startsWith('w01,')).toBe(true);
    expect(dataLines[24].startsWith('w25,')).toBe(true);
  });
});
