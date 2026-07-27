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
