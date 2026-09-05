import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import playwright from 'eslint-plugin-playwright'
import vitest from '@vitest/eslint-plugin'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    '.tasks',
    'src/vendor/**',
    'playwright-report',
    'playwright-report-pwa',
    'test-results',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // shadcn-style primitives export cva variants alongside components by design
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Playwright e2e specs: ban the main sources of flakiness — waiting on
    // wall-clock time instead of observable state, and focused/skipped tests
    // silently narrowing or dropping coverage in CI.
    files: ['e2e/**/*.spec.ts'],
    extends: [playwright.configs['flat/recommended']],
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-focused-test': 'error',
      // allowConditional: true permits `test.skip(condition, "reason")` —
      // e.g. opting a spec out on a specific browser project with a
      // documented reason — while still banning a bare, permanent
      // `test.skip()`/`.fixme()` left in the suite.
      'playwright/no-skipped-test': ['error', { allowConditional: true }],
    },
  },
  {
    // Unit/integration suites: ban disabled/focused tests reaching CI and
    // tests whose assertions are conditional (a conditional `expect` or a
    // conditionally-skipped test body both hide missing coverage).
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-conditional-tests': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-focused-tests': 'error',
      // Vitest's expect() takes an optional second `message` argument
      // (unlike Jest, which this rule's default maxArgs:1 assumes) — a
      // handful of contract tests use it to name which array element
      // failed. Widen maxArgs instead of disabling the rule.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // Recognize this project's local assert-and-narrow test helpers
      // (src/test/assertions.ts) as real assertions, so a test that only
      // calls one of them isn't flagged as assertion-free.
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: [
            'expect',
            'assertDefined',
            'assertOk',
            'assertErr',
            'assertField',
            'assertWellFormed',
          ],
        },
      ],
    },
  },
  {
    // toolContract.test.ts / pluginAllowlistContract.test.ts /
    // desktopMenuContract.test.ts / webmcp/webmcpContract.test.ts
    // intentionally self-skip (describe.runIf)
    // when a sibling repo isn't checked out locally — that's the documented,
    // deliberate pattern for a contract test that only runs for real in CI's
    // `contract` job (see .github/workflows/ci.yml) or when the sibling repo
    // is present locally. The lone `it.skip(...)` in each file's "(skipped)"
    // branch is a deliberate visible marker (not an abandoned test) that the
    // real contract was skipped for this environment; `.todo()` would
    // misrepresent it as unwritten. Both rules are off only for these
    // files, per the pattern this project's test-quality doc calls out.
    files: [
      'src/lib/__tests__/toolContract.test.ts',
      'src/lib/plugins/__tests__/pluginAllowlistContract.test.ts',
      'src/lib/__tests__/desktopMenuContract.test.ts',
      'src/lib/webmcp/__tests__/webmcpContract.test.ts',
    ],
    rules: {
      'vitest/no-conditional-tests': 'off',
      'vitest/no-disabled-tests': 'off',
    },
  },
])
