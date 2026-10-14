import { describe, expect, it } from 'vitest';
import {
  OSHI_VOD_COMPARE_INPUT_KIND,
  TemplateInputError,
  isTemplateInputKind,
  parseOshiVodCompareInput,
  parseTemplateInput,
} from '../video-template-input';
import { personVideoSlug } from '@/server/video-jobs/person-slug';

const A = personVideoSlug('目黒蓮');
const B = personVideoSlug('松村北斗');
const C = personVideoSlug('京本大我');

describe('推しでサブスク比較のテンプレート固有入力', () => {
  it('3人のslugを選択順のまま受け付ける', () => {
    expect(parseOshiVodCompareInput({ version: 1, personSlugs: [A, B, C] })).toEqual({ version: 1, personSlugs: [A, B, C] });
    expect(parseOshiVodCompareInput({ personSlugs: [C, A, B] }).personSlugs).toEqual([C, A, B]);
  });

  it('3人未満・3人超を拒否する', () => {
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B] })).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput({ personSlugs: [] })).toThrow(/3人ちょうど/);
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, C, personVideoSlug('ジェシー')] })).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, null] })).toThrow(TemplateInputError);
  });

  it('同じ人物の重複を拒否する', () => {
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, A] })).toThrow(/重複/);
  });

  it('不正なslug・形式を拒否する', () => {
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, '目黒蓮'] })).toThrow(/不正な人物/);
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, 'matsumura-hokuto'] })).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput({ personSlugs: [A, B, 'p-XYZ'] })).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput(null)).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput([A, B, C])).toThrow(TemplateInputError);
    expect(() => parseOshiVodCompareInput({ version: 2, personSlugs: [A, B, C] })).toThrow(/未対応/);
  });

  it('入力種別の判定・種別ごとの検証', () => {
    expect(isTemplateInputKind(OSHI_VOD_COMPARE_INPUT_KIND)).toBe(true);
    expect(isTemplateInputKind('unknown')).toBe(false);
    expect(isTemplateInputKind(undefined)).toBe(false);
    expect(parseTemplateInput(OSHI_VOD_COMPARE_INPUT_KIND, { personSlugs: [A, B, C] }).personSlugs).toEqual([A, B, C]);
  });
});
