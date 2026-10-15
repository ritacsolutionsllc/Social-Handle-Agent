import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for platform credentials (e.g. future OAuth tokens).
 * Each secret gets a fresh 256-bit data key (DEK); the DEK is wrapped with the
 * key-encryption key (KEK) from CREDENTIAL_MASTER_KEY. Swap `wrap/unwrap` for a
 * KMS (AWS KMS, GCP KMS, Vault transit) in production without changing callers.
 */

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  keyVersion: number;
}

const ALG = 'aes-256-gcm';

function gcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv(ALG, key, iv);
  if (aad) c.setAAD(aad);
  const ciphertext = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv, ciphertext, authTag: c.getAuthTag() };
}

function gcmDecrypt(key: Buffer, iv: Buffer, ciphertext: Buffer, authTag: Buffer, aad?: Buffer) {
  const d = createDecipheriv(ALG, key, iv);
  if (aad) d.setAAD(aad);
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

export class CredentialVault {
  private readonly kek: Buffer;

  /** @param masterKeyBase64 32 random bytes, base64 (openssl rand -base64 32). */
  constructor(masterKeyBase64: string, private readonly keyVersion = 1) {
    const k = Buffer.from(masterKeyBase64, 'base64');
    if (k.length !== 32) throw new Error('CREDENTIAL_MASTER_KEY must be 32 bytes, base64-encoded');
    this.kek = k;
  }

  /**
   * @param context identity the secret belongs to, e.g. `${workspaceId}:${platform}:${label}`.
   * Bound as GCM associated data: moving sealed fields to another row makes open() fail.
   */
  seal(plaintext: string, context: string): SealedSecret {
    const dek = randomBytes(32);
    const data = gcmEncrypt(dek, Buffer.from(plaintext, 'utf8'), Buffer.from(context, 'utf8'));
    const wrapped = gcmEncrypt(this.kek, dek);
    dek.fill(0);
    return {
      ciphertext: data.ciphertext,
      iv: data.iv,
      authTag: data.authTag,
      // wrapped DEK layout: iv(12) | tag(16) | ciphertext(32)
      wrappedDek: Buffer.concat([wrapped.iv, wrapped.authTag, wrapped.ciphertext]),
      keyVersion: this.keyVersion,
    };
  }

  open(s: SealedSecret, context: string): string {
    if (s.keyVersion !== this.keyVersion) throw new Error(`no key for version ${s.keyVersion}`);
    const dek = gcmDecrypt(this.kek, s.wrappedDek.subarray(0, 12), s.wrappedDek.subarray(28), s.wrappedDek.subarray(12, 28));
    try {
      return gcmDecrypt(dek, s.iv, s.ciphertext, s.authTag, Buffer.from(context, 'utf8')).toString('utf8');
    } finally {
      dek.fill(0);
    }
  }
}
