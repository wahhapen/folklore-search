import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { runSearchBenchmark } from "../scripts/run-search-benchmark.mjs";
import {
  PRODUCTION_RETRIEVAL_OPTIONS,
} from "../src/index.mjs";

describe("Search Benchmark v0.1", () => {
  it("writes a reproducible run with citations and declared metrics", async () => {
    const result = await runSearchBenchmark({
      writeReports: true,
    });
    expect(result.metrics.positiveQueries).toBe(16);
    expect(result.metrics.corpus).toMatchObject({
      releaseId: "fa:release:corpus-v0.1.0",
      version: "0.1.0",
      manifestSha256:
        "1e614c013f4ec9a21e574a17653c8430eee11ae95ba80cc099a7dc52c7f257ca",
    });
    expect(result.metrics.candidateUniverse).toEqual({
      documents: 170,
      passages: 3291,
    });
    expect(result.metrics.negativeQueries).toBe(2);
    expect(result.metrics.citationIntegrity).toBe(1);
    expect(result.metrics.ndcgAt10).toBeGreaterThanOrEqual(0.7);
    expect(result.metrics.successAt10).toBeGreaterThanOrEqual(14 / 16);
    expect(result.metrics).toMatchObject({
      ndcgAt10: 0.7577007889556064,
      mrr: 0.71875,
      successAt5: 0.875,
      successAt10: 0.875,
      recallAt20: 0.875,
      negativeAbstention: 0,
      citationIntegrity: 1,
    });
    expect(PRODUCTION_RETRIEVAL_OPTIONS.minimumMatchedTerms).toBe(1);
    expect(result.metrics.negativeAbstention).toBe(0);
    expect(
      result.perQuery
        .filter((query) => query.negative)
        .every((query) => query.results.length > 0),
    ).toBe(true);
    expect(result.metrics.retriever).toMatchObject(
      PRODUCTION_RETRIEVAL_OPTIONS,
    );
    expect(existsSync("reports/search/search-v0.1/metrics.json")).toBe(true);

    const run = readFileSync("reports/search/search-v0.1/run.jsonl", "utf8");
    expect(run).toContain("fa:passage:");
    expect(run).toContain("citationLabel");
    expect(
      Object.fromEntries(
        [
          "failures.md",
          "metrics.json",
          "per-query.json",
          "run.jsonl",
        ].map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(`reports/search/search-v0.1/${file}`))
            .digest("hex"),
        ]),
      ),
    ).toEqual({
      "failures.md":
        "cd502fb3682a1623dc4dd06ddc6fc0a39e3f2403a10ed05271e1928a787739b8",
      "metrics.json":
        "67729b6985038225424c75db9a0f807c5b5c43f12e448c74b51a13983b8d5455",
      "per-query.json":
        "4f88ab8f0afb0af3a5d3764289e836bf73ec15a8638c68d6e0dd261e62e2192a",
      "run.jsonl":
        "ed1bfe25908e5be23e5bd0f3ab106d3d4584414e76ddb10c4f19e39c08671666",
    });
  });

  it("refuses a benchmark corpus outside the frozen v0.1 universe", async () => {
    const v02Lock = JSON.parse(
      readFileSync("corpus-release.lock.json", "utf8"),
    );
    await expect(
      runSearchBenchmark({
        writeReports: false,
        releaseRoot: "data/derived/releases/corpus-v0.1.0",
        lock: v02Lock,
      }),
    ).rejects.toThrow();
  });
});
