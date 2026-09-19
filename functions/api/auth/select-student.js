import { cookieValue, signSession, verifySession } from '../../_shared/auth.js';

export async function onRequestPost(context) {
  const session = await verifySession(cookieValue(context.request, 'DEC_SESSION'), context.env.SESSION_SIGNING_SECRET);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let body;
  try { body = await context.request.json(); } catch (_error) { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
  const studentId = String(body.student_id || '');
  if (!session.students.some((student) => student.student_id === studentId)) {
    return Response.json({ error: 'student_not_available' }, { status: 403 });
  }
  const next = await signSession({ ...session, selected_student_id: studentId }, context.env.SESSION_SIGNING_SECRET);
  return Response.json({ ok: true, student_id: studentId }, {
    headers: { 'Set-Cookie': `DEC_SESSION=${next}; Max-Age=${60 * 60 * 24 * 30}; Path=/; HttpOnly; Secure; SameSite=Lax`, 'Cache-Control': 'no-store' },
  });
}
