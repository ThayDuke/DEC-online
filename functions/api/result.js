import { backendCall, cookieValue, verifySession } from '../_shared/auth.js';

export async function onRequestPost(context) {
  const session = await verifySession(cookieValue(context.request, 'DEC_SESSION'), context.env.SESSION_SIGNING_SECRET);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const selected = session.selected_student_id || (session.students.length === 1 ? session.students[0].student_id : '');
  if (!selected) return Response.json({ error: 'select_student' }, { status: 409 });
  let body;
  try { body = await context.request.json(); } catch (_error) { return Response.json({ error: 'invalid_json' }, { status: 400 }); }
  const score = Number(body.score);
  const maxScore = Number(body.maxScore);
  const quizId = String(body.quizId || '');
  if (!quizId || !Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || score < 0 || score > maxScore) {
    return Response.json({ error: 'invalid_result' }, { status: 400 });
  }
  try {
    const result = await backendCall(context.env, 'upsert_result', {
      result: {
        student_id: selected,
        google_email: session.email,
        quiz_id: quizId,
        display_title: String(body.displayTitle || ''),
        score,
        max_score: maxScore,
        class_snapshot: String(body.classSnapshot || ''),
        school_year: String(body.schoolYear || ''),
      },
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (_error) {
    return Response.json({ error: 'result_backend_unavailable', retryable: true }, { status: 502 });
  }
}
