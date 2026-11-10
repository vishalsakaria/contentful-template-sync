import { createClient, type PlainClientAPI } from "contentful-management";
import { getConfig } from "./config";

let client: PlainClientAPI | undefined;

/** Shared plain CMA client. The token is read from config and never logged. */
export function cma(): PlainClientAPI {
  if (!client) {
    client = createClient(
      { accessToken: getConfig().CONTENTFUL_CMA_TOKEN },
      { type: "plain" },
    );
  }
  return client;
}

/** Best-effort HTTP status extraction from the SDK's error objects. */
export function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { status?: number; response?: { status?: number }; message?: string };
  if (typeof e.status === "number") return e.status;
  if (typeof e.response?.status === "number") return e.response.status;
  const m = /"status"\s*:\s*(\d{3})/.exec(e.message ?? "");
  return m ? Number(m[1]) : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries 429s with exponential backoff (on top of the SDK's own rate-limit handling).
 */
export async function withBackoff<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let delay = 500;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (errorStatus(err) !== 429 || i >= attempts - 1) throw err;
      await sleep(delay + Math.random() * 250);
      delay *= 2;
    }
  }
}

/** Short, secret-free description of an error for logs and UI. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    // SDK errors embed a JSON blob in the message; keep the useful bits only.
    try {
      const parsed = JSON.parse(err.message) as { message?: string; details?: unknown; status?: number };
      const parts = [parsed.status ? `HTTP ${parsed.status}` : "", parsed.message ?? ""].filter(Boolean);
      if (parts.length) return parts.join(": ");
    } catch {
      /* not JSON */
    }
    return err.message.slice(0, 300);
  }
  return String(err).slice(0, 300);
}

export function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}
