'use client';
import { useState } from 'react';

interface Props {
  className?: string;
  children?: React.ReactNode;
}

// Replaces <a href="/api/admin/logout"> GET links.
// Uses fetch POST so the proxy's CSRF check passes and the Set-Cookie is applied.
export function LogoutButton({ className, children = 'ログアウト' }: Props) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch('/api/admin/logout', {
        method: 'POST',
        credentials: 'include',
      });
      console.log(
        '[logout] status:', res.status,
        'debug:', res.headers.get('x-logout-debug') ?? 'none',
      );
      if (res.ok) {
        window.location.href = '/admin/login';
        return;
      }
      window.alert(`ログアウトに失敗しました (${res.status})。再試行してください。`);
    } catch {
      window.alert('ネットワークエラーが発生しました。再試行してください。');
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={className}
    >
      {pending ? 'ログアウト中...' : children}
    </button>
  );
}
