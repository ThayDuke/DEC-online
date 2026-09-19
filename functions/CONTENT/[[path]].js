import { backendCall, base64UrlToBytes, cookieValue, verifySession } from '../_shared/auth.js';

async function decryptEnvelope(envelope, keyBytes) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'AES-256-GCM') {
    throw new Error('invalid encrypted lesson envelope');
  }
  const iv = base64UrlToBytes(envelope.iv);
  const tag = base64UrlToBytes(envelope.tag);
  const data = base64UrlToBytes(envelope.data);
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data);
  combined.set(tag, data.length);
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, combined);
  return new TextDecoder().decode(plain);
}

function reportingScript(entry) {
  const payload = JSON.stringify({ quizId: entry.id, displayTitle: entry.title }).replace(/<\/script/gi, '<\\/script');
  return `<script data-dec-online-report="1">(() => {
    const meta = ${payload};
    let pending = null;
    function banner(message, retry) {
      let node = document.getElementById('dec-online-report-status');
      if (!node) { node = document.createElement('div'); node.id = 'dec-online-report-status'; node.style = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:2147483647;padding:10px 14px;background:#fff3cd;color:#664d03;border:1px solid #ffecb5;border-radius:8px;font:14px sans-serif'; document.body.appendChild(node); }
      node.textContent = message;
      if (retry) { const button = document.createElement('button'); button.textContent = 'Gửi lại'; button.style = 'margin-left:10px'; button.onclick = () => window.DEC_REPORT_RESULT(pending); node.appendChild(button); }
    }
    window.DEC_REPORT_RESULT = async ({ score, maxScore }) => {
      pending = { score, maxScore };
      const response = await fetch('/api/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ ...meta, score, maxScore }) });
      if (!response.ok) { banner('Điểm chưa được ghi nhận online.', true); throw new Error('result_submit_failed'); }
      const node = document.getElementById('dec-online-report-status'); if (node) node.remove();
      banner('Đã ghi nhận kết quả.', false);
      setTimeout(() => { const current = document.getElementById('dec-online-report-status'); if (current) current.remove(); }, 3000);
      return response.json();
    };
  })();</script>`;
}

export async function onRequest(context) {
  // Fail closed until Google OAuth and manifest authorization are configured.
  if (!context.env.DEC_CONTENT_KEY_B64) {
    return new Response('Protected lesson service is not configured.', { status: 503 });
  }

  const session = await verifySession(cookieValue(context.request, 'DEC_SESSION'), context.env.SESSION_SIGNING_SECRET);
  if (!session) return new Response('Authentication required.', { status: 401 });
  const selectedStudentId = session.selected_student_id || (session.students.length === 1 ? session.students[0].student_id : '');
  if (!selectedStudentId) return new Response('Select a student first.', { status: 409 });

  const pathSegments = Array.isArray(context.params.path) ? context.params.path : [context.params.path || ''];
  const sourcePath = `/CONTENT/${pathSegments.join('/')}`;
  if (sourcePath.includes('..') || sourcePath.includes('\\')) return new Response('Not found', { status: 404 });
  const manifestResponse = await context.env.ASSETS.fetch(new Request(new URL('/manifest/lesson-manifest.json', context.request.url)));
  if (!manifestResponse.ok) return new Response('Protected lesson service is not configured.', { status: 503 });
  const manifest = await manifestResponse.json();
  const entry = (manifest.entries || []).find((item) => item.public_path === sourcePath && item.active !== false);
  if (!entry) return new Response('Not found', { status: 404 });
  const permissions = await backendCall(context.env, 'permissions', { student_ids: [selectedStudentId] });
  const studentTags = new Set((permissions[selectedStudentId] || []).map((tag) => String(tag).toLowerCase()));
  if (!(entry.tags || []).some((tag) => studentTags.has(String(tag).toLowerCase()))) return new Response('Not found', { status: 404 });

  const assetPath = `${sourcePath}.enc`;
  const assetResponse = await context.env.ASSETS.fetch(new Request(new URL(assetPath, context.request.url)));
  if (!assetResponse.ok) return new Response('Not found', { status: 404 });

  try {
    const envelope = await assetResponse.json();
    const keyBytes = base64UrlToBytes(context.env.DEC_CONTENT_KEY_B64);
    if (keyBytes.length !== 32) throw new Error('invalid_content_key');
    let html = await decryptEnvelope(envelope, keyBytes);
    html = html.includes('</body>') ? html.replace('</body>', `${reportingScript(entry)}</body>`) : `${html}${reportingScript(entry)}`;
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (_error) {
    return new Response('Protected lesson is unavailable.', { status: 503 });
  }
}
