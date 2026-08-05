export type AdminAssetSource = { uri: string; headers?: Record<string, string> };

export function buildAdminAssetSource(url: string, accessToken: string | null, apiBaseUrl: string): AdminAssetSource {
  const value = url.trim();
  if (value.startsWith("/") && !value.startsWith("//")) {
    return {
      uri: `${apiBaseUrl.replace(/\/$/, "")}${value}`,
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    };
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return { uri: parsed.toString() };
  } catch {
    // Invalid and non-HTTPS external sources are deliberately blocked.
  }
  return { uri: "" };
}

export default { buildAdminAssetSource };
