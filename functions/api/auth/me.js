import { cookieValue, verifySession } from '../../_shared/auth.js';

export async function onRequestGet(context) {
  const session = await verifySession(cookieValue(context.request, 'DEC_SESSION'), context.env.SESSION_SIGNING_SECRET);
  if (!session) return Response.json({ authenticated: false }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ authenticated: true, email: session.email, students: session.students }, { headers: { 'Cache-Control': 'no-store' } });
}
