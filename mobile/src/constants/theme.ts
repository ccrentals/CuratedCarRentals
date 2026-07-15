export const colors = {
  navy: "#0A1323",
  navySoft: "#13233D",
  teal: "#27755F",
  tealDark: "#195448",
  orange: "#EA7242",
  orangeDark: "#CE5830",
  sand: "#F7E0B0",
  cream: "#FFF9EF",
  surface: "#FFFFFF",
  surfaceSoft: "#F4F6F8",
  text: "#142033",
  muted: "#667085",
  border: "#E3E8EF",
  success: "#207A55",
  danger: "#B42318",
  white: "#FFFFFF",
} as const;

export type AppColors = { [Key in keyof typeof colors]: string };

export const darkColors: AppColors = {
  navy: "#07111F",
  navySoft: "#10223A",
  teal: "#4DB897",
  tealDark: "#83D9BE",
  orange: "#F47B4B",
  orangeDark: "#FF9B73",
  sand: "#4A3B24",
  cream: "#1A2433",
  surface: "#121D2C",
  surfaceSoft: "#081321",
  text: "#F4F7FB",
  muted: "#9DAABD",
  border: "#2A394C",
  success: "#63D6A8",
  danger: "#FF8D84",
  white: "#FFFFFF",
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

export const shadow = {
  shadowColor: "#0A1323",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.09,
  shadowRadius: 18,
  elevation: 4,
} as const;
