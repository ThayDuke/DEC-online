import { backendCall, cookieValue, verifySession } from '../_shared/auth.js';

export async function onRequestGet(context) {
  const session = await verifySession(cookieValue(context.request, 'DEC_SESSION'), context.env.SESSION_SIGNING_SECRET);
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const selected = session.selected_student_id || (session.students.length === 1 ? session.students[0].student_id : '');
  if (!selected) return Response.json({ error: 'select_student' }, { status: 409 });
  const manifestResponse = await context.env.ASSETS.fetch(new Request(new URL('/manifest/lesson-manifest.json', context.request.url)));
  if (!manifestResponse.ok) return Response.json({ error: 'manifest_unavailable' }, { status: 503 });
  const manifest = await manifestResponse.json();
  let permissions;
  let results;
  try {
    [permissions, results] = await Promise.all([
      backendCall(context.env, 'permissions', { student_ids: [selected] }),
      backendCall(context.env, 'results', { student_ids: [selected] }),
    ]);
  } catch (_parallelError) {
    // Apps Script Web Apps can reject concurrent executions during cold start.
    // Retry sequentially so a transient concurrency failure does not blank the catalog.
    permissions = await backendCall(context.env, 'permissions', { student_ids: [selected] });
    results = await backendCall(context.env, 'results', { student_ids: [selected] });
  }
  const tags = new Set((permissions[selected] || []).map((tag) => String(tag).toLowerCase()));
  const entries = (manifest.entries || [])
    .filter((entry) => entry.active !== false && (entry.tags || []).some((tag) => tags.has(String(tag).toLowerCase())))
    .map((entry) => ({ ...entry, result: results[selected]?.[entry.id] || null }));
  return Response.json({ student_id: selected, entries }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } });
}
