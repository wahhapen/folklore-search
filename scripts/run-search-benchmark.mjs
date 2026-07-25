import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildBm25Index, searchBm25, tokenize } from "./lib/bm25.mjs";
import {
  loadVerifiedCorpusRelease,
  parseJsonLines,
} from "./lib/corpus-release.mjs";

const root = process.cwd();
const benchmarkPath = path.join(root, "benchmarks/search-v0.1/queries.jsonl");
const reportRoot = path.join(root, "reports/search/search-v0.1");

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function evaluate(query, results) {
  if (query.negative) {
    return {
      reciprocalRank: null,
      ndcgAt10: null,
      successAt5: null,
      successAt10: null,
      recallAt20: null,
      abstained: results.length === 0,
    };
  }

  const grades = new Map(
    query.judgments.map((judgment) => [judgment.documentId, judgment.grade]),
  );
  const firstRelevantIndex = results.findIndex(
    (result) => (grades.get(result.documentId) ?? 0) > 0,
  );
  const dcg = results.slice(0, 10).reduce((total, result, index) => {
    const grade = grades.get(result.documentId) ?? 0;
    return total + (2 ** grade - 1) / Math.log2(index + 2);
  }, 0);
  const idealGrades = [...grades.values()].sort((left, right) => right - left);
  const idealDcg = idealGrades
    .slice(0, 10)
    .reduce(
      (total, grade, index) =>
        total + (2 ** grade - 1) / Math.log2(index + 2),
      0,
    );
  const relevant = new Set(grades.keys());
  const recalled = new Set(
    results
      .slice(0, 20)
      .filter((result) => relevant.has(result.documentId))
      .map((result) => result.documentId),
  );

  return {
    reciprocalRank: firstRelevantIndex < 0 ? 0 : 1 / (firstRelevantIndex + 1),
    ndcgAt10: idealDcg ? dcg / idealDcg : 0,
    successAt5: firstRelevantIndex >= 0 && firstRelevantIndex < 5,
    successAt10: firstRelevantIndex >= 0 && firstRelevantIndex < 10,
    recallAt20: recalled.size / relevant.size,
    abstained: null,
  };
}

export async function runSearchBenchmark({
  writeReports = true,
  releaseRoot,
  lock,
} = {}) {
  const [queryContents, release] = await Promise.all([
    readFile(benchmarkPath, "utf8"),
    loadVerifiedCorpusRelease({ releaseRoot, lock }),
  ]);
  const passageContents = release.files.passages;
  const documentContents = release.files.documents;
  const witnessContents = release.files.witnesses;
  const queries = parseJsonLines(queryContents);
  const passages = parseJsonLines(passageContents);
  const documents = parseJsonLines(documentContents);
  const witnesses = parseJsonLines(witnessContents);
  const documentById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const passageById = new Map(passages.map((passage) => [passage.id, passage]));
  const witnessById = new Map(
    witnesses.map((witness) => [witness.id, witness]),
  );
  const index = buildBm25Index(
    passages.map((passage) => ({
      ...passage,
      title: documentById.get(passage.documentId)?.title ?? "",
    })),
  );

  const runRecords = [];
  const perQuery = queries.map((query) => {
    const allResults = searchBm25(index, query.query, {
      limit: documents.length,
      uniqueDocuments: true,
      minimumMatchedTerms: query.negative ? 2 : 1,
    });
    const results = allResults.slice(0, 20).map((result, index) => ({
      rank: index + 1,
      passageId: result.id,
      documentId: result.documentId,
      title: documentById.get(result.documentId)?.title ?? "",
      score: Number(result.score.toFixed(6)),
      matchedTerms: result.matchedTerms,
      citationLabel: result.citationLabel,
      excerpt: result.text.replace(/\s+/g, " ").slice(0, 240),
    }));
    for (const result of results) {
      runRecords.push({
        queryId: query.id,
        query: query.query,
        category: query.category,
        ...result,
      });
    }
    const expectedIds = new Set(
      query.judgments.map((judgment) => judgment.documentId),
    );
    const targetIndex = allResults.findIndex((result) =>
      expectedIds.has(result.documentId),
    );
    const target = targetIndex >= 0 ? allResults[targetIndex] : null;
    const queryTerms = tokenize(query.query);
    const targetTerms = new Set(
      tokenize(
        `${target ? documentById.get(target.documentId)?.title : ""} ${target?.text ?? ""}`,
      ),
    );
    const matchedQueryTerms = queryTerms.filter((term) => targetTerms.has(term));
    const absentQueryTerms = queryTerms.filter((term) => !targetTerms.has(term));
    return {
      id: query.id,
      category: query.category,
      query: query.query,
      negative: Boolean(query.negative),
      note: query.note,
      judgments: query.judgments,
      metrics: evaluate(query, results),
      results,
      failureAnalysis:
        !query.negative && (targetIndex < 0 || targetIndex >= 10)
          ? {
              targetRank: targetIndex < 0 ? null : targetIndex + 1,
              targetPassageId: target?.id ?? null,
              targetExcerpt:
                target?.text.replace(/\s+/g, " ").slice(0, 300) ?? null,
              matchedQueryTerms,
              absentQueryTerms,
              diagnosis:
                absentQueryTerms.length >= matchedQueryTerms.length
                  ? "The paraphrase shares too little edition vocabulary with the relevant passage for lexical ranking."
                  : "The query terms occur broadly and the relevant passage lacks enough distinctive term weight to outrank distractors.",
              nextExperiment:
                "Expand this failure slice with independently judged paraphrases, then compare a multilingual dense encoder and reciprocal-rank fusion against the frozen BM25F run.",
            }
          : null,
    };
  });

  const positives = perQuery.filter((query) => !query.negative);
  const negatives = perQuery.filter((query) => query.negative);
  const citationIntegrity =
    runRecords.filter((record) => {
      const passage = passageById.get(record.passageId);
      const witness = passage ? witnessById.get(passage.witnessId) : null;
      return (
        passage &&
        witness &&
        Boolean(record.citationLabel) &&
        record.documentId === passage.documentId &&
        witness.text.slice(passage.characterStart, passage.characterEnd) ===
          passage.text
      );
    }).length / Math.max(runRecords.length, 1);
  const metrics = {
    benchmark: "search-v0.1",
    corpus: release.identity,
    retriever: {
      family: "BM25F",
      titleWeight: 6,
      textWeight: 1,
      k1: 1.2,
      b: 0.75,
      unit: "passage",
      rankingView: "best passage per document",
    },
    positiveQueries: positives.length,
    negativeQueries: negatives.length,
    ndcgAt10: mean(positives.map((query) => query.metrics.ndcgAt10)),
    mrr: mean(positives.map((query) => query.metrics.reciprocalRank)),
    successAt5: mean(
      positives.map((query) => Number(query.metrics.successAt5)),
    ),
    successAt10: mean(
      positives.map((query) => Number(query.metrics.successAt10)),
    ),
    recallAt20: mean(positives.map((query) => query.metrics.recallAt20)),
    negativeAbstention: mean(
      negatives.map((query) => Number(query.metrics.abstained)),
    ),
    citationIntegrity,
    categoryMetrics: Object.fromEntries(
      ["title", "entity", "situation", "theme"].map((category) => {
        const subset = positives.filter((query) => query.category === category);
        return [
          category,
          {
            count: subset.length,
            ndcgAt10: mean(subset.map((query) => query.metrics.ndcgAt10)),
            mrr: mean(subset.map((query) => query.metrics.reciprocalRank)),
            successAt5: mean(
              subset.map((query) => Number(query.metrics.successAt5)),
            ),
            successAt10: mean(
              subset.map((query) => Number(query.metrics.successAt10)),
            ),
          },
        ];
      }),
    ),
  };

  if (writeReports) {
    await mkdir(reportRoot, { recursive: true });
    const failures = positives.filter((query) => !query.metrics.successAt10);
    await Promise.all([
      writeFile(
        path.join(reportRoot, "metrics.json"),
        `${JSON.stringify(metrics, null, 2)}\n`,
      ),
      writeFile(
        path.join(reportRoot, "per-query.json"),
        `${JSON.stringify(perQuery, null, 2)}\n`,
      ),
      writeFile(
        path.join(reportRoot, "run.jsonl"),
        `${runRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
      ),
      writeFile(
        path.join(reportRoot, "failures.md"),
        `# Search v0.1 failure analysis\n\n${
          failures.length
            ? failures
                .map(
                  (query) =>
                    `## ${query.id}: ${query.query}\n\n- Expected: ${query.judgments.map((judgment) => `${documentById.get(judgment.documentId)?.title} (${judgment.documentId})`).join(", ")}\n- Relevant rank: ${query.failureAnalysis?.targetRank ?? "not retrieved"}\n- Relevant passage: ${query.failureAnalysis?.targetPassageId ?? "none"}\n- Top result: ${query.results[0]?.title ?? "abstained"} (${query.results[0]?.passageId ?? "none"})\n- Query terms present in relevant passage: ${query.failureAnalysis?.matchedQueryTerms.join(", ") || "none"}\n- Query terms absent from relevant passage: ${query.failureAnalysis?.absentQueryTerms.join(", ") || "none"}\n\n**Diagnosis.** ${query.failureAnalysis?.diagnosis}\n\n**Relevant evidence.** ${query.failureAnalysis?.targetExcerpt ?? "No relevant passage entered the ranked set."}\n\n**Next experiment.** ${query.failureAnalysis?.nextExperiment}`,
                )
                .join("\n\n")
            : "No positive query missed the top ten."
        }\n`,
      ),
    ]);
  }
  return { metrics, perQuery, runRecords };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const { metrics } = await runSearchBenchmark();
  console.log(JSON.stringify(metrics, null, 2));
}
