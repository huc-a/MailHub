export interface Env {
  DB: { prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } };
  MAIL_OBJECTS: unknown;
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV: string;
  MAIL_DOMAIN: string;
}

const json = (data: unknown, status = 200) => Response.json(data, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
});

const worker = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/v1/health' && request.method === 'GET') {
        return json({ ok: true, service: 'mailhub', environment: env.APP_ENV });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'API route not found' } }, 404);
    }
    return env.ASSETS.fetch(request);
  },
  async email(message: { to: string; setReject(reason: string): void }, env: Env) {
    const recipient = message.to.toLowerCase();
    const mailbox = await env.DB.prepare(
      "SELECT id FROM mailboxes WHERE address = ? COLLATE NOCASE AND status = 'active' AND expires_at_ms > ?"
    ).bind(recipient, Date.now()).first<{ id: string }>();
    if (!mailbox) message.setReject('Unknown or expired mailbox');
  },
};

export default worker;
