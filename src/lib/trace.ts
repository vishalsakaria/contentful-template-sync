import { AsyncLocalStorage } from "node:async_hooks";
import { describeError, errorStatus } from "./cma";
import type { Trace, TraceStep } from "./trace-types";

/**
 * Per-run recorder. Anything executed inside `withTrace(...)` (including awaited and
 * concurrent work) records its API calls and mapping/decision steps here. Outside a trace
 * every helper is a no-op, so normal requests pay nothing.
 */
interface Ctx {
  steps: Array<Omit<TraceStep, "n">>;
}
const store = new AsyncLocalStorage<Ctx>();

const MAX_CHARS = 3500;

/** Keep payloads readable: oversized JSON is replaced with a truncated preview. */
export function clip(value: unknown, max = MAX_CHARS): unknown {
  if (value === undefined) return undefined;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  if (json.length <= max) return JSON.parse(json);
  return { "…truncated": `${json.length} chars`, preview: JSON.stringify(value, null, 1).slice(0, max) + " …" };
}

export function step(s: Omit<TraceStep, "n">) {
  store.getStore()?.steps.push({ ...s, from: clip(s.from), to: clip(s.to), request: clip(s.request), response: clip(s.response) });
}

export interface ApiMeta<T> {
  title: string;
  method: "GET" | "PUT" | "POST";
  url: string;
  write?: boolean;
  request?: unknown;
  /** status to show on success (the SDK does not expose it) */
  okStatus?: number;
  summarize?: (res: T) => unknown;
}

/** Run a Contentful call and, if a trace is active, record what was sent and received. */
export async function api<T>(meta: ApiMeta<T>, fn: () => Promise<T>): Promise<T> {
  const ctx = store.getStore();
  if (!ctx) return fn();
  const t0 = performance.now();
  const base = { kind: "api" as const, title: meta.title, method: meta.method, url: meta.url, write: meta.write ?? false };
  try {
    const res = await fn();
    ctx.steps.push({
      ...base,
      status: meta.okStatus ?? 200,
      ms: Math.round(performance.now() - t0),
      request: clip(meta.request),
      response: clip(meta.summarize ? meta.summarize(res) : res),
    });
    return res;
  } catch (err) {
    ctx.steps.push({
      ...base,
      status: errorStatus(err) ?? "error",
      ms: Math.round(performance.now() - t0),
      request: clip(meta.request),
      error: describeError(err),
    });
    throw err;
  }
}

export async function withTrace<T>(
  mode: Trace["mode"],
  fn: () => Promise<T>,
): Promise<{ result?: T; trace: Trace }> {
  const ctx: Ctx = { steps: [] };
  const startedAt = new Date().toISOString();
  let result: T | undefined;
  let error: string | undefined;
  await store.run(ctx, async () => {
    try {
      result = await fn();
    } catch (err) {
      error = describeError(err);
      ctx.steps.push({ kind: "decision", title: "The run stopped with an error", notes: [error], result: "error", status: "error" });
    }
  });
  const steps: TraceStep[] = ctx.steps.map((s, i) => ({ ...s, n: i + 1 }));
  const apis = steps.filter((s) => s.kind === "api");
  return {
    result,
    trace: {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      mode,
      startedAt,
      steps,
      summary: {
        calls: apis.length,
        writes: apis.filter((s) => s.write && s.status !== "error").length,
        ms: apis.reduce((t, s) => t + (s.ms ?? 0), 0),
      },
      ...(error ? { error } : {}),
    },
  };
}

/** One compact log line per call — used for webhook-triggered runs, which the dashboard can't replay. */
export function traceLogLines(trace: Trace): string[] {
  return trace.steps.map((s) =>
    s.kind === "api"
      ? `${s.n}. ${s.method} ${s.url} → ${s.status} (${s.ms}ms)${s.write ? " [write]" : ""}`
      : `${s.n}. ${s.title}${s.result ? ` → ${s.result}` : ""}`,
  );
}
