import { clearSessionCookie } from '../../_shared/auth.js';

export async function onRequestGet() {
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': clearSessionCookie() } });
}
