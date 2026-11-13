import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";

/**
 * Flat ESLint config for the monorepo.
 *
 * Rules stay close to `recommended` so the lint gate catches real problems
 * (unused code, broken Vue templates, accidental globals) without fighting the
 * Prettier formatting that already owns whitespace/layout.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      // App.vue / dialogs use single-word file names by design.
      "vue/multi-word-component-names": "off",
    },
  },
  {
    files: ["apps/web/**/*.{js,ts,vue}", "packages/*/src/**/*.{js,ts,vue}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["apps/api/**/*.{js,mjs,ts}", "scripts/**/*.{js,mjs,ts}", "**/*.config.{js,mjs,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ["**/*.{js,mjs,ts,vue}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
