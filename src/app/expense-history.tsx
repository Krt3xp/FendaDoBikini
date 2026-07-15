"use client";

import { FormEvent, useMemo, useState } from "react";
import Image from "next/image";
import { ConfirmSubmitButton } from "./confirm-submit-button";
import { deleteExpense, updateExpense } from "./actions";
import { fieldClass, formatMoney } from "@/lib/utils";
import { getReceiptFileName, getReceiptPreviewUrl, getReceiptPreviewKind } from "@/lib/receipt";

type ExpenseHistoryCategory = {
  id: string;
  icon: string | null;
  name: string;
};

type ExpenseHistoryMember = {
  id: string;
  name: string;
  userId: string;
};

type ExpenseSplitItem = {
  id: string;
  debtorId: string;
  amountOwed: number;
};

type ExpenseHistoryItem = {
  amount: number;
  categoryId: string | null;
  categoryIcon: string | null;
  categoryName: string | null;
  currency: string;
  description: string | null;
  expenseDate: string;
  formattedDate: string;
  groupId: string;
  id: string;
  payerId: string;
  payerName: string;
  receiptMimeType: string | null;
  receiptName: string | null;
  receiptUrl: string | null;
  splits: ExpenseSplitItem[];
};

type SortOrder = "dateDesc" | "dateAsc" | "alphaAsc" | "alphaDesc";

// fieldClass, formatMoney — imported from @/lib/utils
// getReceiptFileName, getReceiptPreviewUrl, getReceiptPreviewKind — imported from @/lib/receipt

function getExpenseTitle(expense: ExpenseHistoryItem) {
  return expense.description?.trim() || "Commit sem descrição";
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

/**
 * Calcula percentuais iguais em basis points para os memberIds fornecidos.
 * Distribui o restante entre os primeiros para somar exatamente 10000 bps.
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
 * Card individual de uma despesa no histórico.
 * Permite expandir para editar descrição, valor, data, categoria,
 * pagador, participantes (split), e comprovante.
 */
function ExpenseHistoryCard({
  expense,
  categories,
  members,
}: {
  expense: ExpenseHistoryItem;
  categories: ExpenseHistoryCategory[];
  members: ExpenseHistoryMember[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false);
  const [isReceiptChecking, setIsReceiptChecking] = useState(false);
  const [isReceiptMissing, setIsReceiptMissing] = useState(false);

  const initialSplitMode = useMemo(() => {
    const amounts = expense.splits.map((s) => s.amountOwed);
    if (amounts.length <= 1) return "equal";
    const first = amounts[0];
    const allEqual = amounts.every((a) => Math.abs(a - first) < 0.05);
    return allEqual ? "equal" : "custom";
  }, [expense.splits]);

  const initialMemberIds = useMemo(() => {
    return expense.splits.map((s) => s.debtorId);
  }, [expense.splits]);

  const initialPercentages = useMemo(() => {
    const pct: Record<string, string> = {};
    expense.splits.forEach((s) => {
      const ratio = expense.amount > 0 ? (s.amountOwed / expense.amount) * 100 : 0;
      pct[s.debtorId] = ratio.toFixed(2);
    });
    return pct;
  }, [expense.splits, expense.amount]);

  const [splitMode, setSplitMode] = useState<"equal" | "custom">(initialSplitMode);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(initialMemberIds);
  const [percentages, setPercentages] = useState<Record<string, string>>(initialPercentages);
  const [error, setError] = useState<string | null>(null);

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

  function updateSplitMode(nextSplitMode: "equal" | "custom") {
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

  const receiptPreviewUrl = getReceiptPreviewUrl(expense.receiptUrl);
  const receiptPreviewKind = getReceiptPreviewKind(expense.receiptMimeType);

  async function openReceiptPreview(url: string) {
    if (isReceiptPreviewOpen) {
      setIsReceiptPreviewOpen(false);
      return;
    }

    setIsReceiptChecking(true);
    setIsReceiptMissing(false);

    try {
      const response = await fetch(url, {
        method: "HEAD",
      });

      if (!response.ok) {
        setIsReceiptMissing(true);
        return;
      }

      setIsReceiptPreviewOpen(true);
    } catch {
      setIsReceiptMissing(true);
    } finally {
      setIsReceiptChecking(false);
    }
  }

  return (
    <article className="rounded-2xl border border-cyan-300/10 bg-slate-950/60 p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
        <div>
          <p className="font-semibold text-white">
            {getExpenseTitle(expense)}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {expense.categoryIcon}{" "}
            {expense.categoryName ?? "Sem categoria"} ·{" "}
            {expense.payerName} · {expense.formattedDate}
          </p>
        </div>
        <strong className="w-fit rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100">
          {formatMoney(expense.amount, expense.currency)}
        </strong>
        <button
          aria-expanded={isExpanded}
          className="w-fit rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/10 px-4 py-2 text-sm font-black text-fuchsia-100 transition hover:border-fuchsia-300/40 hover:bg-fuchsia-400/15"
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          {isExpanded ? "Recolher" : "Ampliar"}
        </button>
      </div>

      {isExpanded && (
        <form
          action={updateExpense}
          className="mt-4 grid gap-4 border-t border-cyan-300/10 pt-4"
          onSubmit={handleSubmit}
        >
          <input name="expenseId" type="hidden" value={expense.id} />
          <input name="groupId" type="hidden" value={expense.groupId} />
          <input name="actorId" type="hidden" value={expense.payerId} />
          <input name="splitMode" type="hidden" value={splitMode} />

          {receiptPreviewUrl && (
            <button
              aria-expanded={isReceiptPreviewOpen}
              className="w-fit rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/15 disabled:cursor-wait disabled:opacity-60"
              disabled={isReceiptChecking}
              onClick={() => openReceiptPreview(receiptPreviewUrl)}
              type="button"
            >
              {isReceiptChecking ? "Carregando..." : "Ver comprovante"}
            </button>
          )}

          {isReceiptMissing && (
            <p className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-sm font-semibold text-orange-200">
              Comprovante não encontrado no servidor. Envie o arquivo
              novamente para atualizar o registro.
            </p>
          )}

          {isReceiptPreviewOpen && receiptPreviewUrl && (
            <div className="grid gap-3 rounded-3xl border border-emerald-300/15 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-emerald-100">
                    {expense.receiptName ?? "Comprovante"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {expense.receiptMimeType ?? "Tipo não informado"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15"
                    href={receiptPreviewUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Abrir em nova aba
                  </a>
                  <button
                    className="rounded-full border border-slate-500/30 bg-slate-800/70 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-400/50 hover:bg-slate-700/80"
                    onClick={() => setIsReceiptPreviewOpen(false)}
                    type="button"
                  >
                    Fechar comprovante
                  </button>
                </div>
              </div>

              {receiptPreviewKind === "image" && (
                <div className="relative h-[34rem] w-full overflow-hidden rounded-2xl border border-emerald-300/10 bg-slate-950">
                  <Image
                    alt={`Comprovante de ${getExpenseTitle(expense)}`}
                    className="object-contain"
                    fill
                    sizes="100vw"
                    src={receiptPreviewUrl}
                    unoptimized
                  />
                </div>
              )}

              {receiptPreviewKind === "pdf" && (
                <iframe
                  className="h-[34rem] w-full rounded-2xl border border-emerald-300/10 bg-slate-950"
                  src={receiptPreviewUrl}
                  title={`Comprovante de ${getExpenseTitle(expense)}`}
                />
              )}

              {receiptPreviewKind === "download" && (
                <div className="rounded-2xl border border-dashed border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">
                  Preview indisponível para este tipo de arquivo.
                  <a
                    className="ml-2 font-black underline decoration-emerald-300/60 underline-offset-4"
                    download={expense.receiptName ?? true}
                    href={receiptPreviewUrl}
                  >
                    Baixar comprovante
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Descrição
              <input
                className={fieldClass}
                defaultValue={expense.description ?? ""}
                name="description"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Valor
              <input
                className={fieldClass}
                defaultValue={expense.amount.toFixed(2)}
                min="0.01"
                name="amount"
                required
                step="0.01"
                type="number"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Moeda
              <input
                className={fieldClass}
                defaultValue={expense.currency}
                name="currency"
                required
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Data
              <input
                className={fieldClass}
                defaultValue={expense.expenseDate}
                name="expenseDate"
                required
                type="date"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Categoria
              <select
                className={fieldClass}
                defaultValue={expense.categoryId ?? ""}
                name="categoryId"
              >
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.icon} {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
              Quem pagou
              <select
                className={fieldClass}
                defaultValue={expense.payerId}
                name="payerId"
                required
              >
                {members.map((member) => (
                  <option key={member.id} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="grid gap-3 rounded-3xl border border-cyan-300/10 bg-slate-950/45 p-4 md:col-span-2">
              <legend className="px-1 text-sm font-semibold text-cyan-100">
                Dividir igualmente?
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 cursor-pointer">
                  <input
                    checked={splitMode === "equal"}
                    className="size-4 accent-teal-500"
                    name="splitModeChoice"
                    onChange={() => updateSplitMode("equal")}
                    type="radio"
                  />
                  Sim, partes iguais
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/10 px-4 py-3 text-sm text-fuchsia-100 cursor-pointer">
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

            <fieldset className="grid gap-3 md:col-span-2">
              <legend className="text-sm font-medium text-cyan-100/90">
                Participantes da divisão
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {members.map((member) => {
                  const isSelected = selectedMemberIds.includes(member.userId);

                  return (
                    <div
                      className="grid gap-2 rounded-2xl border border-cyan-300/15 bg-slate-950/65 px-4 py-3 text-sm text-slate-200"
                      key={member.userId}
                    >
                      <label className="flex items-center gap-2 cursor-pointer">
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
                className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                  percentageTotal === 10000
                    ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                    : "border-orange-300/20 bg-orange-400/10 text-orange-200"
                }`}
              >
                Total informado: {(percentageTotal / 100).toFixed(2)}%
              </div>
            )}

            {error && (
              <p className="md:col-span-2 rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-sm font-semibold text-orange-200">
                {error}
              </p>
            )}

            <label className="grid gap-2 text-sm font-medium text-cyan-100/90 md:col-span-2">
              Comprovante
              <input
                accept="application/pdf,image/jpeg,image/png,image/webp,image/gif"
                className={fieldClass}
                name="receipt"
                type="file"
              />
              <span className="text-xs text-slate-500">
                {expense.receiptName
                  ? `Atual: ${expense.receiptName}. Envie outro arquivo para substituir.`
                  : "PDF, JPEG, PNG, WEBP ou GIF até 8 MB."}
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              disabled={!canSubmit}
            >
              Editar
            </button>
            <ConfirmSubmitButton
              className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-5 py-3 text-sm font-black text-orange-200 transition hover:border-orange-300/40 hover:bg-orange-400/15"
              formAction={deleteExpense}
              formNoValidate
              message={`Eliminar o commit "${getExpenseTitle(expense)}"?`}
            >
              Eliminar
            </ConfirmSubmitButton>
          </div>
        </form>
      )}
    </article>
  );
}

/**
 * Componente de histórico de despesas de um grupo.
 * Oferece busca textual, filtro por data, ordenação
 * (cronológica ou alfabética) e listagem paginada dos commits.
 */
export function ExpenseHistory({
  categories,
  expenses,
  members,
}: {
  categories: ExpenseHistoryCategory[];
  expenses: ExpenseHistoryItem[];
  members: ExpenseHistoryMember[];
}) {
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("dateDesc");

  const filteredExpenses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    return expenses
      .filter((expense) => {
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [
            expense.description,
            expense.categoryName,
            expense.payerName,
            expense.currency,
            formatMoney(expense.amount, expense.currency),
          ]
            .filter(Boolean)
            .some((value) =>
              String(value).toLocaleLowerCase("pt-BR").includes(normalizedQuery),
            );
        const matchesDate =
          dateFilter.length === 0 || expense.expenseDate === dateFilter;

        return matchesQuery && matchesDate;
      })
      .sort((a, b) => {
        if (sortOrder === "alphaAsc") {
          return getExpenseTitle(a).localeCompare(getExpenseTitle(b), "pt-BR");
        }

        if (sortOrder === "alphaDesc") {
          return getExpenseTitle(b).localeCompare(getExpenseTitle(a), "pt-BR");
        }

        if (sortOrder === "dateAsc") {
          return a.expenseDate.localeCompare(b.expenseDate);
        }

        return b.expenseDate.localeCompare(a.expenseDate);
      });
  }, [dateFilter, expenses, query, sortOrder]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function clearFilters() {
    setQuery("");
    setDateFilter("");
    setSortOrder("dateDesc");
  }

  return (
    <section className="rounded-3xl border border-cyan-300/10 bg-slate-900/55 p-5 text-slate-100 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Histórico
          </p>
          <h4 className="mt-1 text-xl font-bold text-white">
            Commits de gastos do grupo
          </h4>
        </div>
        <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-100">
          {filteredExpenses.length} de {expenses.length}
        </span>
      </div>

      <form
        className="mt-5 grid gap-3 rounded-3xl border border-cyan-300/10 bg-slate-950/45 p-4 lg:grid-cols-[1fr_190px_190px_auto]"
        onSubmit={handleSearchSubmit}
      >
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Buscar
          <input
            className={fieldClass}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Descrição, pagador, categoria..."
            type="search"
            value={query}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Data
          <input
            className={fieldClass}
            onChange={(event) => setDateFilter(event.target.value)}
            type="date"
            value={dateFilter}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Ordem
          <select
            className={fieldClass}
            onChange={(event) => setSortOrder(event.target.value as SortOrder)}
            value={sortOrder}
          >
            <option value="dateDesc">Cronológica: mais recentes</option>
            <option value="dateAsc">Cronológica: mais antigas</option>
            <option value="alphaAsc">Alfabética: A-Z</option>
            <option value="alphaDesc">Alfabética: Z-A</option>
          </select>
        </label>
        <button
          className="self-end rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-sm font-black text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15"
          onClick={clearFilters}
          type="button"
        >
          Limpar
        </button>
      </form>

      <div className="mt-4 grid gap-3">
        {filteredExpenses.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/45 p-4 text-sm text-slate-400">
            Nenhum commit de gasto encontrado com esses filtros.
          </p>
        ) : (
          filteredExpenses.map((expense) => (
            <ExpenseHistoryCard
              categories={categories}
              expense={expense}
              key={expense.id}
              members={members}
            />
          ))
        )}
      </div>
    </section>
  );
}
