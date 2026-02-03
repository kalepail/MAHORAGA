/**
 * AES-256-GCM token encryption/decryption using Web Crypto API.
 *
 * - Key is derived from ENCRYPTION_KEY via HKDF (SHA-256)
 * - trader_id is used as additional authenticated data (AAD),
 *   binding the ciphertext to a specific trader
 * - Output format: base64(iv || ciphertext || tag)
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96-bit IV per NIST recommendation

async function deriveKey(encryptionKey: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(encryptionKey),
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("mahoraga-token-encryption"),
      info: new TextEncoder().encode("aes-256-gcm"),
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptToken(
  plaintext: string,
  encryptionKey: string,
  traderId: string
): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const aad = new TextEncoder().encode(traderId);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: aad },
    key,
    new TextEncoder().encode(plaintext)
  );

  // Concatenate IV + ciphertext (GCM tag is appended by the browser)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptToken(
  encoded: string,
  encryptionKey: string,
  traderId: string
): Promise<string> {
  const key = await deriveKey(encryptionKey);
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const aad = new TextEncoder().encode(traderId);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, additionalData: aad },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}
