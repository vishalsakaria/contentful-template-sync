import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { listTargets } from "@/lib/installations";
import { rolloutToTarget } from "@/lib/rollout";
import { getTemplate } from "@/lib/template";
import { describeError } from "@/lib/cma";
import { withTrace } from "@/lib/trace";

export const maxDuration = 120;

/**
 * Manual "Install latest" for one environment. This deliberately ignores the
 * additive-only hold: a human clicking the button is the approval for a held change.
 */
export async function POST(request: Request) {
  const cfg = getConfig();
  const body = (await request.json().catch(() => ({}))) as {
    templateId?: string;
    spaceId?: string;
    environmentId?: string;
  };
  const templateId = body.templateId && cfg.TEMPLATE_IDS.includes(body.templateId) ? body.templateId : cfg.TEMPLATE_IDS[0];
  if (!body.spaceId || !body.environmentId) {
    return NextResponse.json({ error: "spaceId and environmentId are required" }, { status: 400 });
  }
  if (body.spaceId === cfg.SOURCE_SPACE_ID && body.environmentId === cfg.SOURCE_ENVIRONMENT_ID) {
    return NextResponse.json({ error: "The source environment is never a rollout target" }, { status: 400 });
  }

  try {
    const { result: out, trace } = await withTrace("live", async () => {
      const template = await getTemplate(templateId);
      const targets = await listTargets(templateId);
      const target = targets.find((t) => t.spaceId === body.spaceId && t.environmentId === body.environmentId);
      if (!target) return null;
      return rolloutToTarget(templateId, target, Number(template.sys.version));
    });
    if (trace.error) {
      return NextResponse.json({ error: trace.error, trace }, { status: 502 });
    }
    if (!out) {
      return NextResponse.json({ error: "That environment does not have this template installed" }, { status: 404 });
    }
    return NextResponse.json({ result: out, trace });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 502 });
  }
}
