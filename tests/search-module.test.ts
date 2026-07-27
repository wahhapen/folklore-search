import { describe, expect, it } from "vitest";

import {
  createCorpusSearchIndex,
  createSearchIndex,
} from "folklore-search";

const records = [
  {
    id: "passage-2",
    documentId: "document-2",
    title: "Bread Bread Bread for the Road",
    text: "The traveler packed bread and more bread.",
    citationLabel: "Bread for the Road, passage 1",
    metadata: { language: "fi", tradition: "Other tradition" },
  },
  {
    id: "passage-1",
    documentId: "document-1",
    title: "The Bread Child",
    text: "A child left crumbs in the forest.",
    citationLabel: "The Bread Child, passage 1",
    metadata: { language: "en", tradition: "Test tradition" },
  },
];

describe("shared search module", () => {
  it("is importable and returns citable results with score explanations", () => {
    const index = createSearchIndex(records);

    const [result] = index.search("bread child");

    expect(result).toMatchObject({
      id: "passage-1",
      documentId: "document-1",
      citationLabel: "The Bread Child, passage 1",
      explanation: {
        matchedQueryTerms: ["bread", "child"],
      },
    });
    expect(result.explanation.score.total).toBe(result.score);
    expect(result.explanation.score.fields.title).toBeGreaterThan(0);
    expect(result.explanation.score.fields.text).toBeGreaterThanOrEqual(0);
    expect(result.explanation.score.terms).toEqual([
      expect.objectContaining({
        term: "bread",
        title: expect.any(Number),
        text: expect.any(Number),
        total: expect.any(Number),
      }),
      expect.objectContaining({
        term: "child",
        title: expect.any(Number),
        text: expect.any(Number),
        total: expect.any(Number),
      }),
    ]);
  });

  it("combines exact metadata filters before limiting results", () => {
    const index = createSearchIndex(records);

    expect(index.search("bread", { limit: 1 })[0].id).toBe("passage-2");
    expect(
      index.search("bread", {
        limit: 1,
        filters: {
          language: ["en", "sv"],
          tradition: "Test tradition",
        },
      }).map(({ id }) => id),
    ).toEqual(["passage-1"]);
    expect(
      index.search("bread", { filters: { language: "EN" } }),
    ).toEqual([]);
    expect(
      index.search("bread", { filters: { missing: undefined } }),
    ).toEqual([]);
  });

  it("constructs the shared index directly from Corpus records", () => {
    const index = createCorpusSearchIndex({
      documents: [
        {
          id: "document-1",
          title: "Forest Child",
          language: "en",
          representedTradition: "Test tradition",
          representedRegion: "Test region",
          recordType: "test-record",
          editionId: "edition-1",
          citation: {
            institution: "Test Archive",
            collection: "Test Collection",
          },
        },
      ],
      passages: [
        {
          id: "passage-1",
          documentId: "document-1",
          witnessId: "witness-1",
          text: "A child crossed the forest.",
          citationLabel: "Forest Child, passage 1",
          metadata: { reviewStatus: "accepted" },
        },
      ],
    });

    expect(
      index.search("forest", {
        filters: {
          language: "en",
          representedTradition: "Test tradition",
          sourceInstitution: "Test Archive",
        },
      })[0],
    ).toMatchObject({
      id: "passage-1",
      title: "Forest Child",
      metadata: {
        language: "en",
        representedTradition: "Test tradition",
        representedRegion: "Test region",
        recordType: "test-record",
        editionId: "edition-1",
        sourceInstitution: "Test Archive",
        sourceCollection: "Test Collection",
        reviewStatus: "accepted",
      },
    });
  });

  it("uses the production document-level ranking policy by default", () => {
    const index = createSearchIndex([
      {
        id: "passage-1",
        documentId: "document-1",
        title: "One",
        text: "match",
      },
      {
        id: "passage-2",
        documentId: "document-1",
        title: "Two",
        text: "match match",
      },
    ]);

    expect(index.search("match")).toHaveLength(1);
    expect(index.search("match", { uniqueDocuments: false })).toHaveLength(2);

    const recordsWithoutDocumentIds = createSearchIndex([
      { id: "standalone-1", title: "One", text: "match" },
      { id: "standalone-2", title: "Two", text: "match" },
    ]);
    expect(
      recordsWithoutDocumentIds.search("match").map(({ id }) => id),
    ).toEqual(["standalone-1", "standalone-2"]);
  });

  it("breaks equal-score ties by locale-independent stable record ID", () => {
    const index = createSearchIndex([
      {
        id: "passage-ä",
        documentId: "document-ä",
        title: "Equal",
        text: "match",
        citationLabel: "Umlaut",
      },
      {
        id: "passage-z",
        documentId: "document-z",
        title: "Equal",
        text: "match",
        citationLabel: "Z",
      },
    ]);

    expect(index.search("match").map(({ id }) => id)).toEqual([
      "passage-z",
      "passage-ä",
    ]);
  });
});
