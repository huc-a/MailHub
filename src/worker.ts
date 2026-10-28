import { accessSubject } from './access';
export interface Env {
  DB: { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; all?(): Promise<{results?: unknown[]}>; run(): Promise<unknown> } } };
  MAIL_OBJECTS: unknown;
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
      const result = await env.DB.prepare("SELECT id,address,status,created_at_ms AS createdAt,expires_at_ms AS expiresAt FROM mailboxes WHERE user_id=? AND status IN ('active','expired') ORDER BY created_at_ms DESC").bind(owner).all?.();
      return json({ mailboxes: result?.results ?? [] });
    }
    if (url.pathname === '/api/v1/mailboxes' && request.method === 'POST') {
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
    return error('NOT_FOUND', 'API route not found', 404);
  },
  async email(message: { to: string; setReject(reason: string): void }, env: Env) {
    const mailbox = await env.DB.prepare("SELECT id FROM mailboxes WHERE address=? COLLATE NOCASE AND status='active' AND expires_at_ms>?").bind(message.to.toLowerCase(),Date.now()).first<{id:string}>();
    if (!mailbox) message.setReject('Unknown or expired mailbox');
  },
};
export default worker;

