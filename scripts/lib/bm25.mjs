const stopwords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "to",
  "was",
  "were",
  "with",
]);

function stem(token) {
  if (token.length > 5 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => !stopwords.has(token))
    .map(stem);
}

function frequencies(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export function buildBm25Index(records) {
  const documents = records.map((record) => {
    const titleTokens = tokenize(record.title ?? "");
    const textTokens = tokenize(record.text ?? "");
    return {
      record,
      titleLength: titleTokens.length,
      textLength: textTokens.length,
      titleTerms: frequencies(titleTokens),
      textTerms: frequencies(textTokens),
      terms: new Set([...titleTokens, ...textTokens]),
    };
  });
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const term of document.terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  return {
    documents,
    documentFrequency,
    averageTitleLength:
      documents.reduce((sum, document) => sum + document.titleLength, 0) /
      documents.length,
    averageTextLength:
      documents.reduce((sum, document) => sum + document.textLength, 0) /
      documents.length,
  };
}

function normalizedTf(frequency, length, averageLength, k1, b) {
  if (!frequency) return 0;
  return (
    (frequency * (k1 + 1)) /
    (frequency + k1 * (1 - b + b * (length / Math.max(averageLength, 1))))
  );
}

export function searchBm25(
  index,
  query,
  {
    limit = 10,
    titleWeight = 6,
    textWeight = 1,
    k1 = 1.2,
    b = 0.75,
    minimumMatchedTerms = 1,
    uniqueDocuments = false,
  } = {},
) {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];
  const count = index.documents.length;
  const results = [];

  for (const document of index.documents) {
    let score = 0;
    let matchedTerms = 0;
    for (const term of queryTerms) {
      const titleFrequency = document.titleTerms.get(term) ?? 0;
      const textFrequency = document.textTerms.get(term) ?? 0;
      if (titleFrequency + textFrequency === 0) continue;
      matchedTerms += 1;
      const frequency = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (count - frequency + 0.5) / (frequency + 0.5));
      score +=
        idf *
        (titleWeight *
          normalizedTf(
            titleFrequency,
            document.titleLength,
            index.averageTitleLength,
            k1,
            b,
          ) +
          textWeight *
            normalizedTf(
              textFrequency,
              document.textLength,
              index.averageTextLength,
              k1,
              b,
            ));
    }
    if (matchedTerms >= minimumMatchedTerms) {
      results.push({ ...document.record, score, matchedTerms });
    }
  }

  results.sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
  if (!uniqueDocuments) return results.slice(0, limit);

  const seen = new Set();
  return results
    .filter((result) => {
      if (seen.has(result.documentId)) return false;
      seen.add(result.documentId);
      return true;
    })
    .slice(0, limit);
}
