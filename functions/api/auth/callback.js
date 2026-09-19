import { backendCall, cookieValue, exchangeGoogleCode, sessionCookie, signSession } from '../../../_shared/auth.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const state = url.searchParams.get('state');
  const expectedState = cookieValue(context.request, 'DEC_OAUTH_STATE');
  const expectedNonce = cookieValue(context.request, 'DEC_OAUTH_NONCE');
  const code = url.searchParams.get('code');
  if (!state || !expectedState || state !== expectedState || !code) return new Response('Invalid OAuth state.', { status: 400 });
  try {
    const identity = await exchangeGoogleCode(code, context.request, context.env, expectedNonce);
    const account = await backendCall(context.env, 'resolve_account', { email: identity.email });
    if (!account || !Array.isArray(account.students) || account.students.length === 0) {
      return new Response('Tài khoản Google chưa được cấp quyền. Vui lòng liên hệ giáo viên.', { status: 403 });
    }
    const payload = {
      email: identity.email,
      students: account.students.map((student) => ({ student_id: student.student_id, display_name: student.display_name })),
      exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 30),
    };
    const token = await signSession(payload, context.env.SESSION_SIGNING_SECRET);
    const headers = new Headers({ Location: '/' });
    headers.append('Set-Cookie', sessionCookie(token));
    headers.append('Set-Cookie', 'DEC_OAUTH_STATE=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
    headers.append('Set-Cookie', 'DEC_OAUTH_NONCE=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax');
    return new Response(null, { status: 302, headers });
  } catch (_error) {
    return new Response('Google authentication failed.', { status: 502 });
  }
}
