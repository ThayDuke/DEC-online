import { nextBlock } from "./_engine.js";
import { verifySession, signSession } from "../adaptive/_security.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

export function onRequestOptions() { return new Response(null, { headers: HEADERS }); }

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const token = body.session_id || context.request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const session = await verifySession(token, context.env?.ADAPTIVE_SECRET);
    if (Number(session.offset) >= Number(session.total)) {
      return new Response(JSON.stringify({ ok: true, session_id: token, questions: [], block_index: Math.ceil(session.total / 10), total: session.total, has_more: false, block_size: 10 }), { headers: HEADERS });
    }
    const result = nextBlock(session);
    const session_id = await signSession(result.session, context.env?.ADAPTIVE_SECRET);
    return new Response(JSON.stringify({ ok: true, session_id, ...result, session: undefined }), { headers: HEADERS });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message || "Failed to load quiz block" }), { status: 400, headers: HEADERS });
  }
}
