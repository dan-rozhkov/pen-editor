// Frontend half of the library-snapshot contract. The backend owns the golden
// fixtures (pen-editor-backend/test/fixtures/ds-diff); a byte-identical copy
// is checked in next to this file so the diff is pinned even where the sibling
// checkout is absent. When the sibling exists the same assertions also run
// against it, and the two directories must match file for file. In the
// cross-repo CI job CONTRACT_REQUIRE_BACKEND=1 makes the sibling mandatory.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkRemovalPolicy,
  composeMigrations,
  deriveMigrations,
  diffSnapshots,
  planRelease,
  validateSnapshot,
  type Migration,
  type Snapshot,
} from "@/lib/designSystem";
import { assertOk } from "@/test/assertions";

interface Expected {
  requiredBump: string;
  violations: Array<{ code: string; entity: string }>;
  migrations: Migration[];
}
interface PairFixture {
  before: Snapshot;
  after: Snapshot;
  expect: Expected & { removed: string[]; addedKeys: string[] };
}
interface ChainFixture {
  chain: Snapshot[];
  expect: { steps: Expected[]; composedMigrations: Migration[] };
}

const LOCAL_DIR = resolve(__dirname, "fixtures");
const BACKEND_DIR = resolve(process.cwd(), "../pen-editor-backend/test/fixtures/ds-diff");
const backendExists = existsSync(BACKEND_DIR);

if (process.env.CONTRACT_REQUIRE_BACKEND && !backendExists) {
  throw new Error(`CONTRACT_REQUIRE_BACKEND is set but ${BACKEND_DIR} does not exist`);
}

const jsonFiles = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const load = <T>(dir: string, file: string): T => JSON.parse(readFileSync(resolve(dir, file), "utf8")) as T;
const slim = (v: Array<{ code: string; entity: string }>) => v.map(({ code, entity }) => ({ code, entity }));

function validated(raw: Snapshot): Snapshot {
  const result = validateSnapshot(raw);
  assertOk(result);
  return result.snapshot;
}

function describeSet(label: string, dir: string): void {
  const files = jsonFiles(dir);
  const pairs = files.filter((f) => !f.startsWith("chain-")).map((f) => [f, load<PairFixture>(dir, f)] as const);
  const chains = files.filter((f) => f.startsWith("chain-")).map((f) => [f, load<ChainFixture>(dir, f)] as const);

  describe(`ds-diff golden fixtures (${label})`, () => {
    it("has pair and chain fixtures", () => {
      expect(pairs.length).toBeGreaterThan(20);
      expect(chains.length).toBeGreaterThanOrEqual(4);
    });

    it.each(pairs)("%s", (_file, fixture) => {
      const before = validated(fixture.before);
      const after = validated(fixture.after);
      const diff = diffSnapshots(before, after);
      const violations = checkRemovalPolicy(before, after);
      expect(diff.requiredBump).toBe(fixture.expect.requiredBump);
      expect(diff.removed).toEqual(fixture.expect.removed);
      expect(diff.added).toEqual(fixture.expect.addedKeys);
      expect(slim(violations)).toEqual(fixture.expect.violations);
      expect(violations.length === 0 ? deriveMigrations(before, after) : []).toEqual(fixture.expect.migrations);

      // The Publish dialog's plan must agree with the pieces it is built from.
      const plan = planRelease(before, after, "1.4.2");
      expect(plan.requiredBump).toBe(fixture.expect.requiredBump);
      expect(plan.migrations).toEqual(fixture.expect.migrations);
      expect(plan.publishable).toBe(fixture.expect.requiredBump !== "none" && fixture.expect.violations.length === 0);
    });

    it.each(chains)("%s", (_file, fixture) => {
      const snapshots = fixture.chain.map(validated);
      const steps = snapshots.slice(1).map((next, i) => ({
        requiredBump: diffSnapshots(snapshots[i], next).requiredBump,
        violations: slim(checkRemovalPolicy(snapshots[i], next)),
        migrations: deriveMigrations(snapshots[i], next),
      }));
      expect(steps).toEqual(fixture.expect.steps);
      expect(composeMigrations(steps.map((s) => s.migrations))).toEqual(fixture.expect.composedMigrations);
    });
  });
}

describeSet("checked-in mirror", LOCAL_DIR);

describe.runIf(backendExists)("ds-diff fixtures against the sibling backend", () => {
  it("the checked-in mirror is byte-identical to the backend copy", () => {
    expect(jsonFiles(LOCAL_DIR)).toEqual(jsonFiles(BACKEND_DIR));
    for (const file of jsonFiles(BACKEND_DIR)) {
      expect(readFileSync(resolve(LOCAL_DIR, file), "utf8"), file).toBe(readFileSync(resolve(BACKEND_DIR, file), "utf8"));
    }
  });
});

describe.runIf(backendExists)("ds-diff golden fixtures (sibling backend)", () => {
  describeSet("sibling backend", BACKEND_DIR);
});
