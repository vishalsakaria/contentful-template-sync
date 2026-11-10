import { after, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { log } from "@/lib/cma";
import { runSyncSafely } from "@/lib/sync";
import { traceLogLines, withTrace } from "@/lib/trace";
import { decideWebhook, isWebhookAuthorized } from "@/lib/webhook";

export const maxDuration = 300;

export async function POST(request: Request) {
  const cfg = getConfig();
  const raw = await request.text();
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  // Enforced only if CONTENTFUL_WEBHOOK_SECRET is set: secret header, Basic Auth, or signature.
  const allowed = isWebhookAuthorized({
    secret: cfg.CONTENTFUL_WEBHOOK_SECRET,
    method: request.method,
    path: url.pathname + url.search,
    headers,
    body: raw,
  });
  if (!allowed) {
    log("webhook.rejected", { reason: "unauthorized" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = headers["x-contentful-topic"] ?? "";
  let body: unknown = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const decision = decideWebhook(topic, body as never, {
    spaceId: cfg.SOURCE_SPACE_ID,
    environmentId: cfg.SOURCE_ENVIRONMENT_ID,
  });

  if (decision.action === "ignore") {
    log("webhook.ignored", { topic, reason: decision.reason });
    return NextResponse.json({ ok: true, ignored: decision.reason });
  }
  if (decision.action === "log-delete") {
    // Deleting a model is destructive: record it, never propagate it.
    log("webhook.delete-not-propagated", { topic, contentTypeId: decision.contentTypeId });
    return NextResponse.json({ ok: true, propagated: false });
  }

  log("webhook.accepted", { topic, contentTypeId: decision.contentTypeId });
  // Respond right away; do the work after the response is sent.
  after(async () => {
    const { result: results = [], trace } = await withTrace("live", () =>
      runSyncSafely(cfg.TEMPLATE_IDS, { contentTypeIds: [decision.contentTypeId] }),
    );
    // The dashboard can't replay webhook runs (no database), so keep a readable call log in Vercel.
    log("webhook.trace", { contentTypeId: decision.contentTypeId, calls: trace.summary.calls, writes: trace.summary.writes, ms: trace.summary.ms, steps: traceLogLines(trace) });
    log("webhook.done", { contentTypeId: decision.contentTypeId, results: results.map(summaryOf) });
  });
  return NextResponse.json({ ok: true, accepted: decision.contentTypeId });
}

function summaryOf(r: Awaited<ReturnType<typeof runSyncSafely>>[number]) {
  if ("error" in r) return { templateId: r.templateId, error: r.error };
  return {
    templateId: r.sync.templateId,
    sync: r.sync.status,
    toVersion: r.sync.toVersion,
    classification: r.sync.classification?.classification,
    rollout: r.rollout
      ? { held: r.rollout.held, outcomes: r.rollout.results.map((x) => `${x.spaceId}/${x.environmentId}:${x.outcome}`) }
      : undefined,
  };
}
