import { buildBm25Index, searchBm25 } from "./lib/bm25.mjs";
import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "./lib/corpus-release.mjs";
import { PRODUCTION_RETRIEVAL_OPTIONS } from "./lib/search-policy.mjs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npm run search -- "children leave bread crumbs"');
  process.exitCode = 2;
} else {
  const release = await loadVerifiedCorpusRelease();
  const passages = parseJsonLines(release.files.passages);
  const documents = parseJsonLines(release.files.documents);
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
    ...PRODUCTION_RETRIEVAL_OPTIONS,
    limit: 10,
  });
  console.log(
    JSON.stringify(
      {
        query,
        corpus: release.identity,
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
