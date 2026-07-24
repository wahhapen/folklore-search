export interface SearchBenchmarkMetrics {
  positiveQueries: number;
  negativeQueries: number;
  ndcgAt10: number;
  successAt10: number;
  negativeAbstention: number;
  citationIntegrity: number;
  [key: string]: unknown;
}

export interface SearchBenchmarkResult {
  metrics: SearchBenchmarkMetrics;
  perQuery: unknown[];
  runRecords: unknown[];
}

export function runSearchBenchmark(options?: {
  writeReports?: boolean;
}): Promise<SearchBenchmarkResult>;
