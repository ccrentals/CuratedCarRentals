const DEFAULT_TIMEOUT_MS = 10000;

function resolveSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.URL) return `https://${process.env.URL}`;
  if (process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL;
  return null;
}

export default async function handler() {
  const siteUrl = resolveSiteUrl();
  const secret = process.env.CRON_SECRET;

  if (!siteUrl) {
    return Response.json({ error: "SITE_URL not configured" }, { status: 500 });
  }

  if (!secret) {
    return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${siteUrl}/api/cron/archive-cancelled-bookings`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      signal: controller.signal,
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Cron failed" },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
