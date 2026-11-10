import { NextResponse } from "next/server";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || typeof body.password !== "string" || !safeEqual(body.password, password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure,
    // "none" lets the dashboard work inside a Contentful app iframe (requires secure)
    sameSite: secure ? "none" : "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
