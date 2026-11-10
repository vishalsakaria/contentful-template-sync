import { NextResponse } from "next/server";
import { describeError } from "@/lib/cma";
import { getDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const templateId = new URL(request.url).searchParams.get("t") ?? undefined;
  try {
    return NextResponse.json(await getDashboardData(templateId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 502 });
  }
}
