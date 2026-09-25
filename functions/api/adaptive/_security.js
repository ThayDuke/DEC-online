// Cloudflare Pages Functions - Adaptive Session Security (Web Crypto API)

const DEFAULT_SECRET = "DEC_ADAPTIVE_SEC_v1_2026_CF_PAGES";

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function getHmacKey(secret = DEFAULT_SECRET) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret || DEFAULT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(payload, secret = DEFAULT_SECRET) {
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = toBase64Url(payloadStr);

  const key = await getHmacKey(secret);
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );

  let binarySig = "";
  const sigView = new Uint8Array(signatureBytes);
  for (let i = 0; i < sigView.length; i++) {
    binarySig += String.fromCharCode(sigView[i]);
  }
  const signatureB64 = btoa(binarySig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${payloadB64}.${signatureB64}`;
}

export async function verifySession(token, secret = DEFAULT_SECRET) {
  if (!token || typeof token !== "string") {
    throw new Error("Missing session token");
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("Invalid session token format");
  }

  const [payloadB64, signatureB64] = parts;
  const key = await getHmacKey(secret);

  let base64Sig = signatureB64.replace(/-/g, "+").replace(/_/g, "/");
  while (base64Sig.length % 4) {
    base64Sig += "=";
  }
  const binarySig = atob(base64Sig);
  const sigBytes = new Uint8Array(binarySig.length);
  for (let i = 0; i < binarySig.length; i++) {
    sigBytes[i] = binarySig.charCodeAt(i);
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(payloadB64)
  );

  if (!valid) {
    throw new Error("Tampered or invalid session signature");
  }

  const payloadStr = fromBase64Url(payloadB64);
  const payload = JSON.parse(payloadStr);

  if (payload.exp && Date.now() > payload.exp) {
    throw new Error("Session expired");
  }

  return payload;
}
