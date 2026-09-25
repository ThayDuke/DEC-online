// Cloudflare Pages Function: POST /api/adaptive/answer

import { processAnswer } from "./_engine.js";
import { verifySession, signSession } from "./_security.js";

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
      throw new Error("Missing session_id");
    }

    const session = await verifySession(token, secret);
    const itemId = body.item_id;
    const selectedIndex = body.selected_index;
    const responseTimeSec = body.response_time_sec || 0;

    const outcome = processAnswer(session, itemId, selectedIndex, responseTimeSec);
    const updatedToken = await signSession(outcome.session, secret);

    const responsePayload = {
      ok: true,
      session_id: updatedToken,
      is_correct: outcome.is_correct,
      correct_option_index: outcome.correct_option_index,
      correct_option_text: outcome.correct_option_text,
      questions_answered: outcome.questions_answered,
      correct_count: outcome.correct_count,
      stop_flag: outcome.stop_flag,
      next_item: outcome.next_item || null,
      current_item: outcome.next_item || null,
      ability: outcome.session.ability,
      estimated_ability: outcome.session.ability,
      SE: outcome.session.se,
      se: outcome.session.se,
      result: outcome.result || null
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: CORS_HEADERS
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message || "Failed to process answer" }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }
}
