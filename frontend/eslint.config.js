import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// The build doesn't check names, so an undefined variable only shows up when the
// page renders (that is how a dashboard crash once reached develop). Lint runs in CI.
export default [
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      // __CASHMONEY_APP_VERSION__ is replaced at build time (define in vite.config.js).
      globals: { ...globals.browser, __CASHMONEY_APP_VERSION__: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/**/*.test.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
