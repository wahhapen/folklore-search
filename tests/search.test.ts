import { beforeAll, describe, expect, it } from "vitest";

import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "../src/corpus-release.mjs";
import { createCorpusSearchIndex } from "../src/index.mjs";

let documents: Map<string, Record<string, unknown>>;
let index: ReturnType<typeof createCorpusSearchIndex>;

describe("passage BM25 search", () => {
  beforeAll(async () => {
    const release = await loadVerifiedCorpusRelease();
    const passages = parseJsonLines(release.files.passages);
    const documentRecords = parseJsonLines(release.files.documents);
    documents = new Map(
      documentRecords.map((document) => [
        document.id,
        document,
      ]),
    );
    index = createCorpusSearchIndex({
      documents: documentRecords,
      passages,
    });
  });

  it("finds a title and returns a citable passage", () => {
    const [result] = index.search("Hansel and Gretel", { limit: 5 });
    expect(documents.get(result.documentId)?.title).toBe("Hansel And Gretel");
    expect(result.id).toMatch(/^fa:passage:/);
    expect(result.score).toBeGreaterThan(0);
  });

  it("finds a concrete remembered scene without concept labels", () => {
    const results = index.search("children leave bread crumbs birds eat them", {
      limit: 10,
      uniqueDocuments: true,
    });
    expect(
      results.some(
        (result) => documents.get(result.documentId)?.title === "Hansel And Gretel",
      ),
    ).toBe(true);
  });

  it("does not claim abstention for a partial lexical match", () => {
    const results = index.search("vampire space station", { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedTerms).toBe(1);
  });
});
