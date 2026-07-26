import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Credential encryption (AES-256-GCM).
 *
 * The algorithm was already correct — random IV, auth tag verified on decrypt.
 * What was missing was any way to rotate the key. Ciphertext carried no version
 * marker, so changing ENCRYPTION_KEY made every stored OAuth credential
 * permanently undecryptable, with no migration path and no signal beyond
 * integrations mysteriously failing.
 *
 * Format
 * ------
 *   new:     v1:<base64(iv | authTag | ciphertext)>
 *   legacy:  <base64(iv | authTag | ciphertext)>       (no prefix)
 *
 * Legacy values decrypt unchanged, so no data migration is required. Anything
 * written from now on carries the prefix, and re-saving a credential upgrades it
 * in place.
 *
 * Rotating the key
 * ----------------
 *   1. Set ENCRYPTION_KEY_PREVIOUS to the current key.
 *   2. Set ENCRYPTION_KEY to the new one.
 *   3. Deploy. Reads try the current key then the previous one; writes always use
 *      the current key, so anything re-saved is upgraded.
 *   4. Once everything has been re-saved, drop ENCRYPTION_KEY_PREVIOUS.
 *
 * `reencrypt()` exists for a backfill that walks
 * mcp_connections.credentials_encrypted and rewrites each row.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_VERSION = 'v1';

/** Unchanged, so keys derived before versioning still work. */
const SCRYPT_SALT = 'seo-hundreds-salt';

function deriveKey(raw: string): Buffer {
  // A 64-char hex string is used directly as 32 raw bytes; anything else is
  // stretched with scrypt. Both shapes behave exactly as before.
  if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return scryptSync(raw, SCRYPT_SALT, 32);
}

function currentKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is required');
  }
  return deriveKey(raw);
}

/** Keys to attempt on decrypt, current first. */
function decryptionKeys(): Buffer[] {
  const keys = [currentKey()];
  const previous = process.env.ENCRYPTION_KEY_PREVIOUS?.trim();
  if (previous) keys.push(deriveKey(previous));
  return keys;
}

function splitPayload(b64: string): { iv: Buffer; authTag: Buffer; body: Buffer } {
  const data = Buffer.from(b64, 'base64');
  if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be valid');
  }
  return {
    iv: data.subarray(0, IV_LENGTH),
    authTag: data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH),
    body: data.subarray(IV_LENGTH + AUTH_TAG_LENGTH),
  };
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, currentKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `${CURRENT_VERSION}:${payload}`;
}

export function decrypt(ciphertext: string): string {
  const trimmed = ciphertext.trim();

  // Only split on a recognised version prefix — base64 never contains ':', but
  // being explicit avoids mangling unexpected input.
  const match = /^(v\d+):([\s\S]*)$/.exec(trimmed);
  const version = match ? match[1]! : null;
  const payload = match ? match[2]! : trimmed;

  if (version && version !== CURRENT_VERSION) {
    throw new Error(
      `Ciphertext version ${version} is not supported by this build (expected ${CURRENT_VERSION})`
    );
  }

  const { iv, authTag, body } = splitPayload(payload);

  let lastError: unknown;
  for (const key of decryptionKeys()) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch (err) {
      // A GCM auth failure means the wrong key (or tampering). Try the previous
      // key before giving up.
      lastError = err;
    }
  }

  throw new Error(
    'Failed to decrypt credential — ENCRYPTION_KEY does not match the value it was written with. ' +
      'If the key was rotated, set ENCRYPTION_KEY_PREVIOUS to the old key. ' +
      (lastError instanceof Error ? `(${lastError.message})` : '')
  );
}

/** True when the value still needs upgrading to the current format. */
export function isLegacyCiphertext(ciphertext: string): boolean {
  return !/^v\d+:/.test(ciphertext.trim());
}

/**
 * Decrypts with any accepted key and re-encrypts with the current one.
 * For a rotation backfill.
 */
export function reencrypt(ciphertext: string): string {
  return encrypt(decrypt(ciphertext));
}
