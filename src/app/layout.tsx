import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fenda do Biquíni",
  description: "Controle doméstico de despesas, favores e despensa.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
