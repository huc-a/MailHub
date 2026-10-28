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
  it('rejects cross-origin mailbox writes before making a mutation', async () => {
    let writes = 0;
    const db = { prepare: (sql: string) => ({ bind: () => ({ first: async () => ({ id: 'owner-1' }), all: async () => ({ results: [] }), run: async () => { writes++; return { meta: { changes: 1 } }; } }) }), batch: async () => { writes++; return []; } };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/mailboxes', { method: 'POST', headers: { Origin: 'https://attacker.test', 'Content-Type': 'application/json', 'X-MailHub-Local-Subject': 'owner' }, body: '{}' }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(403);
    expect(writes).toBe(0);
  });
  it('returns only ready email rows from the owner scoped query', async () => {
    let bindValues: unknown[] = [];
    const db = { prepare: () => ({ bind: (...values: unknown[]) => { bindValues = values; return { first: async () => ({ id: 'owner-1' }), all: async () => ({ results: [{ id: 'mail-1', subject: 'Hello', receivedAt: 10 }] }), run: async () => ({ meta: { changes: 0 } }) }; } }), batch: async () => [] };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(200);
    expect(bindValues[0]).toBe('owner-1');
    expect(await response.json()).toMatchObject({ emails: [{ id: 'mail-1' }] });
  });
});
