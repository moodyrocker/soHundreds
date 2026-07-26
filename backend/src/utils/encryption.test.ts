import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, isLegacyCiphertext, reencrypt } from './encryption.js';

/**
 * These tests protect stored OAuth credentials.
 *
 * `mcp_connections.credentials_encrypted` holds Shopify admin tokens, Meta ad
 * account access and Instagram publishing rights. If the versioning change
 * introduced with the `v1:` prefix had broken backward compatibility, every
 * existing integration would have silently stopped working with no way to
 * recover the plaintext.
 *
 * `legacyEncrypt` below reproduces exactly what the pre-versioning code wrote, so
 * the compatibility guarantee is tested against real old-format output rather
 * than an assumption about it.
 */

const HEX_KEY_A = 'a'.repeat(64);
const HEX_KEY_B = 'b'.repeat(64);
const PASSPHRASE_KEY = 'a-passphrase-that-is-not-hex';
const SECRET = 'fake-credential-for-tests-do-not-use';

/** Byte-for-byte what the original implementation produced: no version prefix. */
function legacyEncrypt(plaintext: string, rawKey: string): string {
  const key =
    rawKey.length === 64 && /^[0-9a-f]+$/i.test(rawKey)
      ? Buffer.from(rawKey, 'hex')
      : scryptSync(rawKey, 'seo-hundreds-salt', 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = HEX_KEY_A;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});

describe('backward compatibility with pre-versioning ciphertext', () => {
  it('decrypts a legacy value written with a hex key', () => {
    // The single most important assertion in this file.
    expect(decrypt(legacyEncrypt(SECRET, HEX_KEY_A))).toBe(SECRET);
  });

  it('decrypts a legacy value written with a passphrase key', () => {
    process.env.ENCRYPTION_KEY = PASSPHRASE_KEY;
    expect(decrypt(legacyEncrypt(SECRET, PASSPHRASE_KEY))).toBe(SECRET);
  });

  it('identifies legacy ciphertext as needing an upgrade', () => {
    expect(isLegacyCiphertext(legacyEncrypt(SECRET, HEX_KEY_A))).toBe(true);
  });

  it('does not flag current-format ciphertext as legacy', () => {
    expect(isLegacyCiphertext(encrypt(SECRET))).toBe(false);
  });

  it('tolerates surrounding whitespace on a stored value', () => {
    expect(decrypt(`  ${legacyEncrypt(SECRET, HEX_KEY_A)}  `)).toBe(SECRET);
  });
});

describe('round trip', () => {
  it('encrypts and decrypts', () => {
    expect(decrypt(encrypt(SECRET))).toBe(SECRET);
  });

  it('prefixes new ciphertext with the version', () => {
    expect(encrypt(SECRET).startsWith('v1:')).toBe(true);
  });

  it('uses a fresh IV each time, so identical plaintext differs', () => {
    // A reused IV under GCM is catastrophic; this catches an accidental constant.
    expect(encrypt(SECRET)).not.toBe(encrypt(SECRET));
  });

  it('handles an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('handles unicode and emoji', () => {
    const value = 'naïve café 東京 🎉';
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('handles a realistic multi-kilobyte credential blob', () => {
    const value = JSON.stringify({ token: 'x'.repeat(4000), scopes: ['a', 'b'] });
    expect(decrypt(encrypt(value))).toBe(value);
  });

  it('works with a passphrase key as well as a hex key', () => {
    process.env.ENCRYPTION_KEY = PASSPHRASE_KEY;
    expect(decrypt(encrypt(SECRET))).toBe(SECRET);
  });
});

describe('key rotation', () => {
  it('fails to read an old value after rotation without ENCRYPTION_KEY_PREVIOUS', () => {
    const written = encrypt(SECRET);
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    expect(() => decrypt(written)).toThrow(/does not match|ENCRYPTION_KEY_PREVIOUS/);
  });

  it('reads an old value when ENCRYPTION_KEY_PREVIOUS is set', () => {
    const written = encrypt(SECRET);
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = HEX_KEY_A;
    expect(decrypt(written)).toBe(SECRET);
  });

  it('writes with the current key during rotation, not the previous one', () => {
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = HEX_KEY_A;
    const written = encrypt(SECRET);

    // Drop the previous key: the value must still be readable, proving it was
    // written with the new key.
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decrypt(written)).toBe(SECRET);
  });

  it('reencrypt upgrades a legacy value onto the current key', () => {
    const legacy = legacyEncrypt(SECRET, HEX_KEY_A);
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    process.env.ENCRYPTION_KEY_PREVIOUS = HEX_KEY_A;

    const upgraded = reencrypt(legacy);
    expect(upgraded.startsWith('v1:')).toBe(true);

    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    expect(decrypt(upgraded)).toBe(SECRET);
  });

  it('reencrypt is safe to run on an already-current value', () => {
    expect(decrypt(reencrypt(encrypt(SECRET)))).toBe(SECRET);
  });
});

describe('integrity and error handling', () => {
  it('rejects tampered ciphertext via the GCM auth tag', () => {
    const good = encrypt(SECRET);
    const raw = Buffer.from(good.slice(3), 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(() => decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('rejects a tampered auth tag', () => {
    const good = encrypt(SECRET);
    const raw = Buffer.from(good.slice(3), 'base64');
    raw[13] ^= 0xff; // inside the auth tag
    expect(() => decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('rejects an unknown future version rather than guessing', () => {
    expect(() => decrypt(`v9:${encrypt(SECRET).slice(3)}`)).toThrow(/not supported/);
  });

  it('rejects a payload too short to contain IV and tag', () => {
    expect(() => decrypt('v1:AAAA')).toThrow(/too short/);
  });

  it('rejects empty input', () => {
    expect(() => decrypt('')).toThrow();
  });

  it('throws a message that names the fix when the key is wrong', () => {
    // Operator-facing: this is what appears in the log when integrations break.
    const written = encrypt(SECRET);
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    expect(() => decrypt(written)).toThrow(/ENCRYPTION_KEY_PREVIOUS/);
  });

  it('throws when ENCRYPTION_KEY is absent', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/required/);
    expect(() => decrypt('v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toThrow(/required/);
  });

  it('does not leak the plaintext in an error message', () => {
    const written = encrypt(SECRET);
    process.env.ENCRYPTION_KEY = HEX_KEY_B;
    try {
      decrypt(written);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(SECRET);
    }
  });
});
