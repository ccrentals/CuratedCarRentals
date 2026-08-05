import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  {
    ignores: [
      ".artifacts/**",
      "playwright-report/**",
      "test-results/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "build/**",
      "next-env.d.ts",
      "audit-artifacts/**",
      ".netlify/**",
      "mobile/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
