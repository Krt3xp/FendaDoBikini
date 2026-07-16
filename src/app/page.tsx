import { DashboardData } from "@/types/dashboard";
import { formatMoney, formatPersonName, fieldClass, getTodayBRT } from "@/lib/utils";
import { getReceiptFileName, getReceiptPreviewUrl, getReceiptPreviewKind } from "@/lib/receipt";
import Link from "next/link";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";
import {
  addGroupMember,
  createCategory,
  createFavorCredit,
  createFixedBill,
  createGroup,
  createPantryPurchase,
  createSettlement,
  createUser,
  deleteFixedBill,
  deleteGroup,
  deletePantryItem,
  deleteUser,
  settleFavorCredit,
  toggleFixedBillPaid,
  updateGroup,
  updateUser,
} from "./actions";
import { ConfirmSubmitButton } from "./confirm-submit-button";
import { ExpenseForm } from "./expense-form";
import { ExpenseHistory } from "./expense-history";
import { SettlementList, SerializedSettlement } from "./settlement-list";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "UTC",
});
const timestampFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
});

const panelClass =
  "neon-glow rounded-[2rem] border border-cyan-300/15 bg-slate-950/70 p-6 text-slate-100 backdrop-blur-xl";
const softPanelClass =
  "rounded-3xl border border-cyan-300/10 bg-slate-900/55 p-5 text-slate-100 backdrop-blur";
const mutedTextClass = "text-slate-400";
const viewIds = [
  "dashboard",
  "usuarios",
  "grupos",
  "categorias",
  "despesas",
  "liquidacoes",
  "despensa",
] as const;

type ActiveView = (typeof viewIds)[number];

function normalizeView(view?: string | string[]): ActiveView {
  const selectedView = Array.isArray(view) ? view[0] : view;

  return viewIds.includes(selectedView as ActiveView)
    ? (selectedView as ActiveView)
    : "dashboard";
}

function getViewHref(view: ActiveView) {
  return view === "dashboard" ? "/" : `/?view=${view}`;
}

function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

// formatPersonName, formatMoney, fieldClass, getTodayBRT — imported from @/lib/utils

function getDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

const billAlertWindowInDays = 5;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function getDaysUntil(date: Date, todayInputValue: string) {
  const today = new Date(`${todayInputValue}T00:00:00.000Z`);
  const target = new Date(`${getDateInputValue(date)}T00:00:00.000Z`);

  return Math.ceil((target.getTime() - today.getTime()) / millisecondsPerDay);
}

function getDueStatus(daysUntil: number) {
  if (daysUntil < 0) {
    return `atrasada há ${Math.abs(daysUntil)} dia${
      Math.abs(daysUntil) === 1 ? "" : "s"
    }`;
  }

  if (daysUntil === 0) {
    return "vence hoje";
  }

  if (daysUntil === 1) {
    return "vence amanhã";
  }

  return `vence em ${daysUntil} dias`;
}

// TODO: Implementar cache e paginação para melhorar performance
/**
 * Busca todos os dados do dashboard a partir da API do backend.
 * Transforma valores decimais (strings JSON) em objetos compatíveis com
 * a interface Prisma Decimal ({ toNumber }) para manter compatibilidade
 * com o restante do código que foi originalmente Prisma-based.
 */
async function getDashboardData(): Promise<DashboardData> {
  const response = await fetch(`${BACKEND_URL}/api/dashboard`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Erro ao buscar dados: ${response.statusText}`);
  }
  const data = await response.json();
  
  // Transform date strings back to Date objects where needed by the frontend logic
  for (const group of data.groups) {
    for (const log of group.activityLogs) {
      log.createdAt = new Date(log.createdAt);
    }
    for (const exp of group.expenses) {
      exp.expenseDate = new Date(exp.expenseDate);
      const val = exp.amount;
      exp.amount = { toNumber: () => parseFloat(val as any) };
      for (const split of exp.splits) {
        const valOwed = split.amountOwed;
        split.amountOwed = { toNumber: () => parseFloat(valOwed as any) };
      }
    }
    for (const bill of group.fixedBills) {
      bill.dueDate = new Date(bill.dueDate);
    }
    for (const st of group.settlements) {
      st.settledAt = new Date(st.settledAt);
      const valSt = st.amount;
      st.amount = { toNumber: () => parseFloat(valSt as any) };
    }
    for (const pi of group.pantryPurchases) {
      pi.purchasedAt = new Date(pi.purchasedAt);
      if (pi.expense) {
        const val = pi.expense.amount;
        pi.expense.amount = { toNumber: () => parseFloat(val as any) };
      }
    }
    for (const mb of group.members) {
      mb.joinedAt = new Date(mb.joinedAt);
    }
  }

  return {
    users: data.users,
    categories: data.categories,
    groups: data.groups,
  };
}

type DashboardGroup = Awaited<ReturnType<typeof getDashboardData>>["groups"][number];

type BalanceOverviewItem = {
  key: string;
  name: string;
  amount: number;
  currency: string;
};

type SettlementPayment = {
  amount: number;
  currency: string;
  fromId: string;
  key: string;
  groupId: string;
  groupName: string;
  fromName: string;
  toId: string;
  toName: string;
};

type FixedBillAlert = {
  daysUntil: number;
  dueDate: Date;
  groupName: string;
  key: string;
  name: string;
};

type ReverseLeaderboardEntry = {
  amount: number;
  currency: string;
  daysHolding: number;
  key: string;
  name: string;
  title: string;
};

type ReverseLeaderboard = {
  debtors: ReverseLeaderboardEntry[];
  punctual: ReverseLeaderboardEntry[];
};

/**
 * Computa o saldo líquido de cada membro dentro de um grupo.
 * Credita o pagador pelo valor total da despesa e debita cada
 * participante pela sua parcela (amountOwed). Acertos (settlements)
 * também são incorporados ao cálculo.
 * @param group - Grupo do dashboard contendo despesas, splits e settlements
 * @returns Array de { name, balance } ordenado do maior para o menor saldo
 */
function getBalances(group: DashboardGroup) {
  const balances = new Map<
    string,
    {
      name: string;
      balance: number;
    }
  >();

  for (const member of group.members) {
    balances.set(member.userId, {
      name: member.user.name,
      balance: 0,
    });
  }

  for (const expense of group.expenses) {
    const payerBalance = balances.get(expense.payerId);

    if (payerBalance) {
      payerBalance.balance += expense.amount.toNumber();
    }

    for (const split of expense.splits) {
      const debtorBalance = balances.get(split.debtorId);

      if (debtorBalance) {
        debtorBalance.balance -= split.amountOwed.toNumber();
      }
    }
  }

  for (const settlement of group.settlements) {
    const payerBalance = balances.get(settlement.payerId);
    const receiverBalance = balances.get(settlement.receiverId);
    const amount = settlement.amount.toNumber();

    if (payerBalance) {
      payerBalance.balance += amount;
    }

    if (receiverBalance) {
      receiverBalance.balance -= amount;
    }
  }

  return Array.from(balances.values()).sort((a, b) => b.balance - a.balance);
}

function decimalToCents(value: number) {
  return Math.round(value * 100);
}

function centsToAmount(cents: number) {
  return cents / 100;
}

// TODO: Otimizar algoritmo para O(M) com consolidação em grafo
/**
 * Consolida dívidas bilaterais entre todos os membros de todos os grupos.
 * Primeiro calcula o saldo global (overview) por pessoa×moeda, depois
 * para cada grupo calcula pares devedor→credor usando compensação
 * bilateral (netA↔B = max(debtAB − debtBA, 0)).
 * @param groups - Todos os grupos do dashboard
 * @returns { overview: saldos consolidados, settlements: pagamentos sugeridos }
 */
function getSettlementSummary(groups: DashboardGroup[]) {
  const overviewBalances = new Map<
    string,
    {
      userId: string;
      name: string;
      currency: string;
      cents: number;
    }
  >();

  for (const group of groups) {
    for (const member of group.members) {
      const balanceKey = [member.userId, group.defaultCurrency].join(":");

      if (!overviewBalances.has(balanceKey)) {
        overviewBalances.set(balanceKey, {
          userId: member.userId,
          name: member.user.name,
          currency: group.defaultCurrency,
          cents: 0,
        });
      }
    }

    for (const expense of group.expenses) {
      const payerKey = [expense.payerId, expense.currency].join(":");
      const payerBalance =
        overviewBalances.get(payerKey) ??
        {
          userId: expense.payerId,
          name: expense.payer.name,
          currency: expense.currency,
          cents: 0,
        };

      payerBalance.cents += decimalToCents(expense.amount.toNumber());
      overviewBalances.set(payerKey, payerBalance);

      for (const split of expense.splits) {
        const debtorKey = [split.debtorId, expense.currency].join(":");
        const debtorBalance =
          overviewBalances.get(debtorKey) ??
          {
            userId: split.debtorId,
            name: split.debtor.name,
            currency: expense.currency,
            cents: 0,
          };

        debtorBalance.cents -= decimalToCents(split.amountOwed.toNumber());
        overviewBalances.set(debtorKey, debtorBalance);
      }
    }

    for (const settlement of group.settlements) {
      const payerKey = [settlement.payerId, settlement.currency].join(":");
      const receiverKey = [settlement.receiverId, settlement.currency].join(":");
      const payerBalance =
        overviewBalances.get(payerKey) ??
        {
          userId: settlement.payerId,
          name: settlement.payer.name,
          currency: settlement.currency,
          cents: 0,
        };
      const receiverBalance =
        overviewBalances.get(receiverKey) ??
        {
          userId: settlement.receiverId,
          name: settlement.receiver.name,
          currency: settlement.currency,
          cents: 0,
        };
      const cents = decimalToCents(settlement.amount.toNumber());

      payerBalance.cents += cents;
      receiverBalance.cents -= cents;
      overviewBalances.set(payerKey, payerBalance);
      overviewBalances.set(receiverKey, receiverBalance);
    }
  }

  const overview = Array.from(overviewBalances.entries())
    .map(([key, balance]) => ({
      key,
      name: balance.name,
      amount: centsToAmount(balance.cents),
      currency: balance.currency,
    }))
    .sort((a, b) => a.amount - b.amount);

  const settlements: SettlementPayment[] = [];

  for (const group of groups) {
    const groupBalances = new Map<
      string,
      {
        userId: string;
        name: string;
        currency: string;
        cents: number;
      }
    >();

    for (const member of group.members) {
      const key = [member.userId, group.defaultCurrency].join(":");

      groupBalances.set(key, {
        userId: member.userId,
        name: member.user.name,
        currency: group.defaultCurrency,
        cents: 0,
      });
    }

    for (const expense of group.expenses) {
      const payerKey = [expense.payerId, expense.currency].join(":");
      const payerBalance =
        groupBalances.get(payerKey) ??
        {
          userId: expense.payerId,
          name: expense.payer.name,
          currency: expense.currency,
          cents: 0,
        };

      payerBalance.cents += decimalToCents(expense.amount.toNumber());
      groupBalances.set(payerKey, payerBalance);

      for (const split of expense.splits) {
        const debtorKey = [split.debtorId, expense.currency].join(":");
        const debtorBalance =
          groupBalances.get(debtorKey) ??
          {
            userId: split.debtorId,
            name: split.debtor.name,
            currency: expense.currency,
            cents: 0,
          };

        debtorBalance.cents -= decimalToCents(split.amountOwed.toNumber());
        groupBalances.set(debtorKey, debtorBalance);
      }
    }

    for (const settlement of group.settlements) {
      const payerKey = [settlement.payerId, settlement.currency].join(":");
      const receiverKey = [settlement.receiverId, settlement.currency].join(":");
      const payerBalance =
        groupBalances.get(payerKey) ??
        {
          userId: settlement.payerId,
          name: settlement.payer.name,
          currency: settlement.currency,
          cents: 0,
        };
      const receiverBalance =
        groupBalances.get(receiverKey) ??
        {
          userId: settlement.receiverId,
          name: settlement.receiver.name,
          currency: settlement.currency,
          cents: 0,
        };
      const cents = decimalToCents(settlement.amount.toNumber());

      payerBalance.cents += cents;
      receiverBalance.cents -= cents;
      groupBalances.set(payerKey, payerBalance);
      groupBalances.set(receiverKey, receiverBalance);
    }

    // Mapa de userA -> userB -> cents (A deve para B cents)
    const pairwise = new Map<string, Map<string, number>>();

    const getDebt = (from: string, to: string) => {
      return pairwise.get(from)?.get(to) ?? 0;
    };

    const addDebt = (from: string, to: string, cents: number) => {
      if (!pairwise.has(from)) {
        pairwise.set(from, new Map());
      }
      const current = pairwise.get(from)!.get(to) ?? 0;
      pairwise.get(from)!.set(to, current + cents);
    };

    for (const expense of group.expenses) {
      const P = expense.payerId;
      for (const split of expense.splits) {
        const D = split.debtorId;
        if (D !== P) {
          addDebt(D, P, decimalToCents(split.amountOwed.toNumber()));
        }
      }
    }

    for (const settlement of group.settlements) {
      const S = settlement.payerId;
      const R = settlement.receiverId;
      const amountCents = decimalToCents(settlement.amount.toNumber());
      
      const currentDebt = getDebt(S, R);
      if (currentDebt >= amountCents) {
        if (!pairwise.has(S)) {
          pairwise.set(S, new Map());
        }
        pairwise.get(S)!.set(R, currentDebt - amountCents);
      } else {
        if (pairwise.has(S)) {
          pairwise.get(S)!.set(R, 0);
        }
        addDebt(R, S, amountCents - currentDebt);
      }
    }

    const members = group.members.map(m => m.userId);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const uA = members[i];
        const uB = members[j];
        
        const debt_A_to_B = getDebt(uA, uB);
        const debt_B_to_A = getDebt(uB, uA);
        
        const nameA = group.members.find(m => m.userId === uA)?.user.name ?? "";
        const nameB = group.members.find(m => m.userId === uB)?.user.name ?? "";
        
        if (debt_A_to_B > debt_B_to_A) {
          const netCents = debt_A_to_B - debt_B_to_A;
          if (netCents > 0) {
            settlements.push({
              key: [group.id, uA, uB, group.defaultCurrency, netCents].join(":"),
              groupId: group.id,
              groupName: group.name,
              fromId: uA,
              fromName: nameA,
              toId: uB,
              toName: nameB,
              amount: centsToAmount(netCents),
              currency: group.defaultCurrency,
            });
          }
        } else if (debt_B_to_A > debt_A_to_B) {
          const netCents = debt_B_to_A - debt_A_to_B;
          if (netCents > 0) {
            settlements.push({
              key: [group.id, uB, uA, group.defaultCurrency, netCents].join(":"),
              groupId: group.id,
              groupName: group.name,
              fromId: uB,
              fromName: nameB,
              toId: uA,
              toName: nameA,
              amount: centsToAmount(netCents),
              currency: group.defaultCurrency,
            });
          }
        }
      }
    }
  }

  return {
    overview,
    settlements,
  };
}

/**
 * Identifica contas fixas vencidas ou prestes a vencer dentro da janela
 * de alerta (billAlertWindowInDays). Filtra apenas contas não pagas.
 * @param groups - Grupos contendo contas fixas
 * @param todayInputValue - Data de referência no formato YYYY-MM-DD
 * @returns Alertas ordenados por proximidade do vencimento
 */
function getFixedBillAlerts(
  groups: DashboardGroup[],
  todayInputValue: string,
): FixedBillAlert[] {
  return groups
    .flatMap((group) =>
      (group.fixedBills || []).map((bill: any) => ({
        daysUntil: getDaysUntil(bill.dueDate, todayInputValue),
        dueDate: bill.dueDate,
        groupName: group.name,
        key: bill.id,
        name: bill.name,
        isPaid: bill.isPaid,
      })),
    )
    .filter((bill) => !bill.isPaid && bill.daysUntil <= billAlertWindowInDays)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Rankeia moradores por frequência/tempo de inadimplência.
 * Devedores são ordenados por tempo segurando dívida (daysHolding)
 * e valor absoluto. Pontuais são ordenados por saldo positivo.
 * @param groups - Grupos do dashboard
 * @param todayInputValue - Data de referência YYYY-MM-DD
 * @returns { debtors: top 3 inadimplentes, punctual: top 3 pagadores }
 */
function getReverseLeaderboard(
  groups: DashboardGroup[],
  todayInputValue: string,
): ReverseLeaderboard {
  const balances = new Map<
    string,
    {
      cents: number;
      currency: string;
      name: string;
      oldestDebtDate?: Date;
    }
  >();

  for (const group of groups) {
    for (const member of group.members) {
      const key = [member.userId, group.defaultCurrency].join(":");

      if (!balances.has(key)) {
        balances.set(key, {
          cents: 0,
          currency: group.defaultCurrency,
          name: member.user.name,
        });
      }
    }

    for (const expense of group.expenses) {
      const payerKey = [expense.payerId, expense.currency].join(":");
      const payerBalance =
        balances.get(payerKey) ??
        {
          cents: 0,
          currency: expense.currency,
          name: expense.payer.name,
        };

      payerBalance.cents += decimalToCents(expense.amount.toNumber());
      balances.set(payerKey, payerBalance);

      for (const split of expense.splits) {
        const debtorKey = [split.debtorId, expense.currency].join(":");
        const debtorBalance: any =
          balances.get(debtorKey) ??
          {
            cents: 0,
            currency: expense.currency,
            name: split.debtor.name,
            oldestDebtDate: undefined,
          };

        debtorBalance.cents -= decimalToCents(split.amountOwed.toNumber());

        if (
          !debtorBalance.oldestDebtDate ||
          expense.expenseDate < debtorBalance.oldestDebtDate
        ) {
          debtorBalance.oldestDebtDate = expense.expenseDate;
        }

        balances.set(debtorKey, debtorBalance);
      }
    }

    for (const settlement of group.settlements) {
      const payerKey = [settlement.payerId, settlement.currency].join(":");
      const receiverKey = [settlement.receiverId, settlement.currency].join(":");
      const payerBalance =
        balances.get(payerKey) ??
        {
          cents: 0,
          currency: settlement.currency,
          name: settlement.payer.name,
        };
      const receiverBalance =
        balances.get(receiverKey) ??
        {
          cents: 0,
          currency: settlement.currency,
          name: settlement.receiver.name,
        };
      const cents = decimalToCents(settlement.amount.toNumber());

      payerBalance.cents += cents;
      receiverBalance.cents -= cents;
      balances.set(payerKey, payerBalance);
      balances.set(receiverKey, receiverBalance);
    }
  }

  const debtorTitles = [
    "Patrocinado pelo esquecimento",
    "Segurando o rojão",
    "Modo boleto fantasma",
  ];
  const punctualTitles = [
    "Pix relâmpago",
    "Lenda do comprovante",
    "Fiscal do saldo zerado",
  ];

  const entries = Array.from(balances.entries()).map(([key, balance]) => {
    const daysHolding = balance.oldestDebtDate
      ? Math.max(0, getDaysUntil(balance.oldestDebtDate, todayInputValue) * -1)
      : 0;

    return {
      amount: centsToAmount(balance.cents),
      currency: balance.currency,
      daysHolding,
      key,
      name: balance.name,
      title: "",
    };
  });

  return {
    debtors: entries
      .filter((entry) => entry.amount < 0)
      .sort(
        (a, b) =>
          b.daysHolding - a.daysHolding ||
          Math.abs(b.amount) - Math.abs(a.amount),
      )
      .slice(0, 3)
      .map((entry, index) => ({
        ...entry,
        title: debtorTitles[index] ?? "Devedor raiz",
      })),
    punctual: entries
      .filter((entry) => entry.amount >= 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3)
      .map((entry, index) => ({
        ...entry,
        title: punctualTitles[index] ?? "Pagador consciente",
      })),
  };
}

// TODO: Adicionar menu hamburger para responsividade mobile
/**
 * Barra lateral de navegação do Split Lab.
 * Exibe o menu principal, submenu de parâmetros e resumo
 * quantitativo (moradores, grupos, acertos pendentes).
 */
function Sidebar({
  activeView,
  groupCount,
  settlementCount,
  userCount,
}: {
  activeView: ActiveView;
  groupCount: number;
  settlementCount: number;
  userCount: number;
}) {
  const mainItems = [
    { label: "Visão geral", view: "dashboard" },
    { label: "Commits de Gastos", view: "despesas" },
    { label: "Liquidações", view: "liquidacoes" },
    { label: "Despensa", view: "despensa" },
  ] as const;

  const paramItems = [
    { label: "Moradores", view: "usuarios" },
    { label: "Grupos", view: "grupos" },
    { label: "Categorias", view: "categorias" },
  ] as const;

  const isParamActive = paramItems.some((item) => item.view === activeView);

  return (
    <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
      <div className="neon-glow flex h-full flex-col rounded-[2rem] border border-cyan-300/20 bg-slate-950/85 p-5 text-white backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-3xl border border-cyan-300/15 bg-cyan-300/10 p-4">
          <div className="absolute -right-10 -top-10 size-32 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <p className="relative text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200">
            Fenda do Biquíni
          </p>
          <h1 className="relative mt-3 text-2xl font-black tracking-tight">
            Split Lab
          </h1>
          <p className="relative mt-2 text-sm leading-6 text-slate-300">
            Controle de Despesas dos mais gatos do condomínio boreal
          </p>
        </div>

        <nav className="mt-6 flex flex-col gap-2" aria-label="Menu principal">
          {mainItems.map((item) => (
            <Link
              className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                activeView === item.view
                  ? "border-cyan-300/25 bg-cyan-300/15 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
                  : "border-transparent text-slate-300 hover:border-cyan-300/20 hover:bg-cyan-300/10 hover:text-cyan-100"
              }`}
              href={getViewHref(item.view)}
              key={item.view}
            >
              {item.label}
            </Link>
          ))}

          <details className="group/details mt-2" open={isParamActive}>
            <summary className="flex items-center justify-between rounded-2xl border border-transparent px-4 py-3 text-sm font-medium text-slate-300 cursor-pointer transition hover:border-cyan-300/20 hover:bg-cyan-300/10 hover:text-cyan-100 list-none [&::-webkit-details-marker]:hidden">
              <span>Parâmetros</span>
              <svg
                className={`size-4 transition-transform duration-200 ${
                  isParamActive ? "rotate-180" : ""
                } group-open/details:rotate-180`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>

            <div className="mt-2 flex flex-col gap-1.5 border-l border-cyan-300/15 pl-4 ml-4">
              {paramItems.map((item) => (
                <Link
                  className={`rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                    activeView === item.view
                      ? "border-cyan-300/25 bg-cyan-300/15 text-cyan-50"
                      : "border-transparent text-slate-400 hover:border-cyan-300/15 hover:bg-cyan-300/5 hover:text-cyan-200"
                  }`}
                  href={getViewHref(item.view)}
                  key={item.view}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        </nav>

        <div className="mt-auto grid gap-3 rounded-3xl border border-cyan-300/15 bg-slate-900/70 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Moradores</span>
            <strong className="text-cyan-200">{userCount}</strong>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Grupos</span>
            <strong className="text-cyan-200">{groupCount}</strong>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Acertos</span>
            <strong className="text-cyan-200">
              {pluralize(settlementCount, "cobrança", "cobranças")}
            </strong>
          </div>
          <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100">
            Ambiente local conectado ao PostgreSQL
          </div>
        </div>
      </div>
    </aside>
  );
}
function TextInput({
  label,
  name,
  type = "text",
  placeholder,
  required = true,
  defaultValue,
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
  step?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
      {label}
      <input
        className={fieldClass}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        min={min}
        step={step}
      />
    </label>
  );
}

function SelectInput({
  label,
  name,
  children,
  required = true,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
      {label}
      <select
        className={fieldClass}
        name={name}
        required={required}
      >
        {children}
      </select>
    </label>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)]">
      {children}
    </button>
  );
}

/**
 * Painel de visão geral dos acertos financeiros.
 * Exibe saldos consolidados por pessoa e sugere cobranças
 * passo a passo para zerar as pendências.
 */
function SettlementOverview({
  balances,
  settlements,
}: {
  balances: BalanceOverviewItem[];
  settlements: SettlementPayment[];
}) {
  const visibleBalances = balances.filter((balance) => {
    const [userId, currency] = balance.key.split(":");
    const hasActiveSettlements = settlements.some(
      (s) => (s.fromId === userId || s.toId === userId) && s.currency === currency
    );
    return balance.amount !== 0 || hasActiveSettlements;
  });

  return (
    <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <div className={panelClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Saldos Consolidados
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              Resultado líquido por pessoa
            </h2>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {visibleBalances.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-cyan-300/20 bg-slate-900/60 p-5 text-sm text-slate-400">
              Tudo zerado por enquanto.
            </p>
          ) : (
            visibleBalances.map((balance) => {
              const [userId, currency] = balance.key.split(":");
              const toPay = settlements.filter(s => s.fromId === userId && s.currency === currency);
              const toReceive = settlements.filter(s => s.toId === userId && s.currency === currency);
              
              const isCreditor = balance.amount > 0;

              return (
                <div
                  className={`flex flex-col gap-3 rounded-3xl border p-4 ${
                    isCreditor
                      ? "border-emerald-300/15 bg-emerald-400/10"
                      : balance.amount < 0
                      ? "border-orange-300/15 bg-orange-400/10"
                      : "border-cyan-300/15 bg-slate-900/40"
                  }`}
                  key={balance.key}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-100">
                        {formatPersonName(balance.name)}
                      </p>
                      {balance.amount !== 0 && (
                        <span
                          className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            isCreditor
                              ? "bg-emerald-300/15 text-emerald-200"
                              : "bg-orange-300/15 text-orange-200"
                          }`}
                        >
                          {isCreditor ? "Líquido a receber" : "Líquido a pagar"}
                        </span>
                      )}
                      {balance.amount === 0 && (
                        <span className="mt-1 inline-flex rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-300">
                          Saldo zerado
                        </span>
                      )}
                    </div>
                    <strong
                      className={`rounded-full px-3 py-1 text-sm ring-1 ${
                        isCreditor
                          ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/20"
                          : balance.amount < 0
                          ? "bg-orange-400/15 text-orange-200 ring-orange-300/20"
                          : "bg-slate-800/50 text-slate-300 ring-slate-700/20"
                      }`}
                    >
                      {isCreditor ? "+" : ""}
                      {formatMoney(balance.amount, balance.currency)}
                    </strong>
                  </div>

                  {(toPay.length > 0 || toReceive.length > 0) && (
                    <div className="mt-2 border-t border-cyan-300/10 pt-2 text-xs grid gap-1.5 text-slate-300">
                      {toPay.map(p => (
                        <div key={p.key} className="flex justify-between">
                          <span>Deve para <strong className="text-white">{formatPersonName(p.toName)}</strong></span>
                          <span className="font-semibold text-orange-300">-{formatMoney(p.amount, p.currency)}</span>
                        </div>
                      ))}
                      {toReceive.map(r => (
                        <div key={r.key} className="flex justify-between">
                          <span>A receber de <strong className="text-white">{formatPersonName(r.fromName)}</strong></span>
                          <span className="font-semibold text-emerald-300">+{formatMoney(r.amount, r.currency)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="neon-glow rounded-[2rem] border border-cyan-300/15 bg-slate-950/85 p-6 text-white backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Como Liquidar
            </p>
            <h2 className="mt-2 text-2xl font-bold">
              Caminhos passo a passo para zerar
            </h2>
          </div>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {pluralize(settlements.length, "cobrança", "cobranças")}
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {settlements.length === 0 ? (
            <p className="rounded-3xl border border-white/10 bg-white/10 p-5 text-sm text-slate-300">
              Ninguém precisa transferir nada agora.
            </p>
          ) : (
            settlements.map((payment) => (
              <div
                className="rounded-3xl border border-emerald-300/15 bg-emerald-400/10 p-4"
                key={payment.key}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold text-slate-50">
                      {formatPersonName(payment.fromName)}
                      <span className="mx-3 text-emerald-300">→</span>
                      {formatPersonName(payment.toName)}
                    </p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/60">
                      {payment.groupName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="rounded-full bg-emerald-300 px-3 py-1 text-sm text-slate-950">
                      {formatMoney(payment.amount, payment.currency)}
                    </strong>
                    <Link
                      className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-black text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15"
                      href={`/?view=liquidacoes&payerId=${payment.fromId}&receiverId=${payment.toId}&amount=${payment.amount.toFixed(2)}&currency=${payment.currency}&groupId=${payment.groupId}`}
                    >
                      Liquidar
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function FixedBillAlerts({ alerts }: { alerts: FixedBillAlert[] }) {
  if (alerts.length === 0) {
    return null;
  }

  return (
    <section className="rounded-[1.5rem] border border-orange-300/20 bg-orange-400/10 p-5 text-orange-50 shadow-[0_0_28px_rgba(251,146,60,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-200">
            Contas chegando
          </p>
          <h2 className="mt-1 text-xl font-bold text-white">
            Hora de cobrar a galera
          </h2>
        </div>
        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1 text-sm font-semibold text-orange-100">
          {pluralize(alerts.length, "alerta", "alertas")}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {alerts.map((alert) => (
          <div
            className="rounded-3xl border border-orange-300/15 bg-slate-950/50 p-4"
            key={alert.key}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-white">{alert.name}</p>
                <p className="mt-1 text-sm text-orange-100/80">
                  {alert.groupName} · {dateFormatter.format(alert.dueDate)}
                </p>
              </div>
              <span className="rounded-full bg-orange-300 px-3 py-1 text-xs font-black text-slate-950">
                {getDueStatus(alert.daysUntil)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReverseLeaderboardCard({
  leaderboard,
}: {
  leaderboard: ReverseLeaderboard;
}) {
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <div className="neon-glow rounded-[2rem] border border-orange-300/15 bg-slate-950/75 p-6 text-white backdrop-blur-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">
          Inadimplente do Mês
        </p>
        <h2 className="mt-2 text-2xl font-bold">Leaderboard reverso</h2>

        <div className="mt-5 grid gap-3">
          {leaderboard.debtors.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-orange-300/20 bg-orange-400/10 p-5 text-sm text-orange-100">
              Ninguém no vermelho. Milagre contábil da casa.
            </p>
          ) : (
            leaderboard.debtors.map((entry, index) => (
              <div
                className="rounded-3xl border border-orange-300/15 bg-orange-400/10 p-4"
                key={entry.key}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-white">
                      #{index + 1} {formatPersonName(entry.name)}
                    </p>
                    <p className="mt-1 text-sm text-orange-100/80">
                      {entry.title} · {entry.daysHolding} dia
                      {entry.daysHolding === 1 ? "" : "s"} no modo suspense
                    </p>
                  </div>
                  <strong className="rounded-full bg-orange-300 px-3 py-1 text-sm text-slate-950">
                    {formatMoney(entry.amount, entry.currency)}
                  </strong>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="neon-glow rounded-[2rem] border border-emerald-300/15 bg-slate-950/75 p-6 text-white backdrop-blur-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
          Pagou Bonito
        </p>
        <h2 className="mt-2 text-2xl font-bold">Os velocistas do Pix</h2>

        <div className="mt-5 grid gap-3">
          {leaderboard.punctual.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-emerald-300/20 bg-emerald-400/10 p-5 text-sm text-emerald-100">
              Ainda não tem herói financeiro nessa rodada.
            </p>
          ) : (
            leaderboard.punctual.map((entry, index) => (
              <div
                className="rounded-3xl border border-emerald-300/15 bg-emerald-400/10 p-4"
                key={entry.key}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-black text-white">
                      #{index + 1} {formatPersonName(entry.name)}
                    </p>
                    <p className="mt-1 text-sm text-emerald-100/80">
                      {entry.title}
                    </p>
                  </div>
                  <strong className="rounded-full bg-emerald-300 px-3 py-1 text-sm text-slate-950">
                    {formatMoney(entry.amount, entry.currency)}
                  </strong>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function FavorExchange({ groups }: { groups: DashboardGroup[] }) {
  const openCredits = groups.flatMap((group) =>
    (group.favorCredits || [])
      .filter((favor: any) => favor.status === "OPEN")
      .map((favor: any) => ({
        ...favor,
        groupName: group.name,
      })),
  );

  return (
    <section className="grid gap-5 2xl:grid-cols-[0.95fr_1.05fr]">
      <div className={panelClass}>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
          Troca de Favores
        </p>
        <h2 className="mt-2 text-2xl font-bold text-white">
          Créditos simbólicos da casa
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Lavou louça, buscou encomenda, salvou o rolê? Vira crédito.
        </p>

        <div className="mt-5 grid gap-4">
          {groups.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-cyan-300/20 bg-slate-900/60 p-5 text-sm text-slate-400">
              Crie um grupo antes de lançar favores.
            </p>
          ) : (
            groups.map((group) => (
              <form
                action={createFavorCredit}
                className="grid gap-4 rounded-3xl border border-fuchsia-300/10 bg-slate-900/45 p-5"
                key={group.id}
              >
                <input name="groupId" type="hidden" value={group.id} />
                <h3 className="font-semibold text-white">{group.name}</h3>
                <div className="grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
                    Quem ganhou crédito
                    <select className={fieldClass} name="creditorId" required>
                      <option value="">Morador</option>
                      {group.members.map((member) => (
                        <option key={member.id} value={member.userId}>
                          {formatPersonName(member.user.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
                    Quem ficou devendo
                    <select className={fieldClass} name="debtorId" required>
                      <option value="">Morador</option>
                      {group.members.map((member) => (
                        <option key={member.id} value={member.userId}>
                          {formatPersonName(member.user.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_160px]">
                  <TextInput
                    label="Favor"
                    name="description"
                    placeholder="Ex.: lavou a louça"
                  />
                  <TextInput
                    label="Créditos"
                    name="credits"
                    type="number"
                    min="1"
                    defaultValue="1"
                  />
                </div>
                <div className="flex justify-end">
                  <button className="min-h-12 min-w-40 whitespace-nowrap rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)]">
                    Lançar favor
                  </button>
                </div>
              </form>
            ))
          )}
        </div>
      </div>

      <div className="neon-glow rounded-[2rem] border border-fuchsia-300/15 bg-slate-950/75 p-6 text-white backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-fuchsia-300">
              Créditos em aberto
            </p>
            <h2 className="mt-2 text-2xl font-bold">Quem está no lucro moral</h2>
          </div>
          <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-3 py-1 text-xs font-semibold text-fuchsia-100">
            {pluralize(openCredits.length, "favor", "favores")}
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {openCredits.length === 0 ? (
            <p className="rounded-3xl border border-white/10 bg-white/10 p-5 text-sm text-slate-300">
              Nenhum favor pendente. Paz doméstica detectada.
            </p>
          ) : (
            openCredits.map((favor) => (
              <form
                action={settleFavorCredit}
                className="rounded-3xl border border-fuchsia-300/15 bg-fuchsia-300/10 p-4"
                key={favor.id}
              >
                <input name="favorCreditId" type="hidden" value={favor.id} />
                <input name="groupId" type="hidden" value={favor.groupId} />
                <input name="actorId" type="hidden" value={favor.debtorId} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">
                      {formatPersonName(favor.creditor.name)}
                      <span className="mx-2 text-fuchsia-300">→</span>
                      {formatPersonName(favor.debtor.name)}
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      {favor.description} · {favor.groupName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-fuchsia-300 px-3 py-1 text-sm font-black text-slate-950">
                      +{favor.credits} crédito{favor.credits === 1 ? "" : "s"}
                    </span>
                    <button className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15">
                      Bater
                    </button>
                  </div>
                </div>
              </form>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Painel de contas fixas de um grupo.
 * Permite cadastrar novas contas, marcar como pago/a pagar e excluir.
 */
function FixedBillsPanel({
  group,
  today,
}: {
  group: DashboardGroup;
  today: string;
}) {
  return (
    <section className={softPanelClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-300">
            Contas fixas
          </p>
          <h4 className="mt-1 text-xl font-bold text-white">
            Controle simples: a pagar ou pago
          </h4>
        </div>
        <span className="rounded-full border border-orange-300/20 bg-orange-300/10 px-3 py-1 text-sm font-semibold text-orange-100">
          {pluralize(group.fixedBills.length, "conta", "contas")}
        </span>
      </div>

      <form
        action={createFixedBill}
        className="mt-5 grid gap-3 rounded-3xl border border-orange-300/10 bg-slate-950/45 p-4 xl:grid-cols-[1fr_180px_auto]"
      >
        <input name="groupId" type="hidden" value={group.id} />
        <input
          name="actorId"
          type="hidden"
          value={group.members[0]?.userId ?? ""}
        />
        <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
          Conta
          <input
            className={fieldClass}
            list={`fixed-bills-${group.id}`}
            name="name"
            placeholder="Ex.: Aluguel"
            required
          />
          <datalist id={`fixed-bills-${group.id}`}>
            <option value="Aluguel" />
            <option value="Internet" />
            <option value="Condomínio" />
            <option value="Streaming" />
          </datalist>
        </label>
        <TextInput
          label="Vencimento"
          name="dueDate"
          defaultValue={today}
          type="date"
        />
        <div className="self-end">
          <SubmitButton>Cadastrar</SubmitButton>
        </div>
      </form>

      <div className="mt-4 grid gap-3">
        {group.fixedBills.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/45 p-4 text-sm text-slate-400">
            Nenhuma conta fixa cadastrada neste grupo.
          </p>
        ) : (
          group.fixedBills.map((bill) => {
            const daysUntil = getDaysUntil(bill.dueDate, today);

            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/10 bg-slate-950/60 p-4"
                key={bill.id}
              >
                <div>
                  <p className="font-semibold text-white">{bill.name}</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {dateFormatter.format(bill.dueDate)}
                    {!bill.isPaid && ` · ${getDueStatus(daysUntil)}`}
                  </p>
                  <span
                    className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${
                      bill.isPaid
                        ? "bg-emerald-300 text-slate-950"
                        : "bg-orange-300 text-slate-950"
                    }`}
                  >
                    {bill.isPaid ? "Pago" : "A pagar"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <form action={toggleFixedBillPaid}>
                    <input name="fixedBillId" type="hidden" value={bill.id} />
                    <input name="groupId" type="hidden" value={group.id} />
                    <input
                      name="actorId"
                      type="hidden"
                      value={group.members[0]?.userId ?? ""}
                    />
                    <input
                      name="isPaid"
                      type="hidden"
                      value={bill.isPaid ? "false" : "true"}
                    />
                    <button className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-200 transition hover:border-emerald-300/40 hover:bg-emerald-400/15">
                      {bill.isPaid ? "Voltar para a pagar" : "Marcar pago"}
                    </button>
                  </form>
                  <form action={deleteFixedBill}>
                    <input name="fixedBillId" type="hidden" value={bill.id} />
                    <input name="groupId" type="hidden" value={group.id} />
                    <input
                      name="actorId"
                      type="hidden"
                      value={group.members[0]?.userId ?? ""}
                    />
                    <ConfirmSubmitButton
                      className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-2 text-sm font-black text-orange-200 transition hover:border-orange-300/40 hover:bg-orange-400/15"
                      message={`Eliminar a conta fixa "${bill.name}"?`}
                    >
                      Eliminar
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// getReceiptFileName, getReceiptPreviewUrl, getReceiptPreviewKind — imported from @/lib/receipt

/**
 * Visualização completa da despensa.
 * Permite cadastrar compras de mercado por grupo, listar itens
 * atuais e consultar o histórico de compras com comprovantes.
 */
function PantryView({
  groups,
  today,
}: {
  groups: DashboardGroup[];
  today: string;
}) {
  return (
    <section className="grid gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Despensa</h2>
        <p className={`mt-1 text-sm ${mutedTextClass}`}>
          Lista básica, quem comprou o quê e o histórico para encerrar discussões
          alimentares.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-cyan-300/20 bg-slate-950/55 p-8 text-center text-slate-400">
          Crie um grupo antes de controlar a despensa.
        </div>
      ) : (
        groups.map((group) => (
          <article
            className="neon-glow grid gap-6 rounded-[2rem] border border-cyan-300/15 bg-slate-950/70 p-6 backdrop-blur-xl xl:grid-cols-[0.9fr_1.1fr]"
            key={group.id}
          >
            <div className="grid gap-5">
              <form
                action={createPantryPurchase}
                className="grid gap-4 rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5"
                encType="multipart/form-data"
              >
                <input name="groupId" type="hidden" value={group.id} />
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                    Compra de mercado
                  </p>
                  <h3 className="mt-1 text-xl font-bold text-white">
                    {group.name}
                  </h3>
                </div>
                <TextInput
                  label="Item"
                  name="itemName"
                  placeholder="Ex.: Requeijão, papel higiênico..."
                />
                <TextInput
                  label="Quantidade"
                  name="quantity"
                  placeholder="Ex.: 2 unidades"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Valor (R$)"
                    name="amount"
                    placeholder="Ex.: 15,50"
                  />
                  <TextInput
                    label="Data da compra"
                    name="purchasedAt"
                    defaultValue={today}
                    type="date"
                  />
                </div>
                <label className="grid gap-2 text-sm font-medium text-cyan-100/90">
                  Quem comprou
                  <select className={fieldClass} name="purchaserId" required>
                    <option value="">Morador</option>
                    {group.members.map((member) => (
                      <option key={member.id} value={member.userId}>
                        {formatPersonName(member.user.name)}
                      </option>
                    ))}
                  </select>
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
                    PDF, JPEG, PNG, WEBP ou GIF até 8 MB (opcional).
                  </span>
                </label>
                <SubmitButton>Adicionar à despensa</SubmitButton>
              </form>

              <div className={softPanelClass}>
                <h3 className="text-lg font-bold text-white">Itens atuais</h3>
                <div className="mt-4 grid gap-3">
                  {group.pantryItems.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/45 p-4 text-sm text-slate-400">
                      Nada cadastrado ainda.
                    </p>
                  ) : (
                    group.pantryItems.map((item) => (
                      <form
                        action={deletePantryItem}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-300/10 bg-slate-950/60 p-4"
                        key={item.id}
                      >
                        <input name="pantryItemId" type="hidden" value={item.id} />
                        <input name="groupId" type="hidden" value={group.id} />
                        <input
                          name="actorId"
                          type="hidden"
                          value={item.lastPurchasedById ?? ""}
                        />
                        <div>
                          <p className="font-semibold text-white">{item.name}</p>
                          <p className="mt-1 text-sm text-slate-400">
                            {item.quantity} · comprado por{" "}
                            {item.lastPurchasedBy?.name
                              ? formatPersonName(item.lastPurchasedBy.name)
                              : "ninguém ainda"}
                          </p>
                        </div>
                        <ConfirmSubmitButton
                          className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-2 text-sm font-black text-orange-200 transition hover:border-orange-300/40 hover:bg-orange-400/15"
                          message={`Remover "${item.name}" da despensa?`}
                        >
                          Remover
                        </ConfirmSubmitButton>
                      </form>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={softPanelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Histórico
                  </p>
                  <h3 className="mt-1 text-xl font-bold text-white">
                    Quem comprou o quê?
                  </h3>
                </div>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-sm font-semibold text-emerald-100">
                  últimas {group.pantryPurchases.length}
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                {group.pantryPurchases.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-cyan-300/15 bg-slate-950/45 p-4 text-sm text-slate-400">
                    Nenhuma compra registrada.
                  </p>
                ) : (
                  group.pantryPurchases.map((purchase) => {
                    const receiptUrl = purchase.expense?.receiptUrl ? getReceiptPreviewUrl(purchase.expense.receiptUrl) : null;
                    const receiptKind = purchase.expense?.receiptMimeType ? getReceiptPreviewKind(purchase.expense.receiptMimeType) : null;

                    return (
                      <div
                        className="rounded-2xl border border-emerald-300/10 bg-emerald-300/10 p-4 grid gap-3"
                        key={purchase.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-white">{purchase.itemName}</p>
                            <p className="mt-1 text-sm text-slate-300">
                              {purchase.quantity} ·{" "}
                              {formatPersonName(purchase.purchaser.name)}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-1.5">
                            <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-slate-950">
                              {dateFormatter.format(purchase.purchasedAt)}
                            </span>
                            {purchase.expense && (
                              <strong className="text-sm font-bold text-emerald-200">
                                {formatMoney(purchase.expense.amount.toNumber(), purchase.expense.currency)}
                              </strong>
                            )}
                          </div>
                        </div>

                        {receiptUrl && (
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-emerald-300/10">
                            {receiptKind === "image" && (
                              <a
                                href={receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/15"
                              >
                                Ver Comprovante (Imagem)
                              </a>
                            )}
                            {receiptKind === "pdf" && (
                              <a
                                href={receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/15"
                              >
                                Ver Comprovante (PDF)
                              </a>
                            )}
                            {receiptKind === "download" && (
                              <a
                                href={receiptUrl}
                                download={purchase.expense?.receiptName ?? true}
                                className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/15"
                              >
                                Baixar Comprovante
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </article>
        ))
      )}
    </section>
  );
}
/**
 * View completa de liquidações (settlements).
 * Permite registrar novas liquidações com data e comprovante,
 * e exibe o histórico de todas as liquidações passadas.
 */
function LiquidacoesView({
  groups,
  users,
  today,
  prefill,
}: {
  groups: DashboardGroup[];
  users: { id: string; name: string }[];
  today: string;
  prefill?: {
    payerId?: string;
    receiverId?: string;
    amount?: string;
    currency?: string;
    groupId?: string;
  };
}) {
  // Coleta todas as liquidações de todos os grupos e serializa para o Client Component
  const serializedSettlements: SerializedSettlement[] = groups
    .flatMap((g) =>
      g.settlements.map((s) => ({
        id: s.id,
        groupId: s.groupId,
        payerId: s.payerId,
        receiverId: s.receiverId,
        amount: typeof s.amount.toNumber === "function" ? s.amount.toNumber() : Number(s.amount),
        currency: s.currency,
        settledAt: s.settledAt instanceof Date ? s.settledAt.toISOString() : String(s.settledAt),
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        receiptUrl: s.receiptUrl,
        receiptName: s.receiptName,
        receiptMimeType: s.receiptMimeType,
        groupName: g.name,
        payer: { id: s.payer.id, name: s.payer.name },
        receiver: { id: s.receiver.id, name: s.receiver.name },
      })),
    )
    .sort(
      (a, b) =>
        new Date(b.settledAt).getTime() - new Date(a.settledAt).getTime(),
    );

  const prefillPayer = users.find((u) => u.id === prefill?.payerId);
  const prefillReceiver = users.find((u) => u.id === prefill?.receiverId);
  const prefillGroup = groups.find((g) => g.id === prefill?.groupId);
  const hasPrefill = prefillPayer && prefillReceiver && prefill?.amount;

  return (
    <section className="flex flex-col gap-6">
      {/* Formulário de nova liquidação */}
      <form action={createSettlement} className={panelClass}>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Nova Liquidação
        </p>
        <h2 className="mt-1 text-xl font-bold text-white">
          Registrar pagamento entre moradores
        </h2>

        {hasPrefill && (
          <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
            <p className="text-sm text-emerald-100">
              <span className="font-bold text-white">
                {formatPersonName(prefillPayer.name)}
              </span>
              <span className="mx-2 text-emerald-300">→</span>
              <span className="font-bold text-white">
                {formatPersonName(prefillReceiver.name)}
              </span>
              <span className="mx-2 text-slate-400">·</span>
              <strong className="text-emerald-300">
                {formatMoney(
                  parseFloat(prefill.amount || "0"),
                  prefill.currency || "BRL",
                )}
              </strong>
              {prefillGroup && (
                <span className="ml-2 text-xs text-emerald-100/60">
                  ({prefillGroup.name})
                </span>
              )}
            </p>
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Grupo
            </label>
            <select
              name="groupId"
              defaultValue={prefill?.groupId || ""}
              className={`w-full ${fieldClass}`}
              required
            >
              <option value="" disabled>
                Selecione o grupo
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Valor
            </label>
            <input
              name="amount"
              type="text"
              inputMode="decimal"
              defaultValue={prefill?.amount || ""}
              placeholder="Ex.: 150,00"
              className={`w-full ${fieldClass}`}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Pagador (quem pagou)
            </label>
            <select
              name="payerId"
              defaultValue={prefill?.payerId || ""}
              className={`w-full ${fieldClass}`}
              required
            >
              <option value="" disabled>
                Selecione
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Recebedor (quem recebeu)
            </label>
            <select
              name="receiverId"
              defaultValue={prefill?.receiverId || ""}
              className={`w-full ${fieldClass}`}
              required
            >
              <option value="" disabled>
                Selecione
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Data do pagamento
            </label>
            <input
              name="settledAt"
              type="date"
              defaultValue={today}
              className={`w-full ${fieldClass}`}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Moeda
            </label>
            <select
              name="currency"
              defaultValue={prefill?.currency || "BRL"}
              className={`w-full ${fieldClass}`}
            >
              <option value="BRL">BRL</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
            Comprovante (opcional)
          </label>
          <input
            name="receipt"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
            className={`w-full ${fieldClass} file:mr-4 file:rounded-full file:border-0 file:bg-cyan-300/20 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-cyan-200 hover:file:bg-cyan-300/30`}
          />
          <p className="mt-1 text-xs text-slate-500">
            PDF, imagem (até 8 MB)
          </p>
        </div>

        <div className="mt-6">
          <ConfirmSubmitButton
            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-6 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.2)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(16,185,129,0.3)]"
            message="Confirmar esta liquidação?"
          >
            Confirmar Liquidação
          </ConfirmSubmitButton>
        </div>
      </form>

      {/* Histórico de liquidações */}
      <div className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Histórico
            </p>
            <h2 className="mt-1 text-xl font-bold text-white">
              Liquidações registradas
            </h2>
          </div>
          <span className="rounded-full bg-cyan-300/15 px-3 py-1 text-xs font-bold text-cyan-200">
            {serializedSettlements.length}{" "}
            {serializedSettlements.length === 1 ? "liquidação" : "liquidações"}
          </span>
        </div>

        <SettlementList settlements={serializedSettlements} />
      </div>
    </section>
  );
}

// TODO: Implementar Error Boundary para falhas de conexão com o backend
// TODO: Adicionar notificações/toasts de sucesso após operações CRUD
/**
 * Página principal e orquestrador do Split Lab.
 * É um Server Component que busca todos os dados do backend,
 * calcula saldos/acertos/alertas e renderiza a view ativa
 * (dashboard, despesas, despensa, usuários, grupos ou categorias).
 */
export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{
    view?: string | string[];
    payerId?: string;
    receiverId?: string;
    amount?: string;
    currency?: string;
    groupId?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const activeView = normalizeView(params?.view);
  const { users, categories, groups } = await getDashboardData();
  const today = getTodayBRT();
  const { overview, settlements } = getSettlementSummary(groups);
  const fixedBillAlerts = getFixedBillAlerts(groups, today);
  const reverseLeaderboard = getReverseLeaderboard(groups, today);
  const showGroupWorkspace = activeView === "grupos" || activeView === "despesas";

  return (
    <div className="app-shell mx-auto grid min-h-screen w-full max-w-[92rem] gap-6 px-5 py-6 lg:grid-cols-[280px_1fr] lg:px-8">
      <Sidebar
        activeView={activeView}
        groupCount={groups.length}
        settlementCount={settlements.length}
        userCount={users.length}
      />

      <main className="flex min-w-0 flex-col gap-6">
        {activeView === "dashboard" && (
          <>
            <section className="neon-glow relative overflow-hidden rounded-[1.5rem] border border-cyan-300/20 bg-slate-950/80 p-4 text-white backdrop-blur-xl sm:p-5">
              <div className="absolute -left-20 top-0 size-48 rounded-full bg-cyan-400/15 blur-3xl" />
              <div className="absolute -right-16 bottom-0 size-52 rounded-full bg-fuchsia-500/20 blur-3xl" />

              <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 max-w-4xl mx-auto py-2 relative z-10">
                <div className="relative w-full md:w-[260px] shrink-0 rounded-3xl border border-cyan-300/20 bg-slate-900/90 p-4 font-mono text-[11px] text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.12)]">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="size-2 rounded-full bg-fuchsia-400" />
                    <span className="size-2 rounded-full bg-cyan-300" />
                    <span className="size-2 rounded-full bg-teal-300" />
                    <span className="ml-auto text-[9px] text-slate-500">
                      settle-up.trace
                    </span>
                  </div>
                  <pre className="overflow-hidden whitespace-pre-wrap leading-5 text-cyan-100/90 font-mono">
                    <code>{`payer.receive({
  from: debtors,
  split: "equal",
  currency: "BRL",
  status: "open"
})`}</code>
                  </pre>
                </div>

                <div className="flex-1 text-center md:text-left grid gap-2">
                  <div>
                    <span className="inline-flex rounded-full bg-fuchsia-500/10 px-3 py-1 text-[10px] font-bold text-fuchsia-300 border border-fuchsia-300/10 uppercase tracking-widest">
                      Trace ativo
                    </span>
                  </div>
                  <h2 className="text-2xl md:text-3.5xl font-black text-white font-mono leading-tight tracking-tight">
                    Saldos Líquidos <br className="hidden md:inline" /> Atualizados
                  </h2>
                </div>
              </div>
            </section>

            <FixedBillAlerts alerts={fixedBillAlerts} />

            <SettlementOverview balances={overview} settlements={settlements} />

            <ReverseLeaderboardCard leaderboard={reverseLeaderboard} />

            <section className="rounded-[1.5rem] border border-cyan-300/15 bg-slate-950/60 p-4 text-white backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
                    Atalhos rápidos
                  </p>
                  <h2 className="mt-1 text-xl font-bold">
                    O que vamos lançar agora?
                  </h2>
                </div>
                <Link
                  className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-teal-300 px-5 py-3 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_0_34px_rgba(236,72,153,0.35)]"
                  href="/?view=despesas"
                >
                  + Novo commit de gasto
                </Link>
              </div>
            </section>

            <FavorExchange groups={groups} />
          </>
        )}

        {activeView === "usuarios" && (
          <>
            <form action={createUser} className={panelClass}>
              <h2 className="text-xl font-semibold text-white">Novo morador</h2>
              <p className={`mt-1 text-sm ${mutedTextClass}`}>
                Cadastre os moradores que vão participar das divisões.
              </p>
              <div className="mt-5 grid gap-4">
                <TextInput label="Nome" name="name" placeholder="Ex.: João Silva" />
                <TextInput
                  label="E-mail"
                  name="email"
                  type="email"
                  placeholder="joao@email.com"
                />
                <SubmitButton>Cadastrar morador</SubmitButton>
              </div>
            </form>

            <section className={panelClass}>
              <h2 className="text-xl font-semibold text-white">Moradores</h2>
              <div className="mt-5 grid gap-3">
                {users.map((user) => (
                  <div
                    className="rounded-3xl border border-cyan-300/10 bg-slate-900/55 p-4"
                    key={user.id}
                  >
                    <form action={updateUser} className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
                      <input name="userId" type="hidden" value={user.id} />
                      <TextInput
                        label="Nome"
                        name="name"
                        defaultValue={formatPersonName(user.name)}
                      />
                      <TextInput
                        label="E-mail"
                        name="email"
                        type="email"
                        defaultValue={user.email}
                      />
                      <SubmitButton>Editar</SubmitButton>
                      <ConfirmSubmitButton
                        className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-5 py-3 text-sm font-black text-orange-200 transition hover:border-orange-300/40 hover:bg-orange-400/15"
                        formAction={deleteUser}
                        formNoValidate
                        message={`Eliminar o morador "${formatPersonName(user.name)}"?`}
                      >
                        Eliminar
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeView === "categorias" && (
          <section className={panelClass}>
            <h2 className="text-xl font-semibold text-white">
              Categorias padrão
            </h2>
            <p className={`mt-1 text-sm ${mutedTextClass}`}>
              Atalhos para classificar as despesas da casa.
            </p>

            <form
              action={createCategory}
              className="mt-5 grid gap-4 rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5"
            >
              <h3 className="font-semibold text-white">Criar nova categoria</h3>
              <div className="grid gap-4 sm:grid-cols-[120px_1fr_auto]">
                <TextInput
                  label="Ícone"
                  name="icon"
                  placeholder="Ex.: 🧾"
                  required={false}
                />
                <TextInput
                  label="Nome"
                  name="name"
                  placeholder="Ex.: Limpeza"
                />
                <div className="self-end">
                  <SubmitButton>Salvar</SubmitButton>
                </div>
              </div>
            </form>

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {categories.map((category) => (
                <div
                  className="rounded-2xl border border-cyan-300/10 bg-slate-900/65 px-4 py-4 transition hover:border-cyan-300/25 hover:bg-cyan-300/10"
                  key={category.id}
                >
                  <span className="text-2xl">{category.icon ?? "•"}</span>
                  <p className="mt-3 text-sm font-semibold text-slate-100">
                    {category.name}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeView === "grupos" && (
          <form action={createGroup} className={panelClass}>
            <h2 className="text-xl font-semibold text-white">Novo grupo</h2>
            <p className={`mt-1 text-sm ${mutedTextClass}`}>
              Crie um espaço para controlar as despesas compartilhadas.
            </p>
            <div className="mt-5 grid gap-4">
              <TextInput
                label="Nome do grupo"
                name="name"
                placeholder="Ex.: Apartamento"
              />
              <TextInput
                label="Moeda padrão"
                name="defaultCurrency"
                defaultValue="BRL"
              />
              <SelectInput label="Dono do grupo" name="ownerId">
                <option value="">Selecione um morador</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatPersonName(user.name)} ({user.email})
                  </option>
                ))}
              </SelectInput>
              <SubmitButton>Criar grupo</SubmitButton>
            </div>
          </form>
        )}

        {showGroupWorkspace && (
          <section className="grid gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">
                {activeView === "despesas" ? "Commits de Gastos" : "Grupos"}
              </h2>
              <p className={`mt-1 text-sm ${mutedTextClass}`}>
                {activeView === "despesas"
                  ? "Registre novos commits de gastos e confira o histórico."
                  : "Membros, saldos internos e atividades do grupo."}
              </p>
            </div>

            {groups.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-cyan-300/20 bg-slate-950/55 p-8 text-center text-slate-400">
                Nenhum grupo criado ainda.
              </div>
            ) : (
              groups.map((group) => {
                const balances = getBalances(group);

                return (
                  <article
                    className={`neon-glow grid gap-6 rounded-[2rem] border border-cyan-300/15 bg-slate-950/70 p-6 backdrop-blur-xl ${
                      activeView === "grupos" ? "xl:grid-cols-[1fr_0.9fr]" : ""
                    }`}
                    key={group.id}
                  >
                    {activeView === "grupos" && (
                      <div className="grid gap-5">
                        <form
                          action={updateGroup}
                          className="grid gap-3 rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5"
                        >
                          <input name="groupId" type="hidden" value={group.id} />
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-2xl font-bold text-white">
                                {group.name}
                              </h3>
                              <p className="mt-1 text-sm text-slate-400">
                                Criado por {formatPersonName(group.createdBy.name)}
                              </p>
                            </div>
                            <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-sm font-semibold text-cyan-100">
                              {pluralize(group.members.length, "membro", "membros")}
                            </span>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[1fr_130px_auto_auto] md:items-end">
                            <TextInput
                              label="Nome"
                              name="name"
                              defaultValue={group.name}
                            />
                            <TextInput
                              label="Moeda"
                              name="defaultCurrency"
                              defaultValue={group.defaultCurrency}
                            />
                            <SubmitButton>Editar</SubmitButton>
                            <ConfirmSubmitButton
                              className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-5 py-3 text-sm font-black text-orange-200 transition hover:border-orange-300/40 hover:bg-orange-400/15"
                              formAction={deleteGroup}
                              formNoValidate
                              message={`Eliminar o grupo "${group.name}" e seus dados vinculados?`}
                            >
                              Eliminar
                            </ConfirmSubmitButton>
                          </div>
                        </form>

                        <div className={softPanelClass}>
                          <h4 className="font-semibold text-white">Membros</h4>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {group.members.map((member) => (
                              <span
                                className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-sm text-cyan-100"
                                key={member.id}
                              >
                                {formatPersonName(member.user.name)} · {member.role}
                              </span>
                            ))}
                          </div>
                        </div>

                        <form
                          action={addGroupMember}
                          className="grid gap-3 rounded-3xl border border-cyan-300/10 bg-slate-900/45 p-5"
                        >
                          <input name="groupId" type="hidden" value={group.id} />
                          <h4 className="font-semibold text-white">
                            Adicionar membro
                          </h4>
                          <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
                            <select className={fieldClass} name="userId" required>
                              <option value="">Morador</option>
                              {users.map((user) => (
                                <option key={user.id} value={user.id}>
                                  {formatPersonName(user.name)}
                                </option>
                              ))}
                            </select>
                            <select
                              className={fieldClass}
                              name="role"
                              defaultValue="MEMBER"
                            >
                              <option value="MEMBER">MEMBER</option>
                              <option value="ADMIN">ADMIN</option>
                              <option value="OWNER">OWNER</option>
                            </select>
                            <SubmitButton>Adicionar</SubmitButton>
                          </div>
                        </form>

                        <div className="rounded-3xl border border-cyan-300/10 bg-slate-950/80 p-5 text-white">
                          <h4 className="font-semibold">Saldos do grupo</h4>
                          <div className="mt-4 grid gap-2">
                            {balances.map((balance, index) => (
                              <div
                                className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3"
                                key={`${balance.name}-${index}`}
                              >
                                <span>{formatPersonName(balance.name)}</span>
                                <strong
                                  className={
                                    balance.balance >= 0
                                      ? "text-emerald-300"
                                      : "text-orange-300"
                                  }
                                >
                                  {formatMoney(balance.balance, group.defaultCurrency)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-5">
                      {activeView === "despesas" && (
                        <>
                          <ExpenseForm
                            categories={categories.map((category) => ({
                              id: category.id,
                              icon: category.icon,
                              name: category.name,
                            }))}
                            group={{
                              defaultCurrency: group.defaultCurrency,
                              id: group.id,
                              members: group.members.map((member) => ({
                                name: formatPersonName(member.user.name),
                                userId: member.userId,
                              })),
                              name: group.name,
                            }}
                            today={today}
                          />

                          <FixedBillsPanel group={group} today={today} />

                          <ExpenseHistory
                            categories={categories.map((category) => ({
                              id: category.id,
                              icon: category.icon,
                              name: category.name,
                            }))}
                            expenses={group.expenses.map((expense) => ({
                              amount: expense.amount.toNumber(),
                              categoryId: expense.categoryId,
                              categoryIcon: expense.category?.icon ?? null,
                              categoryName: expense.category?.name ?? null,
                              currency: expense.currency,
                              description: expense.description,
                              expenseDate: getDateInputValue(expense.expenseDate),
                              formattedDate: dateFormatter.format(
                                expense.expenseDate,
                              ),
                              groupId: group.id,
                              id: expense.id,
                              payerId: expense.payerId,
                              payerName: formatPersonName(expense.payer.name),
                              receiptMimeType: expense.receiptMimeType,
                              receiptName: expense.receiptName,
                              receiptUrl: expense.receiptUrl,
                              splits: expense.splits.map((split) => ({
                                id: split.id,
                                debtorId: split.debtorId,
                                amountOwed: split.amountOwed.toNumber(),
                              })),
                            }))}
                            members={group.members.map((member) => ({
                              id: member.id,
                              name: formatPersonName(member.user.name),
                              userId: member.userId,
                            }))}
                          />
                        </>
                      )}

                      {activeView === "grupos" && (
                        <div className={softPanelClass}>
                          <h4 className="font-semibold text-white">Atividades</h4>
                          <div className="mt-4 grid gap-3">
                            {group.activityLogs.length === 0 ? (
                              <p className="text-sm text-slate-400">
                                Nenhuma atividade registrada.
                              </p>
                            ) : (
                              group.activityLogs.map((activity) => (
                                <div
                                  className="rounded-2xl border border-cyan-300/10 bg-slate-950/60 p-4"
                                  key={activity.id}
                                >
                                  <p className="text-sm font-semibold text-cyan-100">
                                    {activity.actionType}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-400">
                                    {activity.actionDescription}
                                  </p>
                                  <p className="mt-2 text-xs text-slate-400">
                                    {activity.actor?.name
                                      ? formatPersonName(activity.actor.name)
                                    : "Sistema"} · {timestampFormatter.format(activity.createdAt)}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        )}

        {activeView === "liquidacoes" && (
          <LiquidacoesView
            groups={groups}
            users={users}
            today={today}
            prefill={{
              payerId: params?.payerId,
              receiverId: params?.receiverId,
              amount: params?.amount,
              currency: params?.currency,
              groupId: params?.groupId,
            }}
          />
        )}

        {activeView === "despensa" && (
          <PantryView groups={groups} today={today} />
        )}
      </main>
    </div>
  );
}
