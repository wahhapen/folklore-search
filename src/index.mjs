import {
  buildBm25Index,
  searchBm25,
} from "./bm25.mjs";

export const PRODUCTION_RETRIEVAL_OPTIONS = Object.freeze({
  titleWeight: 6,
  textWeight: 1,
  k1: 1.2,
  b: 0.75,
  minimumMatchedTerms: 1,
  uniqueDocuments: true,
});

export function createSearchIndex(records) {
  const index = buildBm25Index(records);
  return Object.freeze({
    search(query, options = {}) {
      return searchBm25(index, query, {
        ...PRODUCTION_RETRIEVAL_OPTIONS,
        ...options,
      });
    },
  });
}

export function createCorpusSearchIndex({ documents, passages }) {
  const documentById = new Map(
    documents.map((document) => [document.id, document]),
  );
  return createSearchIndex(
    passages.map((passage) => {
      const document = documentById.get(passage.documentId);
      return {
        ...passage,
        title: document?.title ?? "",
        metadata: Object.fromEntries(
          Object.entries({
            ...passage.metadata,
            documentId: passage.documentId,
            witnessId: passage.witnessId,
            editionId: document?.editionId,
            language: document?.language,
            recordType: document?.recordType,
            representedTradition: document?.representedTradition,
            representedRegion: document?.representedRegion,
            sourceInstitution: document?.citation?.institution,
            sourceCollection: document?.citation?.collection,
          }).filter(([, value]) => value !== undefined),
        ),
      };
    }),
  );
}
