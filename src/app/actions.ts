"use server";

import { revalidatePath } from "next/cache";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

// TODO: Adicionar tratamento de erros com mensagens user-friendly
/**
 * Proxy genérico para encaminhar FormData do frontend ao backend FastAPI.
 * Após sucesso, revalida a rota raiz para refletir mudanças imediatamente.
 * @param endpoint - Caminho relativo da API (sem /api/ prefix)
 * @param formData - Dados do formulário a enviar
 * @param method - Método HTTP (padrão: POST)
 * @returns JSON de resposta do backend
 * @throws Error se a resposta não for 2xx
 */
async function proxyToBackend(endpoint: string, formData: FormData, method: string = "POST") {
  const url = `${BACKEND_URL}/api/${endpoint}`;
  
  // Clean up empty fields if necessary, or just send directly
  const response = await fetch(url, {
    method,
    body: formData,
  });
  
  if (!response.ok) {
    const text = await response.text();
    console.error("Erro do backend:", text);
    throw new Error(`Erro na operação: ${response.status} ${response.statusText}`);
  }
  
  revalidatePath("/");
  return await response.json();
}

/** Cria uma nova categoria de despesas. */
export async function createCategory(formData: FormData) {
  return proxyToBackend("categories", formData);
}

/** Cadastra um novo morador no sistema. */
export async function createUser(formData: FormData) {
  return proxyToBackend("users", formData);
}

/** Atualiza nome e/ou e-mail de um morador existente. */
export async function updateUser(formData: FormData) {
  return proxyToBackend("users", formData, "PUT");
}

/** Remove um morador e seus dados associados. */
export async function deleteUser(formData: FormData) {
  return proxyToBackend("users", formData, "DELETE");
}

/** Cria um novo grupo de divisão de despesas. */
export async function createGroup(formData: FormData) {
  return proxyToBackend("groups", formData);
}

/** Atualiza nome e/ou moeda padrão de um grupo. */
export async function updateGroup(formData: FormData) {
  return proxyToBackend("groups", formData, "PUT");
}

/** Remove um grupo e todos os dados vinculados (despesas, splits, etc). */
export async function deleteGroup(formData: FormData) {
  return proxyToBackend("groups", formData, "DELETE");
}

/** Adiciona um morador como membro de um grupo existente. */
export async function addGroupMember(formData: FormData) {
  return proxyToBackend("group-members", formData);
}

/** Cadastra uma nova conta fixa (aluguel, internet, etc). */
export async function createFixedBill(formData: FormData) {
  return proxyToBackend("fixed-bills", formData);
}

/** Alterna o status de pagamento de uma conta fixa (pago ↔ a pagar). */
export async function toggleFixedBillPaid(formData: FormData) {
  return proxyToBackend("fixed-bills/toggle", formData, "PUT");
}

/** Remove uma conta fixa do grupo. */
export async function deleteFixedBill(formData: FormData) {
  return proxyToBackend("fixed-bills", formData, "DELETE");
}

/** Registra um crédito simbólico de favor entre moradores. */
export async function createFavorCredit(formData: FormData) {
  return proxyToBackend("favor-credits", formData);
}

/** Liquida ("bate") um crédito de favor pendente. */
export async function settleFavorCredit(formData: FormData) {
  return proxyToBackend("favor-credits/settle", formData, "PUT");
}

/** Registra uma compra de item de despensa com comprovante opcional. */
export async function createPantryPurchase(formData: FormData) {
  return proxyToBackend("pantry-purchases", formData);
}

/** Remove um item da despensa do grupo. */
export async function deletePantryItem(formData: FormData) {
  return proxyToBackend("pantry-items", formData, "DELETE");
}

/** Registra um acerto financeiro (settlement) entre dois moradores. */
export async function createSettlement(formData: FormData) {
  return proxyToBackend("settlements", formData);
}

/** Cria uma nova despesa ("commit de gasto") com split entre participantes. */
export async function createExpense(formData: FormData) {
  return proxyToBackend("expenses", formData);
}

/** Atualiza uma despesa existente (descrição, valor, splits, comprovante). */
export async function updateExpense(formData: FormData) {
  return proxyToBackend("expenses", formData, "PUT");
}

/** Exclui uma despesa e seus splits associados. */
export async function deleteExpense(formData: FormData) {
  return proxyToBackend("expenses", formData, "DELETE");
}
