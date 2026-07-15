/**
 * Utilitários para visualização e download de comprovantes (receipts).
 * Usado tanto no histórico de despesas quanto no histórico de compras da despensa.
 */

/**
 * Extrai o nome do arquivo de uma URL de comprovante.
 * @param receiptUrl - URL do comprovante armazenado
 * @returns Nome do arquivo ou null se inválido
 */
export function getReceiptFileName(receiptUrl: string | null): string | null {
  if (!receiptUrl) return null;
  const pathname = receiptUrl.split("?")[0];
  const fileName = pathname.split("/").filter(Boolean).at(-1);
  if (!fileName || !/^[a-zA-Z0-9._-]+$/.test(fileName)) return null;
  return fileName;
}

/**
 * Constrói a URL de preview do comprovante para o frontend.
 * @param receiptUrl - URL original do comprovante
 * @returns URL formatada para acesso via rota /receipts/
 */
export function getReceiptPreviewUrl(receiptUrl: string | null): string | null {
  const fileName = getReceiptFileName(receiptUrl);
  return fileName ? `/receipts/${encodeURIComponent(fileName)}` : null;
}

/**
 * Determina o tipo de preview do comprovante baseado no MIME type.
 * @param mimeType - MIME type do arquivo
 * @returns "image" | "pdf" | "download"
 */
export function getReceiptPreviewKind(
  mimeType: string | null
): "image" | "pdf" | "download" {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return "download";
}
