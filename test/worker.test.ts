import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/worker';

describe('Worker API foundation', () => {
  it('returns a private JSON health response', async () => {
    const env = {
      APP_ENV: 'test', MAIL_DOMAIN: 'mail.test', MAIL_OBJECTS: {},
      ASSETS: { fetch: async () => new Response() }, DB: { prepare: () => { throw new Error('unused'); } },
    } as Env;
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/health'), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ ok: true, service: 'mailhub' });
  });
});

