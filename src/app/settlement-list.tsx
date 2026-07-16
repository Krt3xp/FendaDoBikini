"use client";

import { useState } from "react";
import Image from "next/image";
import { formatMoney, formatPersonName } from "@/lib/utils";
import { getReceiptPreviewUrl, getReceiptPreviewKind } from "@/lib/receipt";

export interface SerializedSettlement {
  id: string;
  groupId: string;
  payerId: string;
  receiverId: string;
  amount: number;
  currency: string;
  settledAt: string;
  createdAt: string;
  receiptUrl: string | null;
  receiptName: string | null;
  receiptMimeType: string | null;
  groupName: string;
  payer: { id: string; name: string };
  receiver: { id: string; name: string };
}

function SettlementCard({ st }: { st: SerializedSettlement }) {
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false);
  const [isReceiptChecking, setIsReceiptChecking] = useState(false);
  const [isReceiptMissing, setIsReceiptMissing] = useState(false);

  const previewUrl = getReceiptPreviewUrl(st.receiptUrl);
  const previewKind = getReceiptPreviewKind(st.receiptMimeType);

  async function handleOpenPreview() {
    if (!previewUrl) return;

    if (isReceiptPreviewOpen) {
      setIsReceiptPreviewOpen(false);
      return;
    }

    setIsReceiptChecking(true);
    setIsReceiptMissing(false);

    try {
      const response = await fetch(previewUrl, {
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

  const timestampFormatter = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  });

  return (
    <div className="rounded-3xl border border-cyan-300/10 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-bold text-white">
            {formatPersonName(st.payer.name)}
            <span className="mx-2 text-emerald-300">→</span>
            {formatPersonName(st.receiver.name)}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
            {st.groupName} · {timestampFormatter.format(new Date(st.settledAt))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <strong className="rounded-full bg-emerald-300 px-3 py-1 text-sm text-slate-950">
            {formatMoney(st.amount, st.currency)}
          </strong>
        </div>
      </div>

      {previewUrl && (
        <div className="mt-3 grid gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenPreview}
              disabled={isReceiptChecking}
              className="w-fit rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-300/15 disabled:cursor-wait disabled:opacity-60"
            >
              {isReceiptChecking ? "Carregando..." : isReceiptPreviewOpen ? "Fechar comprovante" : "Ver comprovante"}
            </button>
            {previewKind === "image" && (
              <span className="rounded bg-cyan-300/10 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                Imagem
              </span>
            )}
            {previewKind === "pdf" && (
              <span className="rounded bg-fuchsia-300/10 px-2 py-0.5 text-[10px] font-bold uppercase text-fuchsia-300">
                PDF
              </span>
            )}
          </div>

          {isReceiptMissing && (
            <p className="rounded-2xl border border-orange-300/20 bg-orange-400/10 px-4 py-3 text-sm font-semibold text-orange-200">
              Comprovante não encontrado no servidor.
            </p>
          )}

          {isReceiptPreviewOpen && (
            <div className="grid gap-3 rounded-3xl border border-emerald-300/15 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-emerald-100">
                    {st.receiptName || "Comprovante"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {st.receiptMimeType || "Tipo não informado"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/40 hover:bg-cyan-300/15"
                    href={previewUrl}
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

              {previewKind === "image" && (
                <div className="relative h-[34rem] w-full overflow-hidden rounded-2xl border border-emerald-300/10 bg-slate-950">
                  <Image
                    alt={`Comprovante de pagamento`}
                    className="object-contain"
                    fill
                    sizes="100vw"
                    src={previewUrl}
                    unoptimized
                  />
                </div>
              )}

              {previewKind === "pdf" && (
                <iframe
                  className="h-[34rem] w-full rounded-2xl border border-emerald-300/10 bg-slate-950"
                  src={previewUrl}
                  title={`Comprovante de pagamento`}
                />
              )}

              {previewKind === "download" && (
                <div className="rounded-2xl border border-dashed border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100">
                  Preview indisponível para este tipo de arquivo.
                  <a
                    className="ml-2 font-black underline decoration-emerald-300/60 underline-offset-4"
                    download={st.receiptName ?? true}
                    href={previewUrl}
                  >
                    Baixar comprovante
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SettlementList({ settlements }: { settlements: SerializedSettlement[] }) {
  if (settlements.length === 0) {
    return (
      <p className="rounded-3xl border border-white/10 bg-white/10 p-5 text-sm text-slate-300">
        Nenhuma liquidação registrada ainda.
      </p>
    );
  }

  return (
    <div className="mt-5 grid gap-3">
      {settlements.map((st) => (
        <SettlementCard key={st.id} st={st} />
      ))}
    </div>
  );
}
