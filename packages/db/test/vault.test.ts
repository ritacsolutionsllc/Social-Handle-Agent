import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialVault } from '../src/vault';

describe('CredentialVault (envelope encryption)', () => {
  const key = randomBytes(32).toString('base64');
  it('round-trips and uses a fresh data key per secret', () => {
    const v = new CredentialVault(key);
    const a = v.seal('oauth-token-123');
    const b = v.seal('oauth-token-123');
    expect(v.open(a)).toBe('oauth-token-123');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.ciphertext.toString('utf8')).not.toContain('oauth-token');
  });
  it('detects tampering and wrong keys', () => {
    const v = new CredentialVault(key);
    const s = v.seal('secret');
    s.ciphertext[0]! ^= 0xff;
    expect(() => v.open(s)).toThrow();
    expect(() => new CredentialVault(randomBytes(32).toString('base64')).open(v.seal('x'))).toThrow();
  });
  it('rejects malformed master keys', () => {
    expect(() => new CredentialVault('short')).toThrow(/32 bytes/);
  });
});
