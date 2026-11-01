import { describe, expect, it } from 'vitest';
import { capcutAutoFileBase, capcutAutoState, type CapcutAutoEvent, type CapcutAutoVoicedJob } from '../video-capcut-auto-status';

const job = (over: Partial<CapcutAutoVoicedJob>): CapcutAutoVoicedJob => ({ id: 'v1', status: 'queued', createdAt: '2026-11-01T10:00:00Z', errorStep: null, errorMessage: null, progressLabel: null, ...over });
const ev = (over: Partial<CapcutAutoEvent>): CapcutAutoEvent => ({ status: 'detected', message: '', at: '2026-11-01T10:05:00Z', voicedJobId: null, ...over });

describe('CapCut 音声の自動取り込みの状況', () => {
  it('受信フォルダのファイル名は Worker の規則（人物slug__テンプレート__ジョブIDの先頭8桁）', () => {
    expect(capcutAutoFileBase({ id: 'ab12cd34-0000-4000-8000-000000000001', personSlug: 'p-0123456789ab', templateId: 'follow_three_works' })).toBe('p-0123456789ab__follow_three_works__ab12cd34');
    expect(capcutAutoFileBase({ id: 'ab12cd34', personSlug: null, templateId: 'follow_three_works' })).toBeNull();
  });

  it('音声付きのジョブが無ければ CapCut音声待ち。検知・エラーの出来事があればそれを出す', () => {
    expect(capcutAutoState([], []).stage).toBe('waiting');
    expect(capcutAutoState([], [ev({})]).stage).toBe('detected');
    expect(capcutAutoState([], [ev({ status: 'error', message: '別の人物の動画です' })])).toMatchObject({ stage: 'error', message: '別の人物の動画です' });
  });

  it('音声付きのジョブの状態: 生成待ち→反映の順番待ち、生成中→反映中、完了→完成、失敗→エラー（理由つき）', () => {
    expect(capcutAutoState([job({})], [ev({ status: 'attached', at: '2026-11-01T10:00:01Z' })]).stage).toBe('queued');
    expect(capcutAutoState([job({ status: 'processing', progressLabel: 'STEP 3/5' })], [])).toMatchObject({ stage: 'applying', message: 'STEP 3/5' });
    expect(capcutAutoState([job({ status: 'completed' })], []).stage).toBe('done');
    expect(capcutAutoState([job({ status: 'failed', errorStep: 'produce', errorMessage: '音声が長すぎます' })], [])).toMatchObject({ stage: 'error', message: '[produce] 音声が長すぎます' });
  });

  it('いちばん新しいものを使う（完成後に書き出し直してエラーになったらエラー、古いエラーの後に新しいジョブがあればジョブの状態）', () => {
    const done = job({ status: 'completed', createdAt: '2026-11-01T10:00:00Z' });
    expect(capcutAutoState([done], [ev({ status: 'error', message: 'x', at: '2026-11-01T11:00:00Z' })]).stage).toBe('error');
    expect(capcutAutoState([done], [ev({ status: 'error', message: 'x', at: '2026-11-01T09:00:00Z' })]).stage).toBe('done');
    expect(capcutAutoState([job({ id: 'old', status: 'failed', createdAt: '2026-11-01T08:00:00Z' }), job({ id: 'new', status: 'completed', createdAt: '2026-11-01T12:00:00Z' })], []).voicedJobId).toBe('new');
  });
});
