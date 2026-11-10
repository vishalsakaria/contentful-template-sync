import { verifyRequest } from "@contentful/node-apps-toolkit";
import { safeEqual } from "./auth";

/**
 * Verify a Contentful webhook's request signature. Returns false (never throws) for a
 * missing, malformed, tampered or expired signature.
 */
export function verifyWebhookSignature(args: {
  secret: string;
  method: string;
  /** path + query exactly as Contentful called it */
  path: string;
  headers: Record<string, string>;
  body: string;
  ttlSeconds?: number;
}): boolean {
  try {
    return verifyRequest(
      args.secret,
      { method: args.method.toUpperCase() as "POST", path: args.path, headers: args.headers, body: args.body },
      args.ttlSeconds ?? 60,
    );
  } catch {
    return false;
  }
}

/**
 * Decide whether a webhook call is allowed. If no secret is configured, everything is allowed
 * (PoC convenience). Otherwise ONE of these must match the secret:
 *   - header  `x-webhook-secret: <secret>`        (Contentful: custom header)
 *   - header  `Authorization: Basic base64(user:<secret>)`  (Contentful: basic auth; any username)
 *   - a valid Contentful request signature        (Contentful: request verification)
 */
export function isWebhookAuthorized(args: {
  secret: string | undefined;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}): boolean {
  const { secret, headers } = args;
  if (!secret) return true;

  const custom = headers["x-webhook-secret"];
  if (custom && safeEqual(custom, secret)) return true;

  const auth = headers["authorization"];
  if (auth?.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = atob(auth.slice(6).trim());
      const password = decoded.slice(decoded.indexOf(":") + 1);
      if (decoded.includes(":") && safeEqual(password, secret)) return true;
    } catch {
      /* malformed base64 */
    }
  }

  if (headers["x-contentful-signature"]) {
    return verifyWebhookSignature({ secret, method: args.method, path: args.path, headers, body: args.body });
  }
  return false;
}

export type WebhookDecision =
  | { action: "sync"; contentTypeId: string; topic: string }
  | { action: "log-delete"; contentTypeId: string; topic: string }
  | { action: "ignore"; reason: string; topic: string };

interface WebhookBody {
  sys?: {
    id?: string;
    space?: { sys?: { id?: string } };
    environment?: { sys?: { id?: string } };
    contentType?: { sys?: { id?: string } };
  };
}

/** Decide what to do with a (signature-verified) webhook. Pure, so it is easy to test. */
export function decideWebhook(
  topic: string,
  body: WebhookBody,
  source: { spaceId: string; environmentId: string },
): WebhookDecision {
  const spaceId = body.sys?.space?.sys?.id;
  const environmentId = body.sys?.environment?.sys?.id;

  // Loop guard: only the source space/environment may trigger a sync.
  if (spaceId !== source.spaceId || environmentId !== source.environmentId) {
    return { action: "ignore", topic, reason: "not from the source space/environment" };
  }

  switch (topic) {
    case "ContentManagement.ContentType.publish": {
      const id = body.sys?.id;
      return id ? { action: "sync", contentTypeId: id, topic } : { action: "ignore", topic, reason: "no content type id" };
    }
    case "ContentManagement.EditorInterface.save": {
      const id = body.sys?.contentType?.sys?.id;
      return id ? { action: "sync", contentTypeId: id, topic } : { action: "ignore", topic, reason: "no content type id" };
    }
    case "ContentManagement.ContentType.delete": {
      const id = body.sys?.id ?? "unknown";
      return { action: "log-delete", contentTypeId: id, topic };
    }
    default:
      return { action: "ignore", topic, reason: "topic not handled" };
  }
}
