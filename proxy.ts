import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Pages need a signed-in session (an optimistic cookie check; every API route verifies the session itself).
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

// public/assets (background music) loads without a session so it can play on the login page too.
export const config = { matcher: ["/((?!api|login|assets|_next/static|_next/image|favicon.ico).*)"] };
