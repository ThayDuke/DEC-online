const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_CERTS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function textToBytes(value) {
  return new TextEncoder().encode(value);
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', textToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, textToBytes(value)));
}

async function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(payload, secret) {
  const body = bytesToBase64Url(textToBytes(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(body, secret));
  return `${body}.${signature}`;
}

export async function verifySession(value, secret) {
  if (!value || !secret) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  const expected = await hmac(body, secret);
  if (!await constantTimeEqual(expected, base64UrlToBytes(signature))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
    if (!payload.email || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

export function cookieValue(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sessionCookie(value, maxAge = 60 * 60 * 24 * 30) {
  return `DEC_SESSION=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return 'DEC_SESSION=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
}

function parseJwt(value) {
  const [encodedHeader, encodedPayload, encodedSignature] = String(value || '').split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('invalid_id_token');
  return {
    encodedHeader,
    encodedPayload,
    encodedSignature,
    header: JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedHeader))),
    payload: JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))),
  };
}

async function verifyGoogleIdToken(idToken, env, expectedNonce) {
  const parsed = parseJwt(idToken);
  const { payload, header } = parsed;
  if (header.alg !== 'RS256' || payload.iss !== 'https://accounts.google.com' || payload.aud !== env.GOOGLE_CLIENT_ID || (expectedNonce && payload.nonce !== expectedNonce)) {
    throw new Error('invalid_google_claims');
  }
  if (!payload.email || payload.email_verified !== true || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('unverified_google_account');
  }
  const keysResponse = await fetch(GOOGLE_CERTS_ENDPOINT);
  if (!keysResponse.ok) throw new Error('google_keys_unavailable');
  const keys = await keysResponse.json();
  const jwk = keys.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('google_key_not_found');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parsed.encodedSignature), textToBytes(`${parsed.encodedHeader}.${parsed.encodedPayload}`));
  if (!valid) throw new Error('invalid_google_signature');
  return { email: payload.email.trim().toLowerCase(), name: payload.name || '' };
}

export async function exchangeGoogleCode(code, request, env, expectedNonce) {
  const redirectUri = new URL('/api/auth/callback', request.url).toString();
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) throw new Error('google_code_exchange_failed');
  const tokens = await response.json();
  return verifyGoogleIdToken(tokens.id_token, env, expectedNonce);
}

export function randomToken(length = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return bytesToBase64Url(bytes);
}

export async function backendCall(env, action, body = {}) {
  if (!env.DEC_BACKEND_URL || !env.DEC_BACKEND_SECRET) throw new Error('backend_not_configured');
  const response = await fetch(env.DEC_BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, secret: env.DEC_BACKEND_SECRET, ...body }),
  });
  if (!response.ok) throw new Error('backend_request_failed');
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'backend_rejected');
  return result.result;
}
