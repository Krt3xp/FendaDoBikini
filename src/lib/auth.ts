import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

/** Nome do cookie httpOnly que guarda o token de sessão (JWT do backend). */
export const SESSION_COOKIE = "fenda_session";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Lê o token de sessão do cookie da requisição atual (ou null). */
export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Valida o token de sessão contra o backend e retorna o morador logado.
 * Retorna null se não houver sessão ou se o token for inválido/expirado.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await getSessionToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SessionUser;
  } catch {
    return null;
  }
}
