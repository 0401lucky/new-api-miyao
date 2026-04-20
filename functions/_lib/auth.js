const encoder = new TextEncoder();

export const ADMIN_COOKIE_NAME = 'admin_session';
export const ADMIN_SESSION_TTL = 60 * 60 * 12;

function bytesToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function getCookie(request, name) {
  const cookies = request.headers.get('Cookie') || '';
  for (const part of cookies.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=');
  }
  return '';
}

async function signText(text, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(text));
  return bytesToBase64Url(signature);
}

function serializeCookie(name, value, maxAge) {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export async function createAdminSessionCookie(env) {
  const secret = (env?.ADMIN_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('未配置 ADMIN_SESSION_SECRET');
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL;
  const payload = `v1.${exp}`;
  const signature = await signText(payload, secret);
  return serializeCookie(ADMIN_COOKIE_NAME, `${payload}.${signature}`, ADMIN_SESSION_TTL);
}

export function clearAdminSessionCookie() {
  return [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0',
  ].join('; ');
}

export async function hasValidAdminSession(request, env) {
  const secret = (env?.ADMIN_SESSION_SECRET || '').trim();
  if (!secret) return false;

  const raw = getCookie(request, ADMIN_COOKIE_NAME);
  if (!raw) return false;

  const [version, expRaw, signature] = raw.split('.');
  if (version !== 'v1' || !expRaw || !signature) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;

  const expected = await signText(`${version}.${expRaw}`, secret);
  return timingSafeEqual(signature, expected);
}
