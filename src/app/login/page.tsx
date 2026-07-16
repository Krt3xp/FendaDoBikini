import LoginForm from "./login-form";

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:8000";

export const dynamic = "force-dynamic";

/** Lê a configuração pública de auth para decidir se o primeiro acesso aparece. */
async function getFirstAccessEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/config`, { cache: "no-store" });
    if (!response.ok) {
      return true;
    }
    const config = await response.json();
    return config.firstAccessEnabled !== false;
  } catch {
    return true;
  }
}

export default async function LoginPage() {
  const firstAccessEnabled = await getFirstAccessEnabled();

  return <LoginForm firstAccessEnabled={firstAccessEnabled} />;
}
