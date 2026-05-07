import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import mochaPlugin from "eslint-plugin-mocha";
import globals from "globals";

export default defineConfig([
  mochaPlugin.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser }
  },
]);
