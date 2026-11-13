import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import OshiCardWaiting, { OSHI_CARD_WAIT_DONE_MESSAGE } from '@/components/oshi-card/OshiCardWaiting';
import type { OshiCardVariant } from '@/lib/oshi-card/params';

const noop = () => {};
const render = (variant: OshiCardVariant, extra: { done?: boolean; error?: 'failed' | null } = {}) =>
  renderToStaticMarkup(<OshiCardWaiting person="賀喜遥香" variant={variant} startedAt={Date.now()} mode="overlay" onRetry={noop} onBack={noop} {...extra} />);

describe('OshiCardWaiting（作成画面の待機表示）', () => {
  for (const v of ['cool', 'cute', 'basic', 'ssr'] as const) {
    it(`${v}: 生成中は「編集に戻る」を出し、完成後（移動中）は「完成しました」にして出さない`, () => {
      const waiting = render(v);
      expect(waiting).toContain('data-state="waiting"');
      expect(waiting).toContain('oc-wait-back-btn');
      expect(waiting).not.toContain(OSHI_CARD_WAIT_DONE_MESSAGE);

      const done = render(v, { done: true });
      expect(done).toContain('data-state="done"');
      expect(done).toContain(OSHI_CARD_WAIT_DONE_MESSAGE);
      expect(done).not.toContain('oc-wait-back-btn');
      expect(done).toContain('class="oc-wait-back"'); // 高さを保つ枠は残す
      expect(done).not.toContain('もう一度ためす');
    });
  }

  it('エラーのときは再試行と「編集に戻る」を出す', () => {
    const html = render('ssr', { error: 'failed' });
    expect(html).toContain('もう一度ためす');
    expect(html).toContain('編集に戻る');
    expect(html).not.toContain(OSHI_CARD_WAIT_DONE_MESSAGE);
  });
});
