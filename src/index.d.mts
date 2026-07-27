export type MetadataValue = string | number | boolean | null;

export interface SearchRecord {
  id: string;
  documentId?: string;
  title?: string;
  text?: string;
  citationLabel?: string;
  metadata?: Record<string, MetadataValue | undefined>;
  [key: string]: unknown;
}

export interface SearchOptions {
  limit?: number;
  titleWeight?: number;
  textWeight?: number;
  k1?: number;
  b?: number;
  minimumMatchedTerms?: number;
  uniqueDocuments?: boolean;
  filters?: Record<
    string,
    MetadataValue | readonly MetadataValue[]
  >;
}

export interface ScoreTermContribution {
  term: string;
  title: number;
  text: number;
  total: number;
}

export interface SearchExplanation {
  matchedQueryTerms: string[];
  score: {
    total: number;
    fields: {
      title: number;
      text: number;
    };
    terms: ScoreTermContribution[];
  };
}

export type SearchResult<RecordType extends SearchRecord> = RecordType & {
  score: number;
  matchedTerms: number;
  explanation: SearchExplanation;
};

export interface SearchIndex<RecordType extends SearchRecord> {
  search(
    query: string,
    options?: SearchOptions,
  ): Array<SearchResult<RecordType>>;
}

export const PRODUCTION_RETRIEVAL_OPTIONS: Readonly<
  Required<
    Pick<
      SearchOptions,
      | "titleWeight"
      | "textWeight"
      | "k1"
      | "b"
      | "minimumMatchedTerms"
      | "uniqueDocuments"
    >
  >
>;

export function createSearchIndex<RecordType extends SearchRecord>(
  records: readonly RecordType[],
): SearchIndex<RecordType>;

export function createCorpusSearchIndex(options: {
  documents: readonly SearchRecord[];
  passages: readonly SearchRecord[];
}): SearchIndex<SearchRecord>;

export interface CorpusReleaseIdentity {
  readonly releaseId: string;
  readonly version: "0.3.0";
  readonly manifestSchemaVersion: string;
  readonly manifestSha256: string;
  readonly archiveSha256: string;
  readonly sourceRepository: string;
  readonly sourceTag: string;
  readonly sourceAsset: string;
  readonly producerCommit: string;
}

export interface CorpusRecord {
  readonly schemaVersion: string;
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface CorpusDocumentRecord extends SearchRecord {
  readonly schemaVersion: string;
  readonly id: string;
  readonly title?: string;
}

export interface CorpusWitnessRecord extends CorpusRecord {
  readonly documentId: string;
  readonly text?: string;
}

export interface CorpusPassageRecord extends SearchRecord {
  readonly schemaVersion: string;
  readonly id: string;
  readonly documentId: string;
  readonly witnessId: string;
  readonly text: string;
  readonly citationLabel?: string;
}

export interface CorpusRepresentationRecord extends CorpusRecord {
  readonly witnessId: string;
  readonly kind: string;
  readonly language: string;
  readonly artifactId?: string;
}

export interface CorpusDerivationRecord extends CorpusRecord {
  readonly type: string | null;
  readonly inputIds: readonly string[];
  readonly outputIds: readonly string[];
}

export type TranslationProducerClass =
  | "source-published"
  | "expert-produced"
  | "user-produced"
  | "machine-generated";

export type ReviewStatus =
  | "unreviewed"
  | "accepted"
  | "rejected"
  | "superseded";

export interface CorpusTranslationRecord extends CorpusRecord {
  readonly schemaVersion: "folklore-translation-v1";
  readonly translationRepresentationId: string;
  readonly sourceRepresentationId: string;
  readonly producerClass: TranslationProducerClass;
  readonly reviewStatus: ReviewStatus;
  readonly reviewedById: string | null;
  readonly reviewEvidenceArtifactId: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type RightsDecision = boolean | null;

export interface CorpusRightsAssessmentRecord extends CorpusRecord {
  readonly schemaVersion: "folklore-rights-assessment-v2";
  readonly subjectId: string;
  readonly rightsSource: string;
  readonly attributionText: string;
  readonly evidenceUseAllowed: RightsDecision;
  readonly quotationAllowed: RightsDecision;
  readonly redistributionAllowed: RightsDecision;
  readonly accessPrivateUseAllowed: RightsDecision;
  readonly mlEvaluationAllowed: RightsDecision;
  readonly mlTrainingAllowed: RightsDecision;
  readonly derivativesAllowed?: RightsDecision;
  readonly jurisdiction: string;
  readonly reviewedOn: string;
  readonly reviewState: ReviewStatus;
  readonly evidenceArtifactId: string;
}

export interface CorpusGatewayRecords {
  readonly documents: readonly CorpusDocumentRecord[];
  readonly witnesses: readonly CorpusWitnessRecord[];
  readonly passages: readonly CorpusPassageRecord[];
  readonly representations: readonly CorpusRepresentationRecord[];
  readonly derivations: readonly CorpusDerivationRecord[];
  readonly translations: readonly CorpusTranslationRecord[];
  readonly rightsAssessments: readonly CorpusRightsAssessmentRecord[];
}

export interface CorpusSearchGateway {
  readonly release: CorpusReleaseIdentity;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly records: CorpusGatewayRecords;
  readonly index: SearchIndex<CorpusPassageRecord>;
}

export interface CorpusGatewayOptions {
  lockPath?: string;
  cacheRoot?: string;
  offline?: boolean;
  fetchImpl?: typeof fetch;
}

export function loadCorpusSearchGateway(
  options?: CorpusGatewayOptions,
): Promise<CorpusSearchGateway>;
