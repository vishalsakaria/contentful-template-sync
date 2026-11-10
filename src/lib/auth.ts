/**
 * Minimal shared-password auth. The cookie holds an HMAC of a constant keyed with the
 * password — never the password itself. Uses Web Crypto so it works in proxy.ts and routes.
 */
export const SESSION_COOKIE = "cts_session";

const enc = new TextEncoder();

export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("contentful-template-sync/session/v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** True if the request carries a valid session cookie or `Authorization: Bearer <password>`. */
export async function isAuthorized(
  password: string | undefined,
  cookieValue: string | undefined,
  authorizationHeader: string | null,
): Promise<boolean> {
  if (!password) return false;
  if (authorizationHeader?.startsWith("Bearer ") && safeEqual(authorizationHeader.slice(7), password)) return true;
  if (cookieValue && safeEqual(cookieValue, await sessionToken(password))) return true;
  return false;
}
