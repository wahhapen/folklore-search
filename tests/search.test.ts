import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildBm25Index, searchBm25 } from "../scripts/lib/bm25.mjs";

const releaseRoot = "data/derived/releases/corpus-v0.1.0";
const passages = readFileSync(`${releaseRoot}/passages.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const documents = new Map(
  readFileSync(`${releaseRoot}/documents.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .map((document) => [document.id, document]),
);
const index = buildBm25Index(
  passages.map((passage) => ({
    ...passage,
    title: documents.get(passage.documentId)?.title ?? "",
  })),
);

describe("passage BM25 search", () => {
  it("finds a title and returns a citable passage", () => {
    const [result] = searchBm25(index, "Hansel and Gretel", { limit: 5 });
    expect(documents.get(result.documentId)?.title).toBe("Hansel And Gretel");
    expect(result.id).toMatch(/^fa:passage:/);
    expect(result.score).toBeGreaterThan(0);
  });

  it("finds a concrete remembered scene without concept labels", () => {
    const results = searchBm25(index, "children leave bread crumbs birds eat them", {
      limit: 10,
      uniqueDocuments: true,
    });
    expect(
      results.some(
        (result) => documents.get(result.documentId)?.title === "Hansel And Gretel",
      ),
    ).toBe(true);
  });

  it("abstains when no meaningful query terms occur in the corpus", () => {
    expect(
      searchBm25(index, "vampire space station", {
        limit: 10,
        minimumMatchedTerms: 2,
      }),
    ).toEqual([]);
  });
});
