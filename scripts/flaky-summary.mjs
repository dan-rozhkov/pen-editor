#!/usr/bin/env node
// Reads flaky-tests.json (written by scripts/flakyReporter.ts during `vitest
// run`) and appends a markdown table of flaky tests to $GITHUB_STEP_SUMMARY.
// No-ops quietly — never fails the step — when there's nothing to report or
// the file is missing (e.g. a local run with retry disabled never writes a
// non-empty list, and `npm test` outside CI never writes the file's
// directory at all in some setups).
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const REPORT_FILE = process.env.VITEST_FLAKY_REPORT_FILE ?? "flaky-tests.json";
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;

function main() {
  if (!existsSync(REPORT_FILE)) {
    console.log(`[flaky-summary] no ${REPORT_FILE} found — skipping`);
    return;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(REPORT_FILE, "utf8"));
  } catch (error) {
    console.log(`[flaky-summary] could not parse ${REPORT_FILE} — skipping (${error.message})`);
    return;
  }

  const flaky = Array.isArray(report?.flaky) ? report.flaky : [];
  if (flaky.length === 0) {
    console.log("[flaky-summary] no flaky tests this run");
    return;
  }

  const rows = flaky
    .map((t) => `| ${t.name} | ${t.file} | ${t.retryCount} |`)
    .join("\n");
  const table = [
    "## Flaky tests (passed only after a retry)",
    "",
    "| Test | File | Retries |",
    "| --- | --- | --- |",
    rows,
    "",
  ].join("\n");

  if (!SUMMARY_FILE) {
    console.log("[flaky-summary] GITHUB_STEP_SUMMARY not set — printing instead:\n");
    console.log(table);
    return;
  }

  appendFileSync(SUMMARY_FILE, table);
  console.log(`[flaky-summary] appended ${flaky.length} flaky test(s) to the step summary`);
}

main();
