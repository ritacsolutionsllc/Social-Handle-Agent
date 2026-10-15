import { createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialVault, type SealedSecret } from '../src/vault';

/** Unwrap a sealed DEK with the KEK (test-only) to inspect the data key itself. */
function unwrapDek(kekBase64: string, s: SealedSecret): Buffer {
  const d = createDecipheriv('aes-256-gcm', Buffer.from(kekBase64, 'base64'), s.wrappedDek.subarray(0, 12));
  d.setAuthTag(s.wrappedDek.subarray(12, 28));
  return Buffer.concat([d.update(s.wrappedDek.subarray(28)), d.final()]);
}

describe('CredentialVault (envelope encryption)', () => {
  const key = randomBytes(32).toString('base64');
  const ctxA = 'ws-a:reddit:oauth';

  it('round-trips and never stores plaintext', () => {
    const v = new CredentialVault(key);
    const s = v.seal('oauth-token-123', ctxA);
    expect(v.open(s, ctxA)).toBe('oauth-token-123');
    expect(s.ciphertext.toString('utf8')).not.toContain('oauth-token');
  });

  it('uses a fresh data key (DEK) for every secret', () => {
    const v = new CredentialVault(key);
    const a = v.seal('same', ctxA);
    const b = v.seal('same', ctxA);
    const dekA = unwrapDek(key, a);
    const dekB = unwrapDek(key, b);
    expect(dekA).toHaveLength(32);
    expect(dekA.equals(dekB)).toBe(false);
  });

  it('binds the secret to its record: moved sealed fields fail to open', () => {
    const v = new CredentialVault(key);
    const s = v.seal('workspace-a-token', ctxA);
    expect(() => v.open(s, 'ws-b:reddit:oauth')).toThrow();
  });

  it('detects tampering and wrong keys', () => {
    const v = new CredentialVault(key);
    const s = v.seal('secret', ctxA);
    s.ciphertext[0]! ^= 0xff;
    expect(() => v.open(s, ctxA)).toThrow();
    expect(() => new CredentialVault(randomBytes(32).toString('base64')).open(v.seal('x', ctxA), ctxA)).toThrow();
  });

  it('rejects malformed master keys, including off-by-one lengths', () => {
    expect(() => new CredentialVault('short')).toThrow(/32 bytes/);
    expect(() => new CredentialVault('')).toThrow(/32 bytes/);
    expect(() => new CredentialVault(randomBytes(31).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new CredentialVault(randomBytes(33).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new CredentialVault(randomBytes(32).toString('base64'))).not.toThrow();
  });

  it('handles an empty secret and an empty context', () => {
    const v = new CredentialVault(key);
    expect(v.open(v.seal('', ctxA), ctxA)).toBe('');
    expect(v.open(v.seal('token', ''), '')).toBe('token');
    expect(() => v.open(v.seal('token', ''), ctxA)).toThrow(); // empty context is still bound
  });

  it('refuses secrets sealed under another key version', () => {
    const s = new CredentialVault(key, 1).seal('x', ctxA);
    expect(() => new CredentialVault(key, 2).open(s, ctxA)).toThrow(/version/);
  });
});
