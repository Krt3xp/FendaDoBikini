"use client";

import { useActionState, useState } from "react";
import { login, setupPassword, type AuthFormState } from "./actions";

const initialState: AuthFormState = { error: null };

const inputClass =
  "w-full rounded-2xl border border-cyan-300/20 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-cyan-300/50 focus:bg-slate-900";
const labelClass =
  "text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200";

export default function LoginForm({ firstAccessEnabled }: { firstAccessEnabled: boolean }) {
  const [firstAccess, setFirstAccess] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(login, initialState);
  const [setupState, setupAction, setupPending] = useActionState(setupPassword, initialState);

  const state = firstAccess ? setupState : loginState;
  const pending = firstAccess ? setupPending : loginPending;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="neon-glow w-full max-w-md rounded-[2rem] border border-cyan-300/20 bg-slate-950/85 p-8 text-white backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-cyan-300/10 p-5">
          <div className="absolute -right-10 -top-10 size-32 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <p className="relative text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
            Fenda do Biquíni
          </p>
          <h1 className="relative mt-3 text-2xl font-black tracking-tight">
            Split Lab
          </h1>
          <p className="relative mt-2 text-sm leading-6 text-slate-300">
            {firstAccess
              ? "Primeiro acesso: defina sua senha para entrar."
              : "Entre com seu e-mail de morador."}
          </p>
        </div>

        <form
          action={firstAccess ? setupAction : loginAction}
          className="mt-6 flex flex-col gap-4"
        >
          <label className="flex flex-col gap-2">
            <span className={labelClass}>E-mail</span>
            <input
              autoComplete="email"
              className={inputClass}
              name="email"
              placeholder="voce@fenda.br"
              required
              type="email"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className={labelClass}>Senha</span>
            <input
              autoComplete={firstAccess ? "new-password" : "current-password"}
              className={inputClass}
              minLength={firstAccess ? 8 : undefined}
              name="password"
              placeholder={firstAccess ? "Mínimo 8 caracteres" : "Sua senha"}
              required
              type="password"
            />
          </label>

          {firstAccess ? (
            <label className="flex flex-col gap-2">
              <span className={labelClass}>Confirmar senha</span>
              <input
                autoComplete="new-password"
                className={inputClass}
                minLength={8}
                name="passwordConfirm"
                placeholder="Repita a senha"
                required
                type="password"
              />
            </label>
          ) : null}

          {state.error ? (
            <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {state.error}
            </p>
          ) : null}

          <button
            className="rounded-2xl border border-cyan-300/25 bg-cyan-300/15 px-4 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.12)] transition hover:bg-cyan-300/25 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Entrando..." : firstAccess ? "Definir senha e entrar" : "Entrar"}
          </button>
        </form>

        {firstAccessEnabled ? (
        <button
          className="mt-4 w-full text-center text-xs font-medium text-slate-400 transition hover:text-cyan-200"
          onClick={() => setFirstAccess((value) => !value)}
          type="button"
        >
          {firstAccess
            ? "Já tenho senha — voltar ao login"
            : "Primeiro acesso? Definir minha senha"}
        </button>
        ) : null}
      </div>
    </main>
  );
}
