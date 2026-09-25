// Cloudflare Pages Function: POST /api/adaptive/start

import { startSession } from "./_engine.js";
import { signSession } from "./_security.js";

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
    const { session, first_item } = startSession(body);
    const secret = env?.ADAPTIVE_SECRET;
    const token = await signSession(session, secret);

    const responsePayload = {
      ok: true,
      session_id: token,
      level: session.level,
      first_item,
      current_item: first_item,
      item: first_item,
      question_index: 1,
      max_questions: session.max_questions,
      min_questions: session.min_questions,
      target_se: session.target_se,
      questions_answered: 0,
      correct_count: 0,
      ability: session.ability,
      estimated_ability: session.ability,
      SE: session.se,
      se: session.se
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message || "Failed to start session" }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }
}
