import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildBm25Index, searchBm25 } from "./lib/bm25.mjs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npm run search -- "children leave bread crumbs"');
  process.exitCode = 2;
} else {
  const releaseRoot = path.resolve("data/derived/releases/corpus-v0.1.0");
  const parse = (contents) =>
    contents
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const [passages, documents] = await Promise.all([
    readFile(path.join(releaseRoot, "passages.jsonl"), "utf8").then(parse),
    readFile(path.join(releaseRoot, "documents.jsonl"), "utf8").then(parse),
  ]);
  const documentById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const index = buildBm25Index(
    passages.map((passage) => ({
      ...passage,
      title: documentById.get(passage.documentId)?.title ?? "",
    })),
  );
  const results = searchBm25(index, query, {
    limit: 10,
    uniqueDocuments: true,
  });
  console.log(
    JSON.stringify(
      {
        query,
        corpusRelease: "fa:release:corpus-v0.1.0",
        results: results.map((result, index) => ({
          rank: index + 1,
          title: documentById.get(result.documentId)?.title,
          documentId: result.documentId,
          passageId: result.id,
          citationLabel: result.citationLabel,
          score: Number(result.score.toFixed(6)),
          excerpt: result.text.replace(/\s+/g, " ").slice(0, 300),
        })),
      },
      null,
      2,
    ),
  );
}
