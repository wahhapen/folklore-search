import { createCorpusSearchIndex } from "../src/index.mjs";
import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "./lib/corpus-release.mjs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npm run search -- "children leave bread crumbs"');
  process.exitCode = 2;
} else {
  const release = await loadVerifiedCorpusRelease();
  const passages = parseJsonLines(release.files.passages);
  const documents = parseJsonLines(release.files.documents);
  const index = createCorpusSearchIndex({ documents, passages });
  const results = index.search(query, { limit: 10 });
  console.log(
    JSON.stringify(
      {
        query,
        corpus: release.identity,
        results: results.map((result, index) => ({
          rank: index + 1,
          title: result.title,
          documentId: result.documentId,
          passageId: result.id,
          citationLabel: result.citationLabel,
          score: Number(result.score.toFixed(6)),
          explanation: result.explanation,
          excerpt: result.text.replace(/\s+/g, " ").slice(0, 300),
        })),
      },
      null,
      2,
    ),
  );
}
