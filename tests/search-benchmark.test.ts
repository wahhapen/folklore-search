import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runSearchBenchmark } from "../scripts/run-search-benchmark.mjs";

describe("Search Benchmark v0.1", () => {
  it("writes a reproducible run with citations and declared metrics", async () => {
    const result = await runSearchBenchmark({ writeReports: true });
    expect(result.metrics.positiveQueries).toBe(16);
    expect(result.metrics.negativeQueries).toBe(2);
    expect(result.metrics.citationIntegrity).toBe(1);
    expect(result.metrics.ndcgAt10).toBeGreaterThanOrEqual(0.7);
    expect(result.metrics.successAt10).toBeGreaterThanOrEqual(14 / 16);
    expect(result.metrics.negativeAbstention).toBe(1);
    expect(existsSync("reports/search/search-v0.1/metrics.json")).toBe(true);

    const run = readFileSync("reports/search/search-v0.1/run.jsonl", "utf8");
    expect(run).toContain("fa:passage:");
    expect(run).toContain("citationLabel");
  });
});
