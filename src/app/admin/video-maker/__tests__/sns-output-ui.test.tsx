import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SnsOutputsSection from '../SnsOutputsSection';
import SnsOutputPicker from '../SnsOutputPicker';
import { DEFAULT_SNS_CTA, snsCtaAudioKey } from '@/lib/video-sns-output';

// 管理画面の SNS別の表示（サーバー側の描画で、表示する内容・ボタン・エラーを確認する。クリック後の動きはブラウザで確認）
const job = (snsOutputs: unknown) => ({ id: 'j1', personName: '目黒 蓮', templateId: 'oshi-sonkamo-v1', result: { snsOutputs } });
const FINAL = 'https://blob.test/video-jobs/j1/final.mp4';
const TIKTOK = 'https://blob.test/video-jobs/j1/sns-tiktok.mp4';

describe('SnsOutputsSection（完了ジョブの SNS別の動画）', () => {
  it('両方成功: SNS ごとにプレビュー・ダウンロード・SRT、まとめてダウンロード', () => {
    const html = renderToStaticMarkup(
      <SnsOutputsSection
        job={job({
          version: 1,
          targets: ['instagram', 'tiktok'],
          results: {
            instagram: { status: 'PASS', ctaMode: 'template', sameAsFinal: true, url: FINAL, durationSec: 19.1, srt: '1\n00:00:00,000 --> 00:00:01,000\nA\n', ctaAudio: 'template' },
            tiktok: { status: 'PASS', ctaMode: 'search', sameAsFinal: false, url: TIKTOK, durationSec: 18.2, ctaStartSec: 14.6, ctaDurationSec: 3.5, ctaAudio: 'capcut', narration: '気になったら、推しサーチで検索！', srt: '1\n00:00:00,000 --> 00:00:01,000\nB\n' },
          },
        })}
      />,
    );
    expect(html).toContain(`src="${FINAL}"`);
    expect(html).toContain(`src="${TIKTOK}"`);
    expect(html).toContain('Instagram版をダウンロード');
    expect(html).toContain('TikTok版をダウンロード');
    expect(html.match(/⬇ SRT/g)).toHaveLength(2);
    expect(html).toContain('両方をまとめてダウンロード');
    expect(html).toContain('検索窓CTA「気になったら、推しサーチで検索！」');
    expect(html).toContain('14.6秒からCTA 3.5秒');
    // プレビューは開くまで動画全体を読み込まない
    expect(html.match(/preload="metadata"/g)).toHaveLength(2);
  });

  it('片方失敗: 成功した方はそのまま使え、失敗した方は理由を表示（まとめてダウンロードは出さない）', () => {
    const html = renderToStaticMarkup(
      <SnsOutputsSection
        job={job({
          version: 1,
          targets: ['instagram', 'tiktok'],
          results: {
            instagram: { status: 'PASS', ctaMode: 'template', sameAsFinal: true, url: FINAL },
            tiktok: { status: 'FAIL', ctaMode: 'search', url: null, error: 'CTAナレーションの CapCut 音声が未登録です' },
          },
        })}
      />,
    );
    expect(html).toContain('Instagram版をダウンロード');
    expect(html).toContain('CTAナレーションの CapCut 音声が未登録です');
    expect(html).not.toContain('TikTok版をダウンロード');
    expect(html).not.toContain('まとめてダウンロード');
  });

  it('SRT を出力しないテンプレートは「SRTなし」と表示する', () => {
    const html = renderToStaticMarkup(
      <SnsOutputsSection job={job({ version: 1, targets: ['tiktok'], results: { tiktok: { status: 'PASS', ctaMode: 'search', url: TIKTOK, srt: null } } })} />,
    );
    expect(html).toContain('SRTなし');
    expect(html).not.toContain('⬇ SRT');
  });

  it('出力先SNSを指定していない従来のジョブには何も表示しない', () => {
    expect(renderToStaticMarkup(<SnsOutputsSection job={{ id: 'j', personName: 'a', templateId: 't', result: { templateId: 't' } }} />)).toBe('');
    expect(renderToStaticMarkup(<SnsOutputsSection job={{ id: 'j', personName: 'a', templateId: 't', result: null }} />)).toBe('');
  });
});

describe('SnsOutputPicker（出力先SNS）', () => {
  const base = {
    choice: 'both' as const,
    onChoice: () => {},
    settings: DEFAULT_SNS_CTA,
    onSettings: () => {},
    savedSettings: DEFAULT_SNS_CTA,
    onSaved: () => {},
    storage: true,
  };
  it('3つの選択肢を出し、初期値の両方が選ばれている', () => {
    const html = renderToStaticMarkup(<SnsOutputPicker {...base} capability={{ version: 1, modes: ['none', 'capcut'], reason: null }} narrationMode="none" audio={null} />);
    expect(html).toContain('Instagramのみ');
    expect(html).toContain('TikTokのみ');
    expect(html).toContain('Instagram ＋ TikTok（両方）');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/checked=""\/>Instagram ＋ TikTok（両方）/);
  });

  it('CapCut 音声の動画で CTA 音声が未登録なら、読み・ファイル名・受信フォルダを表示する', () => {
    const html = renderToStaticMarkup(
      <SnsOutputPicker {...base} capability={{ version: 1, modes: ['none', 'capcut'], reason: null }} narrationMode="capcut" audio={{ inboxPath: '/x/sns-cta/_inbox', entries: [] }} />,
    );
    expect(html).toContain('CapCut 音声が未登録');
    expect(html).toContain(`sns-cta__${snsCtaAudioKey(DEFAULT_SNS_CTA.tiktok.narration)}.wav`);
    expect(html).toContain('きになったら、おしサーチでけんさく！');
    expect(html).toContain('/x/sns-cta/_inbox');
  });

  it('登録済みなら登録済みと表示する', () => {
    const key = snsCtaAudioKey(DEFAULT_SNS_CTA.tiktok.narration);
    const html = renderToStaticMarkup(
      <SnsOutputPicker {...base} capability={{ version: 1, modes: ['none', 'capcut'], reason: null }} narrationMode="capcut" audio={{ inboxPath: null, entries: [{ key, durationSec: 1.92, importedAt: 't' }] }} />,
    );
    expect(html).toContain('登録済みです（1.92秒）');
  });

  it('未対応のテンプレート: 両方なら Instagram 版だけになる旨、TikTok のみなら作れない旨を表示する', () => {
    const cap = { version: 1 as const, modes: [], reason: 'ストーリーズ用のテンプレートのため対象外です。' };
    expect(renderToStaticMarkup(<SnsOutputPicker {...base} capability={cap} narrationMode="none" audio={null} />)).toContain('Instagram版だけを作ります');
    expect(renderToStaticMarkup(<SnsOutputPicker {...base} choice="tiktok" capability={cap} narrationMode="none" audio={null} />)).toContain('出力先SNSを変えてください');
  });
});
