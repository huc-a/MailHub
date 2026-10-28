import { describe, expect, it } from 'vitest';
import { MIME_LIMITS, parseMime } from '../src/ingestion/mime';

describe('bounded MIME parser', () => {
  it('parses UTF-8 headers and extracts body metadata and OTP candidates', async () => {
    const raw = new TextEncoder().encode('From: Alice <alice@example.net>\r\nTo: temp@mail.test\r\nSubject: =?UTF-8?B?5rWL6K+V?=\r\nMessage-ID: <m1@example.net>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 482913. 20261028 is a date.');
    const parsed = await parseMime(raw, 'temp@mail.test');
    expect(parsed.subject).toBe('测试');
    expect(parsed.from).toBe('alice@example.net');
    expect(parsed.otpCandidates).toContain('482913');
    expect(parsed.snippet).toContain('482913');
  });
  it('rejects raw messages over the configured ceiling', async () => {
    await expect(parseMime(new Uint8Array(MIME_LIMITS.raw + 1), 'temp@mail.test')).rejects.toThrow('RAW_MESSAGE_TOO_LARGE');
  });
});
