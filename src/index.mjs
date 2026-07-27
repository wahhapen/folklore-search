import {
  buildBm25Index,
  searchBm25,
} from "./bm25.mjs";
import {
  CORPUS_GATEWAY_RECORD_FILE_PATHS,
  installCorpusRelease,
  parseJsonLines,
} from "./corpus-release.mjs";

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

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function manifestArtifactIds(manifest) {
  return new Set(
    manifest.artifacts.flatMap(({ path }) => {
      const match = /^artifacts\/sha256\/[a-f0-9]{2}\/([a-f0-9]{64})$/.exec(
        path,
      );
      return match ? [`fa:artifact:sha256-${match[1]}`] : [];
    }),
  );
}

function validateGatewayProvenance(records, manifest) {
  const representationIds = new Set(
    records.representations.map(({ id }) => id),
  );
  const translationPairs = new Set(
    records.derivations
      .filter(({ type }) => type === "translation")
      .flatMap(({ inputIds, outputIds }) =>
        inputIds.flatMap((inputId) =>
          outputIds.map((outputId) => `${inputId}\0${outputId}`),
        ),
      ),
  );
  const translationOutputCounts = new Map();
  for (const { translationRepresentationId } of records.translations) {
    translationOutputCounts.set(
      translationRepresentationId,
      (translationOutputCounts.get(translationRepresentationId) ?? 0) + 1,
    );
  }
  const artifactIds = manifestArtifactIds(manifest);

  for (const translation of records.translations) {
    const reasons = [];
    const {
      sourceRepresentationId,
      translationRepresentationId,
      reviewEvidenceArtifactId,
    } = translation;
    if (sourceRepresentationId === translationRepresentationId) {
      reasons.push("source-equals-translation");
    }
    if (!representationIds.has(sourceRepresentationId)) {
      reasons.push("missing-source-representation");
    }
    if (!representationIds.has(translationRepresentationId)) {
      reasons.push("missing-translation-representation");
    }
    if (
      !translationPairs.has(
        `${sourceRepresentationId}\0${translationRepresentationId}`,
      )
    ) {
      reasons.push("missing-translation-derivation");
    }
    if (
      translationOutputCounts.get(translationRepresentationId) > 1
    ) {
      reasons.push("duplicate-translation-representation");
    }
    if (
      reviewEvidenceArtifactId
      && !artifactIds.has(reviewEvidenceArtifactId)
    ) {
      reasons.push("missing-review-evidence");
    }
    if (reasons.length) {
      throw new Error(
        `Corpus translation provenance mismatch: ${translation.id} (${reasons.join(", ")})`,
      );
    }
  }

  for (const rights of records.rightsAssessments) {
    if (
      rights.evidenceArtifactId
      && !artifactIds.has(rights.evidenceArtifactId)
    ) {
      throw new Error(
        `Corpus rights provenance mismatch: ${rights.id} (missing-rights-evidence)`,
      );
    }
  }
}

export async function loadCorpusSearchGateway(options = {}) {
  const release = await installCorpusRelease(options);
  if (release.identity.version !== "0.3.0") {
    throw new Error(
      `Corpus search gateway requires v0.3.0; received ${release.identity.version}`,
    );
  }
  if (!release.identity.producerCommit) {
    throw new Error("Corpus v0.3.0 gateway requires a locked producer commit");
  }
  for (const name of Object.keys(CORPUS_GATEWAY_RECORD_FILE_PATHS)) {
    if (release.files[name] === undefined) {
      throw new Error(`Corpus v0.3.0 is missing gateway records: ${name}`);
    }
  }
  const records = Object.fromEntries(
    Object.entries(release.files)
      .filter(([name]) => name !== "schema")
      .map(([name, contents]) => [name, parseJsonLines(contents)]),
  );
  validateGatewayProvenance(records, release.manifest);
  const verifiedRecords = deepFreeze(records);
  return Object.freeze({
    release: Object.freeze({ ...release.identity }),
    manifest: deepFreeze(release.manifest),
    records: verifiedRecords,
    index: createCorpusSearchIndex({
      documents: verifiedRecords.documents,
      passages: verifiedRecords.passages,
    }),
  });
}
