import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { runSyncSafely } from "@/lib/sync";
import { withTrace } from "@/lib/trace";

export const maxDuration = 300;

/** Force a sync of the whole template(s) without waiting for a webhook. Returns the API trace too. */
export async function POST(request: Request) {
  const cfg = getConfig();
  const body = (await request.json().catch(() => ({}))) as { templateId?: string };
  const ids = body.templateId && cfg.TEMPLATE_IDS.includes(body.templateId) ? [body.templateId] : cfg.TEMPLATE_IDS;
  const { result, trace } = await withTrace("live", () => runSyncSafely(ids));
  return NextResponse.json({ results: result ?? [], trace });
}
