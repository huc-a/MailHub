import { createRemoteJWKSet, jwtVerify } from 'jose';

const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function accessSubject(request: Request, teamDomain: string, audience: string): Promise<string | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !teamDomain || !audience) return null;
  const issuer = teamDomain.startsWith('https://') ? teamDomain : `https://${teamDomain}`;
  let jwks = keys.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
    keys.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });
    return typeof payload.sub === 'string' && payload.sub.length ? payload.sub : null;
  } catch { return null; }
}
