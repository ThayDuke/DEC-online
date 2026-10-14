import { startSession } from "./_engine.js";
import { signSession } from "../adaptive/_security.js";

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
    const result = startSession(body);
    const session_id = await signSession(result.session, context.env?.ADAPTIVE_SECRET);
    return new Response(JSON.stringify({ ok: true, session_id, ...result, session: undefined }), { headers: HEADERS });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message || "Failed to start quiz" }), { status: 400, headers: HEADERS });
  }
}
