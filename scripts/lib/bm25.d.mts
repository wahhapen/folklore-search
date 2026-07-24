export interface SearchRecord {
  id: string;
  documentId: string;
  witnessId?: string;
  title?: string;
  text: string;
  citationLabel?: string;
  [key: string]: unknown;
}

export interface SearchResult extends SearchRecord {
  score: number;
  matchedTerms: number;
}

export interface Bm25Index {
  documents: unknown[];
  documentFrequency: Map<string, number>;
  averageTitleLength: number;
  averageTextLength: number;
}

export function tokenize(value: string): string[];
export function buildBm25Index(records: SearchRecord[]): Bm25Index;
export function searchBm25(
  index: Bm25Index,
  query: string,
  options?: {
    limit?: number;
    titleWeight?: number;
    textWeight?: number;
    k1?: number;
    b?: number;
    minimumMatchedTerms?: number;
    uniqueDocuments?: boolean;
  },
): SearchResult[];
