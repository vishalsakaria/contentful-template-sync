import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { traceDryRun } from "@/lib/sync";

export const maxDuration = 120;

/** Read-only: walks the sync pipeline and returns every API call + mapping step. Writes nothing. */
export async function POST(request: Request) {
  const cfg = getConfig();
  const body = (await request.json().catch(() => ({}))) as { templateId?: string };
  const ids = body.templateId && cfg.TEMPLATE_IDS.includes(body.templateId) ? [body.templateId] : cfg.TEMPLATE_IDS;
  const { trace } = await traceDryRun(ids);
  return NextResponse.json({ trace });
}
