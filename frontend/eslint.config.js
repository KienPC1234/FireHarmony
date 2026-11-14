import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", "coverage"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The API client returns a typed body and the code deliberately casts
      // through `unknown` where the wire format is genuinely dynamic.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The end-to-end tests run in Node, not in a browser.
    files: ["e2e/**/*.ts", "playwright.config.ts", "vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The shadcn-style primitives export their variants alongside the
    // component. That is the pattern the whole `ui/` folder follows, and
    // splitting every one of them into two files would not make the code
    // better.
    files: ["src/components/ui/**/*.tsx", "src/components/chart.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
)
