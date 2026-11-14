import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

// Local rule: ban *new* hardcoded bilingual ternaries. A data-driven
// `vi ? item.name.vi : item.name.en` is allowed; `vi ? "Xin chào" : "Hello"`
// must be a dictionary key rendered through `t()`.
const i18nPlugin = {
  rules: {
    "no-inline-vi-ternary": {
      meta: {
        type: "problem",
        docs: { description: "Require dictionary keys for user-facing strings" },
        schema: [],
        messages: {
          useDict:
            'Use t("namespace.key") from frontend/src/locales/{vi,en}.ts instead of an inline vi/lang ternary.',
        },
      },
      create(context) {
        const isLangVi = (node) => {
          if (!node) return false
          if (node.type === "Identifier" && node.name === "vi") return true
          if (node.type !== "BinaryExpression") return false
          if (node.operator !== "===" && node.operator !== "==") return false
          const { left, right } = node
          return (
            (left.type === "Identifier" && left.name === "lang" && right.type === "Literal" && right.value === "vi") ||
            (right.type === "Identifier" && right.name === "lang" && left.type === "Literal" && left.value === "vi")
          )
        }
        const isStringBranch = (node) =>
          (node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral"
        return {
          ConditionalExpression(node) {
            if (isLangVi(node.test) && isStringBranch(node.consequent) && isStringBranch(node.alternate)) {
              context.report({ node, messageId: "useDict" })
            }
          },
        }
      },
    },
  },
}

// Frozen debt: these files predate the machine-enforced rule. Do not add new
// files here; migrate a file when you touch it for another reason.
const LEGACY_I18N_FILES = [
  "src/components/AoiMap.tsx",
  "src/components/common/DataStatus.tsx",
  "src/components/lab/BlindReplayTab.tsx",
  "src/components/lab/BlindSpotsTab.tsx",
  "src/components/lab/CrossDatasetTab.tsx",
  "src/components/lab/LabSidebar.tsx",
  "src/components/lab/SimulatorTab.tsx",
  "src/components/lab/SpatialCheckTab.tsx",
  "src/components/xray/XrayBacktestLeaderboard.tsx",
  "src/components/xray/XraySidebar.tsx",
  "src/components/xray/XrayTimelineView.tsx",
  "src/components/xray/XrayTransitionIllusionView.tsx",
  "src/pages/evidence.tsx",
  "src/pages/lab.tsx",
  "src/pages/methods.tsx",
]

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
      i18n: i18nPlugin,
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
      "i18n/no-inline-vi-ternary": "error",
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
  {
    files: LEGACY_I18N_FILES,
    rules: { "i18n/no-inline-vi-ternary": "off" },
  },
)
