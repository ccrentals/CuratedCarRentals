import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  {
    ignores: ["android/**", "ios/**", "dist-web/**", ".expo/**"],
  },
  ...expoConfig,
]);
