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
  it('stages and stores an accepted inbound message before making it ready', async () => {
    const statements: string[] = [], objects: string[] = [];
    const db = {
      prepare: (sql: string) => ({ bind: (..._values: unknown[]) => ({
        first: async <T,>() => (sql.includes('FROM mailboxes WHERE address=') ? { id: 'mb-1', user_id: 'owner-1', generation: 0 } : null) as T | null,
        all: async <T,>() => ({ results: [] as T[] }),
        run: async () => { statements.push(sql); return { meta: { changes: 1 } }; },
      }) }),
      batch: async (_batch: unknown[]) => { statements.push('staged-batch'); return []; },
    };
    const raw = new TextEncoder().encode('From: sender@example.net\r\nTo: temp@mail.test\r\nSubject: Test\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 123456');
    await worker.email({ to: 'temp@mail.test', raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close(); } }), rawSize: raw.byteLength, setReject: reason => { throw new Error(reason); } }, env({ DB: db as unknown as Env['DB'], MAIL_OBJECTS: { put: async (key: string) => { objects.push(key); } } as unknown as Env['MAIL_OBJECTS'] }));
    expect(objects).toHaveLength(1);
    expect(statements.some(sql => sql.includes("SET ingest_status='ready'"))).toBe(true);
  });
  it('runs cleanup jobs under a lease and removes R2 objects before metadata', async () => {
    const sqls: string[] = [], deleted: string[] = [];
    const db = {
      prepare: (sql: string) => ({ bind: (..._values: unknown[]) => ({
        first: async <T,>() => null as T | null,
        all: async <T,>() => ({ results: (sql.includes('FROM mailboxes WHERE status=') ? [] : sql.includes("FROM jobs WHERE kind='cleanup_mailbox'") ? [{ id:'job-1',user_id:'owner-1',target_id:'box-1',attempts:0,max_attempts:5 }] : sql.includes('FROM mail_objects mo JOIN emails') ? [{id:'obj-1',objectKey:'mail/box-1/message-1/text'}] : []) as T[] }),
        run: async () => { sqls.push(sql); return { meta: { changes: sql.includes('UPDATE jobs SET status=\'running\'') ? 1 : 0 } }; },
      }) }),
      batch: async (statements: unknown[]) => { sqls.push('cleanup-batch'); return statements; },
    };
    await worker.scheduled({}, env({ DB: db as unknown as Env['DB'], MAIL_OBJECTS: { delete: async (keys: string|string[]) => { deleted.push(...(Array.isArray(keys)?keys:[keys])); } } as unknown as Env['MAIL_OBJECTS'] }));
    expect(deleted).toEqual(['mail/box-1/message-1/text']);
    expect(sqls).toContain('cleanup-batch');
  });
});

