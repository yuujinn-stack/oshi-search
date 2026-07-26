// クリップボードコピー・テキストファイル保存のブラウザ専用ユーティリティ。
// ChatGPT調査用プロンプトのコピー機能（work-check・vod-recheckの両方）で共有する。
// ブラウザAPI（navigator/document/window）専用のため、クライアントコンポーネントからのみ呼び出すこと。

// navigator.clipboard が使えない/権限で失敗する環境向けに、非表示textarea +
// document.execCommand('copy') へフォールバックする。
export async function copyTextWithFallback(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('clipboard API unavailable');
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadTextFile(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
