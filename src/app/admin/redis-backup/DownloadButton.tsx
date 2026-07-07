'use client';

import { useState } from 'react';

export default function DownloadButton() {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleDownload() {
    setState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/admin/redis-backup');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `redis-backup-${ts}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={state === 'loading'}
        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {state === 'loading' ? '取得中...' : 'JSONをダウンロード'}
      </button>
      {state === 'error' && (
        <p className="mt-2 text-sm text-red-600 font-medium">エラー: {errorMsg}</p>
      )}
    </div>
  );
}
