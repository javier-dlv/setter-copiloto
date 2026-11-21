// Sesión con contraseña única: cookie firmada con HMAC, sin estado en el servidor.
import crypto from 'node:crypto';

export const COOKIE = 'copiloto_sesion';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function createAuth({ password, secret, secureCookie = true }) {
  const key = sha(secret || `copiloto-sesion:${password || ''}`);
  const hmac = (v) => crypto.createHmac('sha256', key).update(v).digest('base64url');

  function checkPassword(input) {
    if (!password || typeof input !== 'string') return false;
    // Comparamos hashes de igual largo en tiempo constante.
    return crypto.timingSafeEqual(sha(input), sha(password));
  }

  function issue() {
    const exp = String(Date.now() + SESSION_MS);
    return `${exp}.${hmac(exp)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    const expected = Buffer.from(hmac(exp));
    const got = Buffer.from(sig);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return false;
    return Number(exp) > Date.now();
  }

  const cookieAttrs = (maxAgeS) => `Path=/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}; Max-Age=${maxAgeS}`;

  return {
    checkPassword,
    setCookie: (res) => res.setHeader('Set-Cookie', `${COOKIE}=${issue()}; ${cookieAttrs(SESSION_MS / 1000)}`),
    clearCookie: (res) => res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(0)}`),
    isAuthed: (req) => verify(readCookie(req, COOKIE)),
  };
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

// 10 intentos cada 15 minutos por IP.
export function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return {
    hit(ip) {
      const now = Date.now();
      let h = hits.get(ip);
      if (!h || h.resetAt <= now) h = { count: 0, resetAt: now + windowMs };
      h.count++;
      hits.set(ip, h);
      if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      return { allowed: h.count <= max, retryMin: Math.ceil((h.resetAt - now) / 60000) };
    },
  };
}
