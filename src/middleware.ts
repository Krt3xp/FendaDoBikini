import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "fenda_session";

/**
 * Gate de sessão: sem cookie de sessão, toda rota (inclusive /receipts)
 * redireciona para /login. A validade real do token é verificada pelo
 * backend em cada acesso a dados — aqui é só UX/gating de rota.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
