import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized, SESSION_COOKIE } from "@/lib/auth";

/**
 * Gate the dashboard and the mutating/inspection API routes behind DASHBOARD_PASSWORD.
 * The Contentful webhook (/api/contentful/webhook, authenticated by signature) and the
 * login endpoints are excluded by the matcher.
 */
export async function proxy(request: NextRequest) {
  const ok = await isAuthorized(
    process.env.DASHBOARD_PASSWORD,
    request.cookies.get(SESSION_COOKIE)?.value,
    request.headers.get("authorization"),
  );
  if (ok) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/", "/api/sync", "/api/install", "/api/status", "/api/trace"],
};
