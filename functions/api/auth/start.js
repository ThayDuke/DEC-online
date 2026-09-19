import { randomToken } from '../../_shared/auth.js';

export async function onRequestGet(context) {
  if (!context.env.GOOGLE_CLIENT_ID) return new Response('Google OAuth is not configured.', { status: 503 });
  const state = randomToken(24);
  const nonce = randomToken(24);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: context.env.GOOGLE_CLIENT_ID,
    redirect_uri: new URL('/api/auth/callback', context.request.url).toString(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  const headers = new Headers({ Location: url.toString() });
  headers.append('Set-Cookie', `DEC_OAUTH_STATE=${state}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
  headers.append('Set-Cookie', `DEC_OAUTH_NONCE=${nonce}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);
  return new Response(null, { status: 302, headers });
}
