"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { createExpense } from "./actions";
import { fieldClass } from "@/lib/utils";

type ExpenseFormCategory = {
  id: string;
  icon: string | null;
  name: string;
};

type ExpenseFormMember = {
  userId: string;
  name: string;
};

type ExpenseFormGroup = {
  defaultCurrency: string;
  id: string;
  members: ExpenseFormMember[];
  name: string;
};

type SplitMode = "equal" | "custom";

// fieldClass — imported from @/lib/utils

/**
 * Calcula percentuais iguais em basis points (centésimos de %) para os memberIds fornecidos.
 * Distribui o restante entre os primeiros membros para somar exatamente 10000 bps (100%).
 */
function getEqualPercentages(memberIds: string[]) {
  if (memberIds.length === 0) {
    return {};
  }

  const base = Math.floor(10000 / memberIds.length);
  let remainder = 10000 % memberIds.length;

  return Object.fromEntries(
    memberIds.map((memberId) => {
      const basisPoints = base + (remainder > 0 ? 1 : 0);

      if (remainder > 0) {
        remainder -= 1;
      }

      return [memberId, (basisPoints / 100).toFixed(2)];
    }),
  );
}

/**
 * Converte uma string de percentual para basis points (centésimos de %).
 * Trata vírgula como separador decimal e retorna 0 para valores inválidos.
 */
function parsePercentage(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

// TODO: Adicionar loading state e feedback visual após submit
/**
 * Formulário de criação de despesas ("commits de gastos").
 * Permite escolher pagador, participantes, modo de split (igual ou custom)
 * e enviar comprovante. Suporta validação client-side de percentuais.
 */
export function ExpenseForm({
  categories,
  group,
  today,
}: {
  categories: ExpenseFormCategory[];
  group: ExpenseFormGroup;
  today: string;
}) {
  const initialMemberIds = useMemo(
    () => group.members.map((member) => member.userId),
    [group.members],
  );
  const [selectedMemberIds, setSelectedMemberIds] = useState(initialMemberIds);
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [percentages, setPercentages] = useState(() =>
    getEqualPercentages(initialMemberIds),
  );
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const percentageTotal = selectedMemberIds.reduce(
    (sum, memberId) => sum + parsePercentage(percentages[memberId] ?? "0"),
    0,
  );
  const canSubmit =
    selectedMemberIds.length > 0 &&
    (splitMode === "equal" || percentageTotal === 10000);

  function updateSelectedMember(memberId: string, checked: boolean) {
    const nextSelectedMemberIds = checked
      ? [...selectedMemberIds, memberId]
      : selectedMemberIds.filter((selectedMemberId) => selectedMemberId !== memberId);

    setSelectedMemberIds(nextSelectedMemberIds);

    if (splitMode === "custom") {
      setPercentages(getEqualPercentages(nextSelectedMemberIds));
    }
  }

  function updateSplitMode(nextSplitMode: SplitMode) {
    setSplitMode(nextSplitMode);
    setError(null);

    if (nextSplitMode === "custom") {
      setPercentages(getEqualPercentages(selectedMemberIds));
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (selectedMemberIds.length === 0) {
      event.preventDefault();
      setError("Selecione ao menos um participante.");
      return;
    }

    if (splitMode === "custom" && percentageTotal !== 10000) {
      event.preventDefault();
      setError("A soma das porcentagens precisa ser exatamente 100%.");
      return;
    }

    setError(null);
  }

  if (!isFormOpen) {
    return (
      <section className="rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Commits de gastos
            </p>
            <h4 className="mt-1 text-xl font-bold text-white">
              Novo commit em {group.name}
            </h4>
          </div>
          <button
            aria-expanded={isFormOpen}
            className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)]"
            onClick={() => setIsFormOpen(true)}
            type="button"
          >
            + Novo commit
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      action={createExpense}
      className="grid gap-4 rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5"
      onSubmit={handleSubmit}
    >
      <input name="groupId" type="hidden" value={group.id} />
      <input name="splitMode" type="hidden" value={splitMode} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="font-semibold text-white">
          Novo commit de gasto em {group.name}
        </h4>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15"
            href="/?view=categorias"
          >
            Criar nova categoria
          </Link>
          <button
            className="rounded-full border border-slate-500/30 bg-slate-800/70 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-400/50 hover:bg-slate-700/80"
            onClick={() => {
              setError(null);
              setIsFormOpen(false);
            }}
            type="button"
          >
            Fechar
          </button>
        </div>
      </div>

      <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
        Descrição
        <input
          className={fieldClass}
          name="description"
          placeholder="Ex.: Mercado do fim de semana"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
        Comprovante
        <input
          accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
          className={fieldClass}
          name="receipt"
          type="file"
        />
        <span className="text-xs text-slate-500">
          PDF, JPEG, PNG, WEBP ou GIF até 8 MB.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Valor
          <input
            className={fieldClass}
            min="0.01"
            name="amount"
            placeholder="150.00"
            required
            step="0.01"
            type="number"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Moeda
          <input
            className={fieldClass}
            defaultValue={group.defaultCurrency}
            name="currency"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Data
          <input
            className={fieldClass}
            defaultValue={today}
            name="expenseDate"
            required
            type="date"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Categoria
          <select className={fieldClass} name="categoryId">
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.icon} {category.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
        Quem pagou
        <select className={fieldClass} name="payerId" required>
          <option value="">Selecione o pagador</option>
          {group.members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-3 rounded-3xl border border-cyan-300/10 bg-slate-950/45 p-4">
        <legend className="px-1 text-sm font-semibold text-cyan-100">
          Dividir igualmente?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100">
            <input
              checked={splitMode === "equal"}
              className="size-4 accent-teal-500"
              name="splitModeChoice"
              onChange={() => updateSplitMode("equal")}
              type="radio"
            />
            Sim, partes iguais
          </label>
          <label className="flex items-center gap-2 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/10 px-4 py-3 text-sm text-fuchsia-100">
            <input
              checked={splitMode === "custom"}
              className="size-4 accent-fuchsia-500"
              name="splitModeChoice"
              onChange={() => updateSplitMode("custom")}
              type="radio"
            />
            Não, usar porcentagens
          </label>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium text-cyan-100/90">
          Participantes da divisão
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {group.members.map((member) => {
            const isSelected = selectedMemberIds.includes(member.userId);

            return (
              <div
                className="grid gap-2 rounded-2xl border border-cyan-300/15 bg-slate-950/65 px-4 py-3 text-sm text-slate-200"
                key={member.userId}
              >
                <label className="flex items-center gap-2">
                  <input
                    checked={isSelected}
                    className="size-4 accent-teal-600"
                    name="participantIds"
                    onChange={(event) =>
                      updateSelectedMember(member.userId, event.target.checked)
                    }
                    type="checkbox"
                    value={member.userId}
                  />
                  {member.name}
                </label>

                {splitMode === "custom" && (
                  <label className="grid gap-1 text-xs text-slate-400">
                    Porcentagem
                    <input
                      className={`${fieldClass} px-3 py-2 text-sm`}
                      disabled={!isSelected}
                      max="100"
                      min="0"
                      name={`splitPercentage:${member.userId}`}
                      onChange={(event) =>
                        setPercentages((currentPercentages) => ({
                          ...currentPercentages,
                          [member.userId]: event.target.value,
                        }))
                      }
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={percentages[member.userId] ?? "0.00"}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {splitMode === "custom" && (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            percentageTotal === 10000
              ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
              : "border-orange-300/20 bg-orange-400/10 text-orange-200"
          }`}
        >
          Total informado: {(percentageTotal / 100).toFixed(2)}%
        </div>
      )}

      {error && (
        <p className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-sm font-semibold text-orange-200">
          {error}
        </p>
      )}

      <button
        className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        disabled={!canSubmit}
        type="submit"
      >
        Commitar gasto
      </button>
    </form>
  );
}
