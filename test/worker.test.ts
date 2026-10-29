import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { syncFailureCode, type Env } from '../src/worker';
import { decryptSecret, encryptSecret } from '../src/security/crypto';

afterEach(()=>vi.unstubAllGlobals());

describe('provider sync diagnostics',()=>{
  it('classifies IMAP authentication and folder failures without exposing server text',()=>{
    expect(syncFailureCode(new Error('IMAP_COMMAND_FAILED:A0002 NO [AUTHENTICATIONFAILED] private details'),'forwarded_imap')).toBe('IMAP_AUTHENTICATION_FAILED');
    expect(syncFailureCode(new Error('IMAP_COMMAND_FAILED:A0002 NO [TRYCREATE] private details'),'forwarded_imap')).toBe('IMAP_FOLDER_NOT_FOUND');
    expect(syncFailureCode(new Error('IMAP_SOCKET_CLOSED'),'forwarded_imap')).toBe('IMAP_SOCKET_CLOSED');
  });
});

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
  it('scopes a fixed forwarding folder to its configured IMAP account and folder prefix', async () => {
    let emailQuery='',emailValues:unknown[]=[];
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>({id:'owner-1'}),all:async()=>{if(sql.includes('FROM provider_accounts'))return{results:[{id:'hub-1',syncScope:JSON.stringify({connectionType:'forwarded_imap',folders:['My Folders/person@example.net']})}]};if(sql.includes('FROM emails WHERE')){emailQuery=sql;emailValues=values;return{results:[{id:'mail-1',providerMessageId:'imap:My Folders/person@example.net:33:10',receivedAt:1}]};}return{results:[]};},run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/emails?folder='+encodeURIComponent('My Folders/person@example.net'),{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(emailQuery).toContain('provider_account_id=?');expect(emailQuery).toContain('substr(provider_message_id,1,?)=?');expect(emailValues).toContain('hub-1');expect(emailValues).toContain('imap:My Folders/person@example.net:');expect(await response.json()).toMatchObject({emails:[{id:'mail-1',sourceFolder:'My Folders/person@example.net'}]});
  });
  it('keeps the hub inbox available as a source for previously saved IMAP connections', async () => {
    let emailQuery='',emailValues:unknown[]=[];
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>({id:'owner-1'}),all:async()=>{if(sql.includes('FROM provider_accounts'))return{results:[{id:'hub-1',syncScope:JSON.stringify({connectionType:'forwarded_imap',folders:['My Folders/person@example.net']})}]};if(sql.includes('FROM emails WHERE')){emailQuery=sql;emailValues=values;}return{results:[]};},run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/emails?source=forwarded&folder=INBOX',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(emailQuery).toContain('provider_account_id=?');expect(emailValues).toContain('imap:INBOX:');
  });
  it('imports temp-mail.io messages into the owner mailbox and R2-backed email detail', async()=>{
    const mailboxId='11111111-1111-4111-8111-111111111111',key=btoa('k'.repeat(32)),encrypted=await encryptSecret(JSON.stringify({token:'provider-token',cookie:'sid=cookie'}),key,`mailbox-provider:owner-1:${mailboxId}:temp-mail-io`),queries:string[]=[],storedKeys:string[]=[];expect(await decryptSecret(encrypted,key,`mailbox-provider:owner-1:${mailboxId}:temp-mail-io`)).toContain('provider-token');
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json([{id:'message-1',from:'sender@example.test',to:'random@temp.test',subject:'Login code',body_text:'Your code is 123456',body_html:'<p>Your code is 123456</p>',created_at:'2026-10-29T00:00:00Z'}])));
    const row={id:'email-1',source:'temporary',mailboxId,providerMessageId:'temp-mail-io:message-1',fromAddress:'sender@example.test',subject:'Login code',snippet:'Your code is 123456',receivedAt:1793232000000,localIsRead:0};
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({sql,values,first:async<T,>()=>{queries.push(sql);if(sql.includes('FROM users'))return{id:'owner-1'};if(sql.includes('COALESCE(provider_service,provider) AS provider,status'))return{provider:'temp_mail_io',status:'active',expiresAt:Date.now()+60000};if(sql.includes('SELECT address,generation'))return{address:'random@temp.test',generation:0,expiresAt:Date.now()+60000,encryptedSession:encrypted,providerConfig:'{"ttlMinutes":60}',lastPoll:null};if(sql.includes('SELECT id,ingest_status'))return null;return null as T|null;},all:async<T,>()=>{queries.push(sql);return{results:(sql.includes('FROM emails WHERE')?[row]:[]) as T[]};},run:async()=>({meta:{changes:1}})} )}),batch:async(statements:unknown[])=>{for(const statement of statements as Array<{sql?:string}>){if(statement.sql)queries.push(statement.sql);}return[];}};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/emails?mailboxId=11111111-1111-4111-8111-111111111111',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:key,DB:db as unknown as Env['DB'],MAIL_OBJECTS:{put:async(key:string)=>{storedKeys.push(key);},get:async()=>null,delete:async()=>{}} as unknown as Env['MAIL_OBJECTS']}));
    expect(response.status,JSON.stringify(await response.clone().json())).toBe(200);expect(await response.json()).toMatchObject({emails:[{id:'email-1',subject:'Login code'}]});expect(queries.some(sql=>sql.includes("INSERT OR IGNORE INTO emails")&&sql.includes("'temporary'"))).toBe(true);expect(storedKeys.some(key=>key.startsWith('temporary/11111111-1111-4111-8111-111111111111/'))).toBe(true);
  });
  it('creates a public-domain external mailbox while keeping its provider session encrypted',async()=>{
    const key=btoa('z'.repeat(32)),writes:Array<{sql:string;values:unknown[]}>=[];let createPayload:unknown;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);if(request.url.endsWith('/v4/domains'))return Response.json({domains:[{name:'example.test',type:'public'}]});createPayload=await request.clone().json();return Response.json({email:'my-box@example.test',token:'provider-secret'},{headers:{'Set-Cookie':'sid=session-cookie; Path=/; HttpOnly'}});}));
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async<T,>()=>{if(sql.includes('FROM users'))return{id:'owner-1'};if(sql.includes('idempotency_keys'))return null;if(sql.includes('COUNT(*)'))return{count:0};return null as T|null;},all:async()=>({results:[]}),run:async()=>{writes.push({sql,values});return{meta:{changes:1}};}})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/mailboxes',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':'external-mail-test','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'temp_mail_io',name:'my-box',domain:'example.test',ttlMinutes:60})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:key,DB:db as unknown as Env['DB']}));
    const body=await response.json() as {mailbox:{id:string;address:string;provider:string}};const stored=writes.find(item=>item.sql.includes('INSERT INTO mailboxes'));
    expect(response.status).toBe(201);expect(body.mailbox).toMatchObject({address:'my-box@example.test',provider:'temp_mail_io'});expect(createPayload).toEqual({name:'my-box',domain:'example.test'});expect(JSON.stringify(body)).not.toContain('provider-secret');expect(stored).toBeDefined();expect(String(stored?.values[5])).not.toContain('provider-secret');expect(await decryptSecret(String(stored?.values[5]),key,`mailbox-provider:owner-1:${body.mailbox.id}:temp-mail-io`)).toContain('provider-secret');
  });
  it('creates a mail.td mailbox and keeps its account token encrypted',async()=>{
    const key=btoa('m'.repeat(32)),writes:Array<{sql:string;values:unknown[]}>=[];let createPayload:Record<string,unknown>|undefined;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const request=new Request(input,init);
      if(request.url.endsWith('/domains'))return Response.json({domains:['example.test']});
      createPayload=await request.clone().json() as Record<string,unknown>;
      return Response.json({id:'mailtd-account',address:'my-box@example.test',token:'mailtd-session-secret'});
    }));
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async<T,>()=>{if(sql.includes('FROM users'))return{id:'owner-1'};if(sql.includes('idempotency_keys'))return null;if(sql.includes('COUNT(*)'))return{count:0};return null as T|null;},all:async()=>({results:[]}),run:async()=>{writes.push({sql,values});return{meta:{changes:1}};}})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/mailboxes',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':'mail-td-create','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'mail_td',name:'my-box',domain:'example.test',authKey:'a'.repeat(64),pow:{t:Math.floor(Date.now()/1000),n:'10',d:15},ttlMinutes:60})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:key,DB:db as unknown as Env['DB']}));
    const body=await response.json() as {mailbox:{id:string;address:string;provider:string}},stored=writes.find(item=>item.sql.includes('INSERT INTO mailboxes'));
    expect(response.status).toBe(201);expect(body.mailbox).toMatchObject({address:'my-box@example.test',provider:'mail_td'});expect(createPayload).toMatchObject({address:'my-box@example.test',auth_key:'a'.repeat(64),pow:{d:15}});expect(stored?.sql).toContain('provider_service');expect(String(stored?.values[5])).not.toContain('mailtd-session-secret');expect(JSON.stringify(body)).not.toContain('mailtd-session-secret');expect(await decryptSecret(String(stored?.values[5]),key,`mailbox-provider:owner-1:${body.mailbox.id}:mail_td`)).toContain('mailtd-session-secret');
  });
  it('returns a bounded mail.td proof challenge to the browser without persisting a mailbox',async()=>{
    let mailboxWrite=false;
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>new Request(input).url.endsWith('/domains')?Response.json({domains:['example.test']}):Response.json({status:'retry',required_difficulty:16,token:'short-lived-challenge'})));
    const db={prepare:(sql:string)=>({bind:()=>({first:async<T,>()=>sql.includes('FROM users')?{id:'owner-1'}:sql.includes('COUNT(*)')?{count:0}:null as T|null,all:async()=>({results:[]}),run:async()=>{mailboxWrite=true;return{meta:{changes:1}};}})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('http://localhost/api/v1/mailboxes',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':'mail-td-challenge','X-MailHub-Local-Subject':'owner'},body:JSON.stringify({provider:'mail_td',name:'my-box',domain:'example.test',authKey:'a'.repeat(64),pow:{t:Math.floor(Date.now()/1000),n:'10',d:15},ttlMinutes:60})}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:btoa('m'.repeat(32)),DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(428);expect(await response.json()).toMatchObject({error:{code:'MAIL_TD_POW_RETRY',challenge:{requiredDifficulty:16,token:'short-lived-challenge'}}});expect(mailboxWrite).toBe(false);
  });
  it('syncs mail.td message detail through the shared R2-backed temporary inbox',async()=>{
    const mailboxId='22222222-2222-4222-8222-222222222222',key=btoa('n'.repeat(32)),session={accountId:'mailtd-account',address:'random@mail.test',token:'mailtd-token',authKey:'c'.repeat(64)},encrypted=await encryptSecret(JSON.stringify(session),key,`mailbox-provider:owner-1:${mailboxId}:mail_td`),queries:string[]=[],storedKeys:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{const request=new Request(input);if(request.url.endsWith('/messages?page=1'))return Response.json([{id:'mailtd-message-1',subject:'Verification code'}]);return Response.json({message:{id:'mailtd-message-1',from:'sender@example.test',subject:'Verification code',body_text:'Use 654321 to continue',date:'2026-10-29T00:00:00Z'}});}));
    const row={id:'email-td-1',source:'temporary',mailboxId,fromAddress:'sender@example.test',subject:'Verification code',snippet:'Use 654321 to continue',receivedAt:1793232000000,localIsRead:0};
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({sql,values,first:async<T,>()=>{queries.push(sql);if(sql.includes('FROM users'))return{id:'owner-1'};if(sql.includes('COALESCE(provider_service,provider) AS provider,status'))return{provider:'mail_td',status:'active',expiresAt:Date.now()+60000};if(sql.includes("provider_service='mail_td' AND status='active'"))return{address:session.address,generation:0,expiresAt:Date.now()+60000,encryptedSession:encrypted,providerConfig:'{"ttlMinutes":60}',lastPoll:null};if(sql.includes('SELECT id,ingest_status'))return null;return null as T|null;},all:async<T,>()=>{queries.push(sql);return{results:(sql.includes('FROM emails WHERE')?[row]:[]) as T[]};},run:async()=>({meta:{changes:1}})})}),batch:async(statements:unknown[])=>{for(const statement of statements as Array<{sql?:string;values?:unknown[]}>){if(statement.sql)queries.push(statement.sql);if(statement.sql?.includes('INSERT OR IGNORE INTO emails'))expect(statement.values).toContain('mail-td:mailtd-message-1');}return[];}};
    const response=await worker.fetch(new Request(`https://mailhub.test/api/v1/emails?mailboxId=${mailboxId}`,{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',TOKEN_ENCRYPTION_KEY:key,DB:db as unknown as Env['DB'],MAIL_OBJECTS:{put:async(objectKey:string)=>{storedKeys.push(objectKey);},get:async()=>null,delete:async()=>{}} as unknown as Env['MAIL_OBJECTS']}));
    expect(response.status,JSON.stringify(await response.clone().json())).toBe(200);expect(await response.json()).toMatchObject({emails:[{id:'email-td-1',subject:'Verification code'}]});expect(queries.some(sql=>sql.includes("provider_service='mail_td'"))).toBe(true);expect(storedKeys.some(objectKey=>objectKey.startsWith(`temporary/${mailboxId}/`))).toBe(true);
  });
  it('limits all-forwarded view to configured hub accounts rather than OAuth Gmail', async () => {
    let emailQuery='',emailValues:unknown[]=[];
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>({id:'owner-1'}),all:async()=>{if(sql.includes('FROM provider_accounts'))return{results:[{id:'hub-1'},{id:'hub-2'}]};if(sql.includes('FROM emails WHERE')){emailQuery=sql;emailValues=values;}return{results:[]};},run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/emails?source=forwarded',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(emailQuery).toContain('provider_account_id IN (?,?)');expect(emailQuery).toContain("substr(provider_message_id,1,5)='imap:'");expect(emailQuery).not.toContain('source=?');expect(emailValues).toEqual(['owner-1','hub-1','hub-2',30]);
  });
  it('scopes a selected provider mailbox to a connected account owned by the caller', async () => {
    let emailQuery='',emailValues:unknown[]=[];
    const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({first:async()=>sql.includes('FROM provider_accounts')?{id:'account-1'}:{id:'owner-1'},all:async()=>{if(sql.includes('FROM emails WHERE')){emailQuery=sql;emailValues=values;}return{results:[]};},run:async()=>({meta:{changes:0}})})}),batch:async()=>[]};
    const response=await worker.fetch(new Request('https://mailhub.test/api/v1/emails?accountId=11111111-1111-4111-8111-111111111111',{headers:{'X-MailHub-Local-Subject':'owner'}}),env({APP_ENV:'local',ALLOW_LOCAL_AUTH:'true',DB:db as unknown as Env['DB']}));
    expect(response.status).toBe(200);expect(emailQuery).toContain('provider_account_id=?');expect(emailValues).toEqual(['owner-1','account-1',30]);
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
      to: 'legacy@mail.example.test',
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


