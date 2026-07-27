import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { createCorpusSearchIndex } from "../src/index.mjs";
import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "../scripts/lib/corpus-release.mjs";

describe("search CLI", () => {
  it("returns the same ranked passages and scores as the shared module", async () => {
    const query = "children leave bread crumbs birds eat them";
    const release = await loadVerifiedCorpusRelease();
    const passages = parseJsonLines(release.files.passages);
    const documents = parseJsonLines(release.files.documents);
    const expected = createCorpusSearchIndex({ documents, passages }).search(
      query,
      { limit: 10 },
    );

    const output = JSON.parse(
      execFileSync(process.execPath, ["scripts/search-corpus.mjs", query], {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      }),
    );

    expect(output.results.map(({ passageId }) => passageId)).toEqual(
      expected.map(({ id }) => id),
    );
    expect(output.results.map(({ score }) => score)).toEqual(
      expected.map(({ score }) => Number(score.toFixed(6))),
    );
    expect(output.results[0].explanation).toMatchObject({
      matchedQueryTerms: expect.any(Array),
      score: {
        fields: {
          title: expect.any(Number),
          text: expect.any(Number),
        },
        terms: expect.any(Array),
      },
    });
  }, 20_000);
});
