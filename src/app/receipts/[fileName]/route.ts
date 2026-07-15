import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const receiptDirectory = path.join(
  process.cwd(),
  "public",
  "uploads",
  "receipts",
);

const contentTypeByExtension: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
};

function isValidReceiptFileName(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  return (
    /^[a-zA-Z0-9._-]+$/.test(fileName) &&
    path.basename(fileName) === fileName &&
    extension in contentTypeByExtension
  );
}

function buildReceiptHeaders(fileName: string, fileSize?: number) {
  const extension = path.extname(fileName).toLowerCase();
  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename="${fileName}"`,
    "Content-Type": contentTypeByExtension[extension],
  });

  if (fileSize !== undefined) {
    headers.set("Content-Length", String(fileSize));
  }

  return headers;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;

  if (!isValidReceiptFileName(fileName)) {
    return new Response("Comprovante inválido.", {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  try {
    const filePath = path.join(receiptDirectory, fileName);
    const file = await readFile(filePath);

    return new Response(new Uint8Array(file), {
      headers: buildReceiptHeaders(fileName, file.byteLength),
    });
  } catch {
    return new Response("Comprovante não encontrado.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}

export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;

  if (!isValidReceiptFileName(fileName)) {
    return new Response(null, {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  try {
    const filePath = path.join(receiptDirectory, fileName);
    const fileStats = await stat(filePath);

    return new Response(null, {
      headers: buildReceiptHeaders(fileName, fileStats.size),
    });
  } catch {
    return new Response(null, {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
}
