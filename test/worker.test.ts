import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/worker';
import { encryptSecret } from '../src/security/crypto';

afterEach(()=>vi.unstubAllGlobals());

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
  it('protects the SPA and static asset routes with the same identity boundary', async () => {
    const response=await worker.fetch(new Request('https://mailhub.test/'),env());
    expect(response.status).toBe(401);
  });
  it('serves the SPA only after local identity simulation is explicitly enabled', async () => {
    const response=await worker.fetch(new Request('http://localhost/',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:{prepare:()=>({bind:()=>({first:async()=>({id:'owner-1'}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}),batch:async()=>[]} as unknown as Env['DB']}));
    expect(response.status).toBe(200);
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
    const queries: string[] = [];
    const db = { prepare: (sql: string) => { queries.push(sql); return { bind: (...values: unknown[]) => { bindValues = values; return { first: async () => ({ id: 'owner-1' }), all: async () => ({ results: [{ id: 'mail-1', fromAddress: 'sender@example.net', subject: 'Hello', receivedAt: 10 }] }), run: async () => ({ meta: { changes: 0 } }) }; } }; }, batch: async () => [] };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(200);
    expect(bindValues[0]).toBe('owner-1');
    expect(queries.some(sql => sql.includes('from_address AS fromAddress'))).toBe(true);
    expect(await response.json()).toMatchObject({ emails: [{ id: 'mail-1' }] });
  });
  it('applies mailbox, source, unread and metadata search filters with bound values', async () => {
    let emailQuery = '', emailValues: unknown[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => {
      if (sql.includes('FROM emails WHERE')) { emailQuery = sql; emailValues = values; }
      return { first: async () => ({ id: 'owner-1' }), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
    } }), batch: async () => [] };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails?limit=40&mailboxId=11111111-1111-4111-8111-111111111111&source=temporary&unread=true&q=Reset%20Code', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(200);
    expect(emailQuery).toContain('mailbox_id=?');
    expect(emailQuery).toContain('source=?');
    expect(emailQuery).toContain('local_is_read=?');
    expect(emailQuery).toContain('instr(lower(subject),lower(?))>0');
    expect(emailValues).toEqual(['owner-1','11111111-1111-4111-8111-111111111111','temporary',0,'Reset Code','Reset Code',40]);
  });
  it('rejects invalid email filters before querying the email list', async () => {
    let listQueried = false;
    const db = { prepare: (sql: string) => ({ bind: () => ({ first: async () => ({ id: 'owner-1' }), all: async () => { if (sql.includes('FROM emails WHERE')) listQueried = true; return { results: [] }; }, run: async () => ({ meta: { changes: 0 } }) }) }), batch: async () => [] };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails?source=unknown', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_SOURCE' } });
    expect(listQueried).toBe(false);
  });
  it('uses the stable cursor tuple together with active filters', async () => {
    let emailQuery = '', emailValues: unknown[] = [];
    const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => {
      if (sql.includes('FROM emails WHERE')) { emailQuery = sql; emailValues = values; }
      return { first: async () => ({ id: 'owner-1' }), all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
    } }), batch: async () => [] };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails?limit=15&q=hello&cursor=1700000000000.11111111-1111-4111-8111-111111111111', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(200);
    expect(emailQuery).toContain('(received_at_ms,id)<(?,?)');
    expect(emailValues).toEqual(['owner-1','hello','hello',1700000000000,'11111111-1111-4111-8111-111111111111',15]);
  });
  it('uses a non-reserved sender alias when loading an email detail', async () => {
    const queries: string[] = [];
    const db = {
      prepare: (sql: string) => {
        queries.push(sql);
        return { bind: () => ({
          first: async () => sql.includes('FROM users') ? { id: 'owner-1' } : sql.includes('FROM emails e') ? { id: 'mail-1', fromAddress: 'sender@example.net', toAddresses: '[]', otpCandidates: '[]' } : null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        }) };
      }, batch: async () => [],
    };
    const response = await worker.fetch(new Request('https://mailhub.test/api/v1/emails/11111111-1111-4111-8111-111111111111', { headers: { 'X-MailHub-Local-Subject': 'owner' } }), env({ APP_ENV: 'local', ALLOW_LOCAL_AUTH: 'true', DB: db as unknown as Env['DB'] }));
    expect(response.status).toBe(200);
    expect(queries.some(sql => sql.includes('e.from_address AS fromAddress'))).toBe(true);
    expect(await response.json()).toMatchObject({ email: { fromAddress: 'sender@example.net' } });
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
  it('forwards unmatched mail to the existing fallback', async () => {
    const forwarded: string[] = [];
    const db = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) }) }), batch: async () => [] };
    const response = await worker.email({
      to: 'legacy@ear1.de5.net',
      raw: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
      rawSize: 0,
      setReject: reason => { throw new Error(`Unexpected rejection: ${reason}`); },
      forward: async recipient => { forwarded.push(recipient); },
    }, env({ FALLBACK_EMAIL: 'verified-destination@example.net', DB: db as unknown as Env['DB'] }));
    expect(response).toBeUndefined();
    expect(forwarded).toEqual(['verified-destination@example.net']);
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
    expect(sqls.some(sql=>sql.includes("status IN ('pending','retry_wait','running')"))).toBe(true);
  });
  it('creates a one-time Gmail OAuth URL with readonly scope and PKCE', async () => {
    let storedSql='';
    const db = { prepare: (sql: string) => ({ bind: (..._values: unknown[]) => ({ first: async () => ({id:'owner-1'}), all: async () => ({results:[]}), run: async () => { storedSql=sql; return {meta:{changes:1}}; } }) }), batch: async () => [] };
    const response = await worker.fetch(new Request('http://localhost/api/v1/accounts/gmail/connect',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','X-MailHub-Local-Subject':'owner'},body:'{}'}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',APP_BASE_URL:'http://localhost',GOOGLE_CLIENT_ID:'client-id',TOKEN_ENCRYPTION_KEY:btoa('x'.repeat(32)),DB:db as unknown as Env['DB']}));
    const body=await response.json() as {authorizationUrl:string}; const url=new URL(body.authorizationUrl);
    expect(response.status).toBe(200);
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(storedSql).toContain('INSERT INTO oauth_states');
  });
  it('reports Gmail OAuth readiness without disclosing configured secret values', async () => {
    const db={prepare:()=>({bind:()=>({first:async()=>({id:'owner-1'}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/accounts/gmail/status',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',APP_BASE_URL:'https://mailhub.test',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(await response.json()).toEqual({configured:false,missingSecrets:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','TOKEN_ENCRYPTION_KEY'],redirectUri:'https://mailhub.test/oauth/gmail/callback'});
  });
  it('requires encrypted credential storage before allowing forwarded IMAP setup', async () => {
    const db={prepare:()=>({bind:()=>({first:async()=>({id:'owner-1'}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/accounts/forwarded-imap',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'qq',emailAddress:'hub@example.test',appPassword:'12345678',folders:['INBOX']})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'IMAP_ENCRYPTION_NOT_CONFIGURED'}});
  });
  it('rejects arbitrary IMAP hosts before making an outbound connection', async () => {
    const db={prepare:()=>({bind:()=>({first:async()=>({id:'owner-1'}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/accounts/forwarded-imap',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'custom',emailAddress:'hub@example.test',appPassword:'12345678',folders:['INBOX']})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:btoa('k'.repeat(32)),DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:{code:'INVALID_IMAP_PROVIDER'}});
  });
  it('rejects unknown providers when discovering IMAP folders without opening a socket', async () => {
    const db={prepare:()=>({bind:()=>({first:async()=>({id:'owner-1'}),all:async()=>({results:[]}),run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/accounts/forwarded-imap/folders',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'custom',emailAddress:'hub@example.test',appPassword:'12345678'})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(400);expect(await response.json()).toMatchObject({error:{code:'INVALID_IMAP_PROVIDER'}});
  });
  it('queues an owner-scoped Gmail sync and returns the durable job identity', async () => {
    const db={prepare:(sql:string)=>({bind:(..._values:unknown[])=>({sql,first:async<T,>()=>(sql.includes('FROM provider_accounts')?{id:'123e4567-e89b-42d3-a456-426614174000',auth_status:'connected',sync_status:'idle'}:sql.includes('FROM jobs')?{id:'job-sync-1',status:'pending'}:{id:'owner-1'}) as T,all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/accounts/123e4567-e89b-42d3-a456-426614174000/sync',{method:'POST',headers:{Origin:'http://localhost','X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(202);expect(await response.json()).toMatchObject({jobId:'job-sync-1',status:'pending'});
  });
  it('lists only safe job fields scoped to the authenticated owner', async () => {
    let query='', values:unknown[]=[];
    const db={prepare:(sql:string)=>({bind:(...bound:unknown[])=>{query=sql;values=bound;return {first:async()=>({id:'owner-1'}),all:async()=>({results:[{id:'job-1',kind:'cleanup_mailbox',status:'succeeded'}]}),run:async()=>({meta:{changes:0}})};}}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/jobs?limit=25',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(query).toContain('WHERE j.user_id=?');expect(query).not.toContain('payload_json');expect(query).not.toContain('lease_token');expect(values).toEqual(['owner-1',25]);expect(await response.json()).toMatchObject({jobs:[{id:'job-1'}]});
  });
  it('retries an owner-scoped failed cleanup job and resets its durable state', async () => {
    const sqls:string[]=[];
    const db={prepare:(sql:string)=>({bind:(..._values:unknown[])=>({first:async<T,>()=>{sqls.push(sql);if(sql.includes('FROM users'))return {id:'owner-1'};if(sql.includes('SELECT id,kind,target_id'))return {id:'job-1',kind:'cleanup_mailbox',targetId:'box-1',dedupKey:'cleanup_mailbox:box-1',status:'dead'};if(sql.includes('SELECT id FROM jobs WHERE dedup_key'))return null;if(sql.includes('SELECT id,status,attempts'))return {id:'job-1',status:'pending',attempts:0};return null as T|null;},all:async()=>({results:[]}),run:async()=>{sqls.push(sql);return {meta:{changes:1}};}})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/jobs/11111111-1111-4111-8111-111111111111/retry',{method:'POST',headers:{Origin:'http://localhost','X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(202);expect(sqls.some(sql=>sql.includes("SET status='pending',attempts=0"))).toBe(true);expect(await response.json()).toMatchObject({job:{id:'job-1',status:'pending'}});
  });
  it('runs a bounded Gmail bootstrap job through MIME parsing and staged storage', async () => {
    const key=btoa('k'.repeat(32)),cipher=await encryptSecret('refresh-token',key,'provider-account:owner-1:account-1:gmail'),sqls:string[]=[],objects:string[]=[];
    const db={prepare:(sql:string)=>({sql,bind:(..._values:unknown[])=>({sql,first:async<T,>()=>(sql.includes('SELECT encrypted_refresh_token')?{encrypted_refresh_token:cipher,key_version:'v1',committed_cursor:null,email_address:'owner@gmail.test'}:sql.includes('SELECT id,ingest_status')?null:null) as T|null,all:async<T,>()=>({results:(sql.includes("FROM jobs WHERE kind='sync'")?[{id:'job-1',user_id:'owner-1',target_id:'account-1',attempts:0,max_attempts:5}]:[]) as T[]}),run:async()=>{sqls.push(sql);return {meta:{changes:1}};}})}),batch:async(statements:{sql:string}[])=>{sqls.push(...statements.map(item=>item.sql));return statements;}};
    const raw= btoa('From: hello@example.test\r\nTo: owner@gmail.test\r\nSubject: Gmail smoke\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nCode 654321');
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const url=String(input);if(url.includes('oauth2.googleapis.com/token'))return Response.json({access_token:'access',expires_in:3600});if(url.endsWith('/profile'))return Response.json({emailAddress:'owner@gmail.test',historyId:'100'});if(url.includes('/messages?'))return Response.json({messages:[{id:'gmail-message-1',threadId:'thread-1'}]});if(url.includes('format=minimal'))return Response.json({id:'gmail-message-1',labelIds:['INBOX']});if(url.includes('format=raw'))return Response.json({id:'gmail-message-1',threadId:'thread-1',raw});throw new Error(`unexpected Gmail request: ${url}`);}));
    await worker.scheduled({},env({DB:db as unknown as Env['DB'],MAIL_OBJECTS:{put:async(key:string)=>{objects.push(key);},delete:async()=>{},get:async()=>null} as unknown as Env['MAIL_OBJECTS'],TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret'}));
    expect(objects.some(key=>key.endsWith('/text'))).toBe(true);expect(sqls.some(sql=>sql.includes('remote_is_read'))).toBe(true);expect(sqls.some(sql=>sql.includes("SET ingest_status='ready'"))).toBe(true);expect(sqls.some(sql=>sql.includes("SET committed_cursor=?"))).toBe(true);
  });
});


