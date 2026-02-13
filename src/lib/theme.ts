export const APP_THEMES = ["light", "dark", "midnight", "ocean", "sand", "forest"] as const;
export const THEME_STORAGE_KEY = "ccr-theme";
export const THEME_COOKIE_NAME = "ccr_theme";

export type AppTheme = (typeof APP_THEMES)[number];

export const THEME_LABELS: Record<AppTheme, string> = {
  light: "Light",
  dark: "Dark",
  midnight: "Midnight",
  ocean: "Ocean",
  sand: "Sand",
  forest: "Forest",
};

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && APP_THEMES.includes(value as AppTheme);
}
