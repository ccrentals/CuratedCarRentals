const DEFAULT_TIMEOUT_MS = 10000;

function resolveSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  if (process.env.URL) return `https://${process.env.URL}`;
  if (process.env.DEPLOY_PRIME_URL) return process.env.DEPLOY_PRIME_URL;
  return null;
}

exports.handler = async () => {
  const siteUrl = resolveSiteUrl();
  const secret = process.env.CRON_SECRET;

  if (!siteUrl) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "SITE_URL not configured" }),
    };
  }

  if (!secret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "CRON_SECRET not configured" }),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${siteUrl}/api/cron/note-emails`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      statusCode: response.status,
      body: text,
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error instanceof Error ? error.message : "Cron failed" }),
    };
  } finally {
    clearTimeout(timeout);
  }
};
