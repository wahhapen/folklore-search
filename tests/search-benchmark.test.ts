import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runSearchBenchmark } from "../scripts/run-search-benchmark.mjs";
import { searchBm25 } from "../scripts/lib/bm25.mjs";
import { PRODUCTION_RETRIEVAL_OPTIONS } from "../scripts/lib/search-policy.mjs";

describe("Search Benchmark v0.1", () => {
  it("writes a reproducible run with citations and declared metrics", async () => {
    const appliedOptions = [];
    const result = await runSearchBenchmark({
      writeReports: true,
      search(index, query, options) {
        appliedOptions.push(options);
        return searchBm25(index, query, options);
      },
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
    expect(PRODUCTION_RETRIEVAL_OPTIONS.minimumMatchedTerms).toBe(1);
    expect(result.metrics.negativeAbstention).toBe(0);
    expect(
      result.perQuery
        .filter((query) => query.negative)
        .every((query) => query.results.length > 0),
    ).toBe(true);
    expect(appliedOptions).toHaveLength(
      result.metrics.positiveQueries + result.metrics.negativeQueries,
    );
    expect(
      appliedOptions.every(
        (options) =>
          options.minimumMatchedTerms ===
          PRODUCTION_RETRIEVAL_OPTIONS.minimumMatchedTerms,
      ),
    ).toBe(true);
    expect(existsSync("reports/search/search-v0.1/metrics.json")).toBe(true);

    const run = readFileSync("reports/search/search-v0.1/run.jsonl", "utf8");
    expect(run).toContain("fa:passage:");
    expect(run).toContain("citationLabel");
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
