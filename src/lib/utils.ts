/**
 * Utilitários compartilhados do Split Lab.
 * Centraliza funções de formatação e constantes reutilizáveis.
 */

/** Classe CSS padrão para campos de formulário */
export const fieldClass =
  "w-full rounded-2xl border border-cyan-300/15 bg-slate-900/60 px-4 py-3 text-sm text-white outline-none ring-cyan-300/25 transition placeholder:text-slate-500 focus:border-cyan-300/30 focus:ring-2";

/**
 * Formata um valor numérico como moeda.
 * @param value - Valor numérico a formatar
 * @param currency - Código da moeda (padrão: "BRL")
 * @returns String formatada (ex: "R$ 150,00")
 */
export function formatMoney(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

/**
 * Formata o nome de uma pessoa para exibição (primeiro + último nome).
 * @param fullName - Nome completo
 * @returns Nome formatado
 */
export function formatPersonName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Calcula percentuais iguais distribuídos entre N participantes.
 * Ajusta o primeiro participante para compensar arredondamento.
 * @param count - Número de participantes
 * @returns Array de percentuais que somam 100
 */
export function getEqualPercentages(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((100 / count) * 100) / 100;
  const result = Array(count).fill(base);
  result[0] = Math.round((100 - base * (count - 1)) * 100) / 100;
  return result;
}

/**
 * Converte uma string de percentual para número.
 * @param value - String com o percentual
 * @returns Valor numérico do percentual
 */
export function parsePercentage(value: string): number {
  const cleaned = value.replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Retorna a data de hoje no formato YYYY-MM-DD ajustada para o fuso BRT (UTC-3).
 * Usa offset fixo pois o servidor roda em UTC no Docker.
 * @returns String no formato "YYYY-MM-DD"
 */
export function getTodayBRT(): string {
  // TODO: Idealmente receber o timezone do cliente via cookie/header
  const now = new Date();
  const brtOffset = -3 * 60; // UTC-3 em minutos
  const brt = new Date(now.getTime() + (brtOffset - now.getTimezoneOffset()) * 60000);
  const y = brt.getFullYear();
  const m = String(brt.getMonth() + 1).padStart(2, "0");
  const d = String(brt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
