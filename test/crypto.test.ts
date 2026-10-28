import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, randomSecret, sha256Hex } from '../src/security/crypto';

describe('OAuth secret primitives', () => {
  it('round trips AES-GCM ciphertext bound to its AAD', async () => {
    const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const encrypted=await encryptSecret('refresh-token',key,'provider-account:u1:g1');
    await expect(decryptSecret(encrypted,key,'provider-account:u1:g1')).resolves.toBe('refresh-token');
    await expect(decryptSecret(encrypted,key,'provider-account:u2:g1')).rejects.toThrow();
  });
  it('generates unpredictable values and stable SHA-256 hashes', async () => {
    expect(randomSecret()).not.toBe(randomSecret());
    expect(await sha256Hex('state')).toHaveLength(64);
  });
});
