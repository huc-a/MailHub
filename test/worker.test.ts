import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/worker';

const env = (overrides: Partial<Env> = {}) => ({
  APP_ENV: 'production', MAIL_DOMAIN: 'mail.test', MAIL_OBJECTS: {},
  ASSETS: { fetch: async () => new Response() }, DB: { prepare: () => { throw new Error('DB should not be accessed'); } },
  ...overrides,
}) as Env;

describe('Worker API foundation', () => {
  it('returns private JSON health without requiring identity', async () => {
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/health'), env());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ ok: true, service: 'mailhub' });
  });
  it('fails closed for private APIs without an Access assertion', async () => {
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/mailboxes'), env());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });
  it('does not authorize local identity unless explicitly enabled in local mode', async () => {
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/me', { headers: { 'X-MailHub-Local-Subject': 'attacker' } }), env({ APP_ENV: 'production', ALLOW_LOCAL_AUTH: 'true' }));
    expect(response.status).toBe(401);
  });
});
