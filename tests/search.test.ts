import { beforeAll, describe, expect, it } from "vitest";

import { buildBm25Index, searchBm25 } from "../scripts/lib/bm25.mjs";
import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "../scripts/lib/corpus-release.mjs";

let documents: Map<string, Record<string, unknown>>;
let index: ReturnType<typeof buildBm25Index>;

describe("passage BM25 search", () => {
  beforeAll(async () => {
    const release = await loadVerifiedCorpusRelease();
    const passages = parseJsonLines(release.files.passages);
    documents = new Map(
      parseJsonLines(release.files.documents).map((document) => [
        document.id,
        document,
      ]),
    );
    index = buildBm25Index(
      passages.map((passage) => ({
        ...passage,
        title: documents.get(passage.documentId)?.title ?? "",
      })),
    );
  });

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

  it("does not claim abstention for a partial lexical match", () => {
    const results = searchBm25(index, "vampire space station", { limit: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedTerms).toBe(1);
  });
});
