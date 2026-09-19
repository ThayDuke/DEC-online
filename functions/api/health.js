export async function onRequestGet(context) {
  return Response.json({
    service: 'dec-online',
    status: 'ok',
    auth_configured: Boolean(context.env.GOOGLE_CLIENT_ID && context.env.SESSION_SIGNING_SECRET),
    content_key_configured: Boolean(context.env.DEC_CONTENT_KEY_B64),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
