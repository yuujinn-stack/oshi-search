// HMAC-SHA256 signed session tokens.
// Works in both Edge (middleware) and Node.js (API routes).
// crypto.subtle is available in both environments (Node 18+, Edge).

export const SESSION_COOKIE = 'admin-session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours
const MIN_SECRET_LENGTH = 32;

export interface SessionPayload {
  iat: number; // issued at (ms)
  exp: number; // expires at (ms)
  nonce: string; // 32-char hex random
}

export type SessionError = 'invalid_format' | 'invalid_payload' | 'invalid_signature' | 'expired';

export type SessionResult =
  | { valid: true; payload: SessionPayload }
  | { valid: false; error: SessionError };

// ── Encoding helpers ──────────────────────────────────────────────────────────

function b64url(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const mod4 = padded.length % 4;
  return atob(mod4 === 0 ? padded : padded + '='.repeat(4 - mod4));
}

function uint8ToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function importHMACKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

function randomNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return uint8ToHex(arr);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function validateSecretStrength(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH;
}

export async function createSessionToken(secret: string): Promise<string> {
  const now = Date.now();
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_DURATION_MS,
    nonce: randomNonce(),
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const key = await importHMACKey(secret, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigHex = uint8ToHex(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigHex}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionResult> {
  const dotIdx = token.indexOf('.');
  if (dotIdx < 1 || dotIdx === token.length - 1) {
    return { valid: false, error: 'invalid_format' };
  }

  const payloadB64 = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);

  let payload: unknown;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return { valid: false, error: 'invalid_payload' };
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as Record<string, unknown>).iat !== 'number' ||
    typeof (payload as Record<string, unknown>).exp !== 'number' ||
    typeof (payload as Record<string, unknown>).nonce !== 'string'
  ) {
    return { valid: false, error: 'invalid_payload' };
  }
  const sess = payload as SessionPayload;

  // Verify HMAC signature (constant-time via crypto.subtle.verify)
  const sigBytes = hexToUint8(sigHex);
  if (!sigBytes) return { valid: false, error: 'invalid_signature' };

  let sigValid: boolean;
  try {
    const key = await importHMACKey(secret, ['verify']);
    sigValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(payloadB64),
    );
  } catch {
    return { valid: false, error: 'invalid_signature' };
  }

  if (!sigValid) return { valid: false, error: 'invalid_signature' };

  // Check expiry after signature (prevents timing leak on exp)
  if (Date.now() > sess.exp) return { valid: false, error: 'expired' };

  return { valid: true, payload: sess };
}

// ── CSRF origin check (pure, testable) ───────────────────────────────────────

export function checkCsrfOrigin(originHeader: string | null, hostHeader: string | null): boolean {
  if (!originHeader) return true; // No Origin = same-origin browser request or non-browser
  if (!hostHeader) return false;
  try {
    const originUrl = new URL(originHeader);
    return originUrl.host === hostHeader;
  } catch {
    return false;
  }
}
