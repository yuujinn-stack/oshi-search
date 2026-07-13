import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSessionToken,
  verifySessionToken,
  validateSecretStrength,
  checkCsrfOrigin,
  SESSION_COOKIE,
} from '@/lib/session';

const SECRET32 = 'x'.repeat(32);
const SECRET33 = 'x'.repeat(33);
const SECRET31 = 'x'.repeat(31);

afterEach(() => { vi.restoreAllMocks(); });

// ── validateSecretStrength ───────────────────────────────────────────────────

describe('validateSecretStrength', () => {
  it('accepts 32-char secret', () => expect(validateSecretStrength(SECRET32)).toBe(true));
  it('accepts 33-char secret', () => expect(validateSecretStrength(SECRET33)).toBe(true));
  it('rejects 31-char secret', () => expect(validateSecretStrength(SECRET31)).toBe(false));
  it('rejects undefined',       () => expect(validateSecretStrength(undefined)).toBe(false));
  it('rejects empty string',    () => expect(validateSecretStrength('')).toBe(false));
});

// ── SESSION_COOKIE constant ──────────────────────────────────────────────────

describe('SESSION_COOKIE', () => {
  it('is the expected cookie name', () => expect(SESSION_COOKIE).toBe('admin-session'));
});

// ── createSessionToken / verifySessionToken ──────────────────────────────────

describe('createSessionToken + verifySessionToken', () => {
  it('creates a token that verifies successfully', async () => {
    const token = await createSessionToken(SECRET32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]+$/);
    const result = await verifySessionToken(token, SECRET32);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(typeof result.payload.iat).toBe('number');
      expect(typeof result.payload.exp).toBe('number');
      expect(typeof result.payload.nonce).toBe('string');
      expect(result.payload.exp).toBeGreaterThan(Date.now());
    }
  });

  it('rejects a token with a tampered signature', async () => {
    const token = await createSessionToken(SECRET32);
    const dotIdx = token.lastIndexOf('.');
    const tampered = token.slice(0, dotIdx + 1) + 'deadbeef' + token.slice(dotIdx + 9);
    const result = await verifySessionToken(tampered, SECRET32);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_signature');
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken(SECRET32);
    const result = await verifySessionToken(token, 'y'.repeat(32));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_signature');
  });

  it('rejects an expired token', async () => {
    const token = await createSessionToken(SECRET32);
    // Advance Date.now past the 8-hour expiry
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 9 * 60 * 60 * 1000);
    const result = await verifySessionToken(token, SECRET32);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('expired');
  });

  it('rejects a token with no dot separator', async () => {
    const result = await verifySessionToken('notokenatall', SECRET32);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toBe('invalid_format');
  });

  it('rejects a token with invalid base64 payload', async () => {
    const result = await verifySessionToken('!@#$.deadbeef', SECRET32);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(['invalid_format', 'invalid_payload', 'invalid_signature']).toContain(result.error);
    }
  });

  it('rejects a token with valid base64 but missing payload fields', async () => {
    const badPayload = btoa(JSON.stringify({ foo: 'bar' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const result = await verifySessionToken(`${badPayload}.deadbeef`, SECRET32);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(['invalid_payload', 'invalid_signature']).toContain(result.error);
    }
  });

  it('each token has a unique nonce', async () => {
    const t1 = await createSessionToken(SECRET32);
    const t2 = await createSessionToken(SECRET32);
    expect(t1).not.toBe(t2);
  });
});

// ── checkCsrfOrigin ──────────────────────────────────────────────────────────

describe('checkCsrfOrigin', () => {
  it('allows request with no Origin header (same-origin browser requests)', () => {
    expect(checkCsrfOrigin(null, 'example.com')).toBe(true);
  });

  it('allows request where Origin host matches Host', () => {
    expect(checkCsrfOrigin('https://example.com', 'example.com')).toBe(true);
  });

  it('allows request with port matching', () => {
    expect(checkCsrfOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  });

  it('rejects request where Origin host differs from Host', () => {
    expect(checkCsrfOrigin('https://evil.com', 'example.com')).toBe(false);
  });

  it('rejects request when hostHeader is null and originHeader is present', () => {
    expect(checkCsrfOrigin('https://example.com', null)).toBe(false);
  });

  it('rejects request with malformed Origin header', () => {
    expect(checkCsrfOrigin('not-a-url', 'example.com')).toBe(false);
  });

  it('rejects cross-origin subdomain attack', () => {
    expect(checkCsrfOrigin('https://evil.example.com', 'example.com')).toBe(false);
  });
});
