"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // espelha o TTL do token no backend

export interface AuthFormState {
  error: string | null;
}

/** Grava o token de sessão em cookie httpOnly e vai para o dashboard. */
async function establishSession(token: string): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

/**
 * Chama um endpoint de auth do backend com FormData e devolve
 * { token } em caso de sucesso ou { error } amigável em caso de falha.
 */
async function callAuthEndpoint(endpoint: string, formData: FormData): Promise<{ token?: string; error?: string }> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/${endpoint}`, {
      method: "POST",
      body: formData,
      cache: "no-store",
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { error: data?.detail ?? `Erro inesperado (${response.status})` };
    }
    return { token: data.token };
  } catch {
    return { error: "Não foi possível falar com o servidor. Tente novamente." };
  }
}

/** Server action de login (email + senha). */
export async function login(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = await callAuthEndpoint("login", formData);
  if (result.error || !result.token) {
    return { error: result.error ?? "Falha no login" };
  }
  return establishSession(result.token);
}

/** Server action de primeiro acesso: define a senha e já entra. */
export async function setupPassword(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = formData.get("password");
  const confirm = formData.get("passwordConfirm");
  if (typeof password !== "string" || password !== confirm) {
    return { error: "As senhas não conferem" };
  }
  formData.delete("passwordConfirm");

  const result = await callAuthEndpoint("setup-password", formData);
  if (result.error || !result.token) {
    return { error: result.error ?? "Falha ao definir a senha" };
  }
  return establishSession(result.token);
}

/** Encerra a sessão atual e volta para a tela de login. */
export async function logout(): Promise<never> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
