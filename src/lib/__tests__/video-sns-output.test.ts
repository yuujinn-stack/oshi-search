import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNS_CTA,
  DEFAULT_SNS_OUTPUT_CHOICE,
  SnsOutputError,
  buildSnsOutputRequest,
  parseSnsCtaAudioReport,
  parseSnsCtaCapability,
  parseSnsOutputRequest,
  readSnsOutputsResult,
  resolveSnsSubmission,
  snsCtaAudioKey,
  splitSnsOutput,
} from '../video-sns-output';

describe('SNS別CTAの既定値', () => {
  it('出力先SNSの初期値は両方、TikTok は検索窓CTA、Instagram はテンプレートのCTAのまま', () => {
    expect(DEFAULT_SNS_OUTPUT_CHOICE).toBe('both');
    expect(DEFAULT_SNS_CTA.tiktok).toMatchObject({
      mode: 'search',
      narration: '気になったら、推しサーチで検索！',
      telop: '気になったら\n「推しサーチ」で検索！',
      subText: 'oshi-search.jp',
      showSubText: true,
    });
    expect(DEFAULT_SNS_CTA.instagram.mode).toBe('template');
  });

  it('CTA音声のキーは oshi-video-maker と同じ値（空白の違いは無視）', () => {
    expect(snsCtaAudioKey('気になったら、推しサーチで検索！')).toBe('59d1c4bc');
    expect(snsCtaAudioKey(' 気になったら、\n推しサーチで検索！ ')).toBe('59d1c4bc');
  });
});

describe('parseSnsOutputRequest', () => {
  it('無ければ null（従来どおり Instagram 版だけ）', () => {
    expect(parseSnsOutputRequest(undefined)).toBeNull();
    expect(parseSnsOutputRequest(null)).toBeNull();
  });
  it('出力先の順番をそろえ、設定の省略は既定値で補う', () => {
    const r = parseSnsOutputRequest({ version: 1, targets: ['tiktok', 'instagram'] })!;
    expect(r.targets).toEqual(['instagram', 'tiktok']);
    expect(r.cta.tiktok.narration).toBe(DEFAULT_SNS_CTA.tiktok.narration);
  });
  it('不正な指定は拒否する', () => {
    expect(() => parseSnsOutputRequest({ version: 2, targets: ['tiktok'] })).toThrow(SnsOutputError);
    expect(() => parseSnsOutputRequest({ version: 1, targets: [] })).toThrow(SnsOutputError);
    expect(() => parseSnsOutputRequest({ version: 1, targets: ['youtube'] })).toThrow(SnsOutputError);
    expect(() => parseSnsOutputRequest({ version: 1, targets: ['tiktok'], cta: { tiktok: { durationSec: 1 } } })).toThrow(/表示時間/);
    expect(() => parseSnsOutputRequest({ version: 1, targets: ['tiktok'], cta: { tiktok: { narration: '' } } })).toThrow(/空/);
  });
});

describe('splitSnsOutput', () => {
  it('template_input の他の中身はそのまま、出力先SNSの指定だけを取り出す', () => {
    expect(splitSnsOutput({ version: 1, personSlugs: ['a'], snsOutput: { x: 1 } })).toEqual({ templateInput: { version: 1, personSlugs: ['a'] }, snsOutput: { x: 1 } });
    expect(splitSnsOutput({ snsOutput: { x: 1 } })).toEqual({ templateInput: null, snsOutput: { x: 1 } });
    expect(splitSnsOutput(null)).toEqual({ templateInput: null, snsOutput: undefined });
  });
});

describe('resolveSnsSubmission（管理画面の選択 → ジョブ作成時の指定）', () => {
  const capability = { version: 1 as const, modes: ['none', 'capcut'], reason: null };
  it('対応テンプレート: 選んだ出力先のまま', () => {
    const s = resolveSnsSubmission({ capability, narrationMode: 'capcut', choice: 'both', settings: DEFAULT_SNS_CTA });
    expect(s.snsOutput?.targets).toEqual(['instagram', 'tiktok']);
    expect(s.note).toBeNull();
    expect(s.blocked).toBeNull();
  });
  it('古い Worker（報告なし）: 送らない（Instagram 版だけ）', () => {
    const s = resolveSnsSubmission({ capability: undefined, narrationMode: 'none', choice: 'both', settings: DEFAULT_SNS_CTA });
    expect(s.snsOutput).toBeNull();
    expect(s.note).toMatch(/Instagram 版だけ/);
  });
  it('未対応の方式: 両方なら Instagram 版だけにして理由を出し、TikTok のみなら作れない', () => {
    const cap = { version: 1 as const, modes: ['none'], reason: 'CapCut 音声版は未対応です。' };
    const both = resolveSnsSubmission({ capability: cap, narrationMode: 'capcut', choice: 'both', settings: DEFAULT_SNS_CTA });
    expect(both.snsOutput?.targets).toEqual(['instagram']);
    expect(both.note).toMatch(/CapCut 音声版は未対応/);
    const only = resolveSnsSubmission({ capability: cap, narrationMode: 'capcut', choice: 'tiktok', settings: DEFAULT_SNS_CTA });
    expect(only.snsOutput).toBeNull();
    expect(only.blocked).toMatch(/TikTok版/);
  });
  it('TikTok をテンプレートのCTAのままにすれば、未対応のテンプレートでも TikTok 版を作れる（final.mp4 と同じ）', () => {
    const cap = { version: 1 as const, modes: [], reason: '未対応' };
    const settings = { ...DEFAULT_SNS_CTA, tiktok: { ...DEFAULT_SNS_CTA.tiktok, mode: 'template' as const } };
    expect(resolveSnsSubmission({ capability: cap, narrationMode: 'none', choice: 'tiktok', settings }).snsOutput?.targets).toEqual(['tiktok']);
  });
  it('buildSnsOutputRequest は選択肢の出力先と設定をそのまま使う', () => {
    expect(buildSnsOutputRequest('tiktok', DEFAULT_SNS_CTA)).toEqual({ version: 1, targets: ['tiktok'], cta: DEFAULT_SNS_CTA });
  });
});

describe('Worker の報告・結果の読み取り', () => {
  it('対応方式・CTA音声の報告は形が正しいものだけ', () => {
    expect(parseSnsCtaCapability({ version: 1, modes: ['none', 'x'], reason: 'r' })).toEqual({ version: 1, modes: ['none'], reason: 'r' });
    expect(parseSnsCtaCapability({ modes: [] })).toBeNull();
    expect(parseSnsCtaAudioReport({ inboxPath: '/x/_inbox', entries: [{ key: '59d1c4bc', durationSec: 1.9, importedAt: 't' }, { key: 'bad', durationSec: 1 }] })).toEqual({
      inboxPath: '/x/_inbox',
      entries: [{ key: '59d1c4bc', durationSec: 1.9, importedAt: 't' }],
    });
  });
  it('result.snsOutputs を読み、片方の失敗があってももう片方を返す', () => {
    const r = readSnsOutputsResult({
      snsOutputs: {
        version: 1,
        targets: ['instagram', 'tiktok'],
        results: { instagram: { status: 'PASS', url: 'https://x/final.mp4', sameAsFinal: true }, tiktok: { status: 'FAIL', error: '音声が未登録' } },
      },
    })!;
    expect(r.results.instagram?.status).toBe('PASS');
    expect(r.results.tiktok?.error).toBe('音声が未登録');
    expect(readSnsOutputsResult({})).toBeNull();
    expect(readSnsOutputsResult(null)).toBeNull();
  });
});
