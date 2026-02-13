export const APP_THEMES = ["light", "dark", "ocean", "sand", "forest"] as const;
export const THEME_STORAGE_KEY = "ccr-theme";
export const THEME_COOKIE_NAME = "ccr_theme";

export type AppTheme = (typeof APP_THEMES)[number];

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && APP_THEMES.includes(value as AppTheme);
}
