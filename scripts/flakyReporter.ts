import { writeFileSync } from "node:fs";
import type { Reporter, TestCase } from "vitest/node";

/**
 * Flaky-test visibility: Vitest's built-in `json`/`default` reporters don't
 * surface retries anywhere a script could act on (verified empirically —
 * the `json` reporter's `failureMessages` on a passed test hints at a retry
 * but carries no retry count; there is no top-level "flaky" list). Vitest 4's
 * `TestCase.diagnostic()` does carry it directly (`retryCount`, `flaky`), so
 * this reporter just collects every test whose diagnostic reports `flaky:
 * true` — passed only after at least one retry — and writes them to a JSON
 * file for `scripts/flaky-summary.mjs` to turn into a CI step summary.
 *
 * Wired in via vitest.config.ts's `test.reporters`, alongside (not instead
 * of) the default reporter.
 */
export interface FlakyTestRecord {
  name: string;
  file: string;
  retryCount: number;
}

export default class FlakyReporter implements Reporter {
  private flaky: FlakyTestRecord[] = [];

  onTestCaseResult(testCase: TestCase): void {
    const diagnostic = testCase.diagnostic();
    if (!diagnostic?.flaky) return;
    this.flaky.push({
      name: testCase.fullName,
      file: testCase.module.moduleId,
      retryCount: diagnostic.retryCount,
    });
  }

  onTestRunEnd(): void {
    const outputFile = process.env.VITEST_FLAKY_REPORT_FILE ?? "flaky-tests.json";
    writeFileSync(outputFile, JSON.stringify({ flaky: this.flaky }, null, 2));
  }
}
