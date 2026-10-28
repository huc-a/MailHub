import { accessSubject } from './access';
import { MIME_LIMITS, parseMime, type ParsedAttachment } from './ingestion/mime';
import { sanitizeEmailHtml } from './security/sanitize-html';
export interface Env {
  DB: { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{results?: T[]}>; run(): Promise<{meta?: {changes?: number}}> } }; batch(statements: unknown[]): Promise<unknown[]> };
  MAIL_OBJECTS: { put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>; get(key: string): Promise<{text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>} | null> };
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV: string;
  MAIL_DOMAIN: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOW_LOCAL_AUTH?: string;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const error = (code: string, message: string, status: number) => json({ error: { code, message, retryable: status >= 500, requestId: crypto.randomUUID() } }, status);
const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const localPart = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), x => 'abcdefghijklmnopqrstuvwxyz234567'[x & 31]).join('');
const sha256 = async (bytes: Uint8Array) => { const copy = new Uint8Array(bytes); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer))].map(x => x.toString(16).padStart(2, '0')).join(''); };
const sameOrigin = (request: Request) => request.headers.get('Origin') === new URL(request.url).origin;
const validJson = (request: Request) => request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json';

async function readRaw(stream: ReadableStream<Uint8Array>, declaredSize: number): Promise<Uint8Array> {
  if (declaredSize > MIME_LIMITS.raw) throw new Error('RAW_MESSAGE_TOO_LARGE');
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MIME_LIMITS.raw) { await reader.cancel(); throw new Error('RAW_MESSAGE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
  return raw;
}
function attachmentSize(attachment: ParsedAttachment) { return attachment.skippedReason === null ? attachment.bytes.byteLength : attachment.size; }

async function ingestInbound(message: { to: string; raw: ReadableStream<Uint8Array>; rawSize: number; setReject(reason: string): void }, env: Env) {
  const mailbox = await env.DB.prepare("SELECT id,user_id,generation FROM mailboxes WHERE address=? COLLATE NOCASE AND status='active' AND expires_at_ms>? ").bind(message.to.toLowerCase(),Date.now()).first<{id:string;user_id:string;generation:number}>();
  if (!mailbox) { message.setReject('Unknown or expired mailbox'); return; }
  let raw: Uint8Array;
  try { raw = await readRaw(message.raw,message.rawSize); }
  catch (e) { if (e instanceof Error && e.message === 'RAW_MESSAGE_TOO_LARGE') { message.setReject('Message exceeds the application size limit'); return; } throw e; }
  let parsed;
  try { parsed = await parseMime(raw,message.to.toLowerCase()); }
  catch { message.setReject('Message could not be parsed'); return; }
  const dedup = await sha256(raw);
  let email = await env.DB.prepare('SELECT id,ingest_status FROM emails WHERE mailbox_id=? AND provider_message_id=?').bind(mailbox.id,dedup).first<{id:string;ingest_status:string}>();
  if (email?.ingest_status === 'ready') return;
  const emailId = email?.id ?? crypto.randomUUID(), now = Date.now();
  const objects: { id:string; key:string; kind:string; data:Uint8Array; contentType:string }[] = [];
  if (parsed.text) objects.push({id:`${emailId}-text`,key:`mail/${mailbox.id}/${emailId}/text`,kind:'text',data:new TextEncoder().encode(parsed.text),contentType:'text/plain; charset=utf-8'});
  if (parsed.html) objects.push({id:`${emailId}-html`,key:`mail/${mailbox.id}/${emailId}/html`,kind:'html',data:new TextEncoder().encode(parsed.html),contentType:'text/html; charset=utf-8'});
  const statements = [env.DB.prepare("INSERT OR IGNORE INTO emails(id,user_id,source,mailbox_id,provider_message_id,message_id_header,from_address,to_addresses_json,subject,snippet,received_at_ms,created_at_ms,otp_candidates_json,ingest_status,source_generation,body_truncated) VALUES(?,?,'temporary',?,?,?,?,?,?,?,?,?,?,'staged',?,?)").bind(emailId,mailbox.user_id,mailbox.id,dedup,parsed.messageId,parsed.from,JSON.stringify(parsed.to),parsed.subject,parsed.snippet,parsed.receivedAt,now,JSON.stringify(parsed.otpCandidates),mailbox.generation,parsed.bodyTruncated ? 1 : 0)];
  for (const [index,attachment] of parsed.attachments.entries()) {
    const attachmentId = `${emailId}-att-${index}`;
    if (attachment.skippedReason === null) {
      const objectId = `${emailId}-attachment-${index}`, key = `mail/${mailbox.id}/${emailId}/attachment-${index}`;
      objects.push({id:objectId,key,kind:'attachment',data:attachment.bytes,contentType:attachment.contentType});
      statements.push(env.DB.prepare("INSERT OR IGNORE INTO mail_objects(id,email_id,kind,object_key,size_bytes,status,created_at_ms) VALUES(?,?, 'attachment', ?, ?, 'expected', ?)").bind(objectId,emailId,key,attachment.bytes.byteLength,now));
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO email_attachments(id,email_id,object_id,filename,content_type,size_bytes) VALUES(?,?,?,?,?,?)').bind(attachmentId,emailId,objectId,attachment.filename,attachment.contentType,attachment.bytes.byteLength));
    } else {
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO email_attachments(id,email_id,object_id,filename,content_type,size_bytes,skipped_reason) VALUES(?,?,NULL,?,?,?,?)').bind(attachmentId,emailId,attachment.filename,attachment.contentType,attachmentSize(attachment),attachment.skippedReason));
    }
  }
  for (const object of objects.filter(item => item.kind !== 'attachment')) statements.push(env.DB.prepare("INSERT OR IGNORE INTO mail_objects(id,email_id,kind,object_key,size_bytes,status,created_at_ms) VALUES(?,?,?,?,?,'expected',?)").bind(object.id,emailId,object.kind,object.key,object.data.byteLength,now));
  await env.DB.batch(statements);
  for (const object of objects) {
    await env.MAIL_OBJECTS.put(object.key,object.data,{httpMetadata:{contentType:object.contentType}});
    await env.DB.prepare("UPDATE mail_objects SET status='uploaded',checksum_sha256=? WHERE id=? AND email_id=?").bind(await sha256(object.data),object.id,emailId).run();
  }
  const finalized = await env.DB.prepare("UPDATE emails SET ingest_status='ready' WHERE id=? AND user_id=? AND ingest_status='staged' AND source_generation=(SELECT generation FROM mailboxes WHERE id=? AND status='active' AND expires_at_ms>?)").bind(emailId,mailbox.user_id,mailbox.id,Date.now()).run();
  if ((finalized.meta?.changes ?? 0) !== 1) throw new Error('Mailbox changed during message ingestion');
}

async function ownerId(request: Request, env: Env): Promise<string | null> {
  let subject: string | null = null;
  if (env.APP_ENV === 'local' && env.ALLOW_LOCAL_AUTH === 'true') subject = request.headers.get('X-MailHub-Local-Subject');
  else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) subject = await accessSubject(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!subject) return null;
  const issuer = env.APP_ENV === 'local' ? 'local' : env.ACCESS_TEAM_DOMAIN!;
  const existing = await env.DB.prepare('SELECT id FROM users WHERE access_issuer = ? AND access_subject = ?').bind(issuer, subject).first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO users(id,access_issuer,access_subject,created_at_ms) VALUES(?,?,?,?)').bind(id, issuer, subject, Date.now()).run();
  const created = await env.DB.prepare('SELECT id FROM users WHERE access_issuer = ? AND access_subject = ?').bind(issuer, subject).first<{ id: string }>();
  return created?.id ?? null;
}

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/v1/health' && request.method === 'GET') return json({ ok: true, service: 'mailhub', environment: env.APP_ENV });
    const owner = await ownerId(request, env);
    if (!owner) return error('UNAUTHENTICATED', 'Access authentication required', 401);
    if (url.pathname === '/api/v1/me' && request.method === 'GET') return json({ id: owner });
    if (url.pathname === '/api/v1/mailboxes' && request.method === 'GET') {
      const result = await env.DB.prepare("SELECT id,address,CASE WHEN status='active' AND expires_at_ms<=? THEN 'expired' ELSE status END AS status,created_at_ms AS createdAt,expires_at_ms AS expiresAt FROM mailboxes WHERE user_id=? AND status IN ('active','expired') ORDER BY created_at_ms DESC LIMIT 100").bind(Date.now(),owner).all<Record<string, unknown>>();
      return json({ mailboxes: result.results ?? [] });
    }
    if (url.pathname === '/api/v1/mailboxes' && request.method === 'POST') {
      if (!sameOrigin(request)) return error('CSRF_REJECTED', 'Same-origin request required', 403);
      if (!validJson(request)) return error('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', 415);
      let body: { ttlMinutes?: unknown };
      try { body = await request.json() as typeof body; } catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
      const ttl = body.ttlMinutes === undefined ? 60 : body.ttlMinutes;
      if (![10, 30, 60, 1440].includes(ttl as number)) return error('INVALID_TTL', 'ttlMinutes must be 10, 30, 60 or 1440', 400);
      const key = request.headers.get('Idempotency-Key');
      if (!key || key.length > 128) return error('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required', 400);
      const requestHash = await digest(JSON.stringify({ ttlMinutes: ttl }));
      const old = await env.DB.prepare('SELECT request_hash,resource_id FROM idempotency_keys WHERE user_id=? AND route=? AND request_key=? AND expires_at_ms>?').bind(owner, '/mailboxes', key, Date.now()).first<{ request_hash: string; resource_id: string | null }>();
      if (old) {
        if (old.request_hash !== requestHash) return error('IDEMPOTENCY_CONFLICT', 'Key was already used for a different request', 409);
        if (old.resource_id) {
          const prior = await env.DB.prepare('SELECT id,address,status,created_at_ms AS createdAt,expires_at_ms AS expiresAt FROM mailboxes WHERE id=? AND user_id=?').bind(old.resource_id, owner).first();
          if (prior) return json({ mailbox: prior }, 200);
        }
      }
      const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM mailboxes WHERE user_id=? AND status='active' AND expires_at_ms>?").bind(owner, Date.now()).first<{ count: number }>();
      if ((count?.count ?? 0) >= 10) return error('MAILBOX_LIMIT_REACHED', 'At most 10 active mailboxes are allowed', 409);
      const now = Date.now(), id = crypto.randomUUID();
      let address = '';
      for (let attempt=0; attempt<4; attempt++) {
        address = `${localPart()}@${env.MAIL_DOMAIN.toLowerCase()}`;
        try {
          await env.DB.prepare("INSERT INTO mailboxes(id,user_id,address,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)").bind(id, owner, address, now, now + (ttl as number)*60_000).run();
          break;
        } catch (e) { if (attempt === 3) throw e; }
      }
      await env.DB.prepare('INSERT INTO idempotency_keys(user_id,request_key,route,request_hash,resource_id,expires_at_ms) VALUES(?,?,?,?,?,?)').bind(owner,key,'/mailboxes',requestHash,id,now+86_400_000).run();
      return json({ mailbox: { id, address, status: 'active', createdAt: now, expiresAt: now+(ttl as number)*60_000 } }, 201);
    }
    const mailboxAction = url.pathname.match(/^\/api\/v1\/mailboxes\/([0-9a-f-]{36})(?:\/(renew))?$/i);
    if (mailboxAction && request.method === 'POST' && mailboxAction[2] === 'renew') {
      if (!sameOrigin(request)) return error('CSRF_REJECTED', 'Same-origin request required', 403);
      if (!validJson(request)) return error('UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', 415);
      let body: { ttlMinutes?: unknown };
      try { body = await request.json() as typeof body; } catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
      const ttl = body.ttlMinutes === undefined ? 60 : body.ttlMinutes;
      if (![10, 30, 60, 1440].includes(ttl as number)) return error('INVALID_TTL', 'ttlMinutes must be 10, 30, 60 or 1440', 400);
      const id = mailboxAction[1], now = Date.now();
      const mailbox = await env.DB.prepare('SELECT id,created_at_ms AS createdAt,expires_at_ms AS expiresAt,status FROM mailboxes WHERE id=? AND user_id=?').bind(id, owner).first<{id:string;createdAt:number;expiresAt:number;status:string}>();
      if (!mailbox) return error('NOT_FOUND', 'Mailbox not found', 404);
      if (mailbox.status !== 'active' || mailbox.expiresAt <= now) return error('MAILBOX_EXPIRED', 'Expired or deleting mailboxes cannot be renewed', 409);
      const expiresAt = Math.min(now+(ttl as number)*60_000, mailbox.createdAt+24*60*60_000);
      if (expiresAt <= mailbox.expiresAt) return error('MAILBOX_TTL_MAX', 'Mailbox has reached its maximum lifetime', 409);
      const result = await env.DB.prepare("UPDATE mailboxes SET expires_at_ms=? WHERE id=? AND user_id=? AND status='active' AND expires_at_ms>? AND generation=(SELECT generation FROM mailboxes WHERE id=? AND user_id=?)").bind(expiresAt,id,owner,now,id,owner).run();
      if ((result.meta?.changes ?? 0) !== 1) return error('MAILBOX_CHANGED', 'Mailbox state changed; reload and retry', 409);
      return json({ mailbox: { id, expiresAt } });
    }
    if (mailboxAction && request.method === 'DELETE' && !mailboxAction[2]) {
      if (!sameOrigin(request)) return error('CSRF_REJECTED', 'Same-origin request required', 403);
      const id = mailboxAction[1], now = Date.now();
      const mailbox = await env.DB.prepare('SELECT id,status FROM mailboxes WHERE id=? AND user_id=?').bind(id,owner).first<{id:string;status:string}>();
      if (!mailbox) return error('NOT_FOUND', 'Mailbox not found', 404);
      const jobId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("UPDATE mailboxes SET status='deleting',generation=generation+1,deleted_at_ms=? WHERE id=? AND user_id=? AND status IN ('active','expired')").bind(now,id,owner),
        env.DB.prepare("INSERT OR IGNORE INTO jobs(id,user_id,kind,target_id,dedup_key,status,available_at_ms,created_at_ms,updated_at_ms) SELECT ?,user_id,'cleanup_mailbox',id,'cleanup_mailbox:'||id,'pending',?,?,? FROM mailboxes WHERE id=? AND user_id=? AND status='deleting'").bind(jobId,now,now,now,id,owner),
      ]);
      const job = await env.DB.prepare("SELECT id,status FROM jobs WHERE dedup_key=? AND status IN ('pending','running','retry_wait')").bind(`cleanup_mailbox:${id}`).first<{id:string;status:string}>();
      return json({ jobId: job?.id ?? jobId, status: job?.status ?? 'pending' }, 202);
    }
    if (url.pathname === '/api/v1/emails' && request.method === 'GET') {
      const limit = Math.min(100,Math.max(1,Number(url.searchParams.get('limit') ?? 30) || 30));
      const cursor = url.searchParams.get('cursor');
      if (cursor && (!/^\d+\.[0-9a-f-]{36}$/i.test(cursor) || !Number.isSafeInteger(Number(cursor.split('.')[0])))) return error('INVALID_CURSOR', 'Invalid email cursor', 400);
      const query = cursor
        ? "SELECT id,source,mailbox_id AS mailboxId,from_address AS from,subject,snippet,received_at_ms AS receivedAt,local_is_read AS localIsRead FROM emails WHERE user_id=? AND ingest_status='ready' AND (received_at_ms,id)<(?,?) ORDER BY received_at_ms DESC,id DESC LIMIT ?"
        : "SELECT id,source,mailbox_id AS mailboxId,from_address AS from,subject,snippet,received_at_ms AS receivedAt,local_is_read AS localIsRead FROM emails WHERE user_id=? AND ingest_status='ready' ORDER BY received_at_ms DESC,id DESC LIMIT ?";
      const statement = cursor
        ? env.DB.prepare(query).bind(owner,Number(cursor.split('.')[0]),cursor.split('.')[1],limit)
        : env.DB.prepare(query).bind(owner,limit);
      const result = await statement.all<Record<string, unknown>>();
      const emails = result.results ?? [];
      const last = emails.at(-1);
      return json({ emails, nextCursor: emails.length === limit && last ? `${last.receivedAt}.${last.id}` : null });
    }
    const readPath = url.pathname.match(/^\/api\/v1\/emails\/([0-9a-f-]{36})(?:\/(html|attachments\/([^/]{1,128})))?$/i);
    if (readPath && request.method === 'GET') {
      const emailId = readPath[1];
      const scope = "e.id=? AND e.user_id=? AND e.ingest_status='ready' AND (e.source!='temporary' OR EXISTS(SELECT 1 FROM mailboxes mb WHERE mb.id=e.mailbox_id AND mb.status='active' AND mb.expires_at_ms>?))";
      if (readPath[2] === 'html') {
        const object = await env.DB.prepare(`SELECT mo.object_key AS objectKey FROM mail_objects mo JOIN emails e ON e.id=mo.email_id WHERE ${scope} AND mo.kind='html' AND mo.status='uploaded'`).bind(emailId,owner,Date.now()).first<{objectKey:string}>();
        if (!object) return error('NOT_FOUND','Email not found',404);
        const stored = await env.MAIL_OBJECTS.get(object.objectKey);
        if (!stored) return error('NOT_FOUND','Email content not found',404);
        return new Response(sanitizeEmailHtml(await stored.text()), { headers: { 'Content-Type':'text/html; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'; sandbox" } });
      }
      if (readPath[3]) {
        if (!/^[0-9a-f-]{36}-att-\d+$/i.test(readPath[3])) return error('NOT_FOUND','Attachment not found',404);
        const item = await env.DB.prepare(`SELECT ea.filename,ea.content_type AS contentType,mo.object_key AS objectKey FROM email_attachments ea JOIN emails e ON e.id=ea.email_id JOIN mail_objects mo ON mo.id=ea.object_id WHERE ${scope} AND e.id=? AND ea.id=? AND ea.skipped_reason IS NULL AND mo.status='uploaded'`).bind(emailId,owner,Date.now(),emailId,readPath[3]).first<{filename:string;contentType:string;objectKey:string}>();
        if (!item) return error('NOT_FOUND','Attachment not found',404);
        const stored = await env.MAIL_OBJECTS.get(item.objectKey);
        if (!stored) return error('NOT_FOUND','Attachment not found',404);
        const filename = item.filename.replace(/[\r\n"\\]/g,'_').slice(0,180) || 'attachment';
        return new Response(await stored.arrayBuffer(), { headers: { 'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${filename.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' } });
      }
      const email = await env.DB.prepare(`SELECT e.id,e.source,e.mailbox_id AS mailboxId,e.from_address AS from,e.to_addresses_json AS toAddresses,e.subject,e.snippet,e.received_at_ms AS receivedAt,e.local_is_read AS localIsRead,e.otp_candidates_json AS otpCandidates,e.body_truncated AS bodyTruncated,mo.object_key AS textKey,EXISTS(SELECT 1 FROM mail_objects h WHERE h.email_id=e.id AND h.kind='html' AND h.status='uploaded') AS hasHtml FROM emails e LEFT JOIN mail_objects mo ON mo.email_id=e.id AND mo.kind='text' AND mo.status='uploaded' WHERE ${scope}`).bind(emailId,owner,Date.now()).first<Record<string,unknown> & {textKey?:string}>();
      if (!email) return error('NOT_FOUND','Email not found',404);
      const stored = email.textKey ? await env.MAIL_OBJECTS.get(email.textKey) : null;
      const attachments = await env.DB.prepare('SELECT id,filename,content_type AS contentType,size_bytes AS size,skipped_reason AS skippedReason FROM email_attachments WHERE email_id=? ORDER BY id').bind(emailId).all<Record<string,unknown>>();
      return json({ email: { ...email, text: stored ? await stored.text() : '', toAddresses: JSON.parse(String(email.toAddresses)), otpCandidates: JSON.parse(String(email.otpCandidates)), attachments: attachments.results ?? [] } });
    }
    if (readPath && request.method === 'PATCH' && !readPath[2]) {
      if (!sameOrigin(request)) return error('CSRF_REJECTED','Same-origin request required',403);
      if (!validJson(request)) return error('UNSUPPORTED_MEDIA_TYPE','Content-Type must be application/json',415);
      let body: {localIsRead?:unknown}; try { body = await request.json() as typeof body; } catch { return error('INVALID_JSON','Request body must be JSON',400); }
      if (typeof body.localIsRead !== 'boolean') return error('INVALID_READ_STATE','localIsRead must be boolean',400);
      const result = await env.DB.prepare("UPDATE emails SET local_is_read=? WHERE id=? AND user_id=? AND ingest_status='ready' AND (source!='temporary' OR EXISTS(SELECT 1 FROM mailboxes mb WHERE mb.id=emails.mailbox_id AND mb.status='active' AND mb.expires_at_ms>?))").bind(body.localIsRead ? 1 : 0,readPath[1],owner,Date.now()).run();
      if ((result.meta?.changes ?? 0) !== 1) return error('NOT_FOUND','Email not found',404);
      return json({ id:readPath[1],localIsRead:body.localIsRead });
    }
    return error('NOT_FOUND', 'API route not found', 404);
  },
  async email(message: { to: string; raw: ReadableStream<Uint8Array>; rawSize: number; setReject(reason: string): void }, env: Env) {
    await ingestInbound(message,env);
  },
};
export default worker;

