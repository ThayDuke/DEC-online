// Cloudflare Pages Function: POST /api/adaptive/stop

import { generateResultPayload } from "./_engine.js";
import { verifySession } from "./_security.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const secret = env?.ADAPTIVE_SECRET;

    const token = body.session_id;
    if (!token) {
      return new Response(JSON.stringify({ ok: true, status: "stopped_without_token" }), {
        status: 200,
        headers: CORS_HEADERS
      });
    }

    const session = await verifySession(token, secret);
    const result = generateResultPayload(session, true);

    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }
}
