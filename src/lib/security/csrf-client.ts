export function getCsrfTokenFromCookieClient() {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("ccr_csrf="));
  return match ? decodeURIComponent(match.split("=")[1]) : null;
}

export async function ensureCsrfToken() {
  let token = getCsrfTokenFromCookieClient();
  if (token) return token;
  try {
    await fetch("/api/security/csrf", { method: "GET", credentials: "include" });
  } catch {
    return null;
  }
  token = getCsrfTokenFromCookieClient();
  return token;
}
