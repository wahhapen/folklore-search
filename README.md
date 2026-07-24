# Folklore Search

Cited retrieval experiments over immutable Folklore Corpus releases.

The checked v0.1 baseline is passage BM25F evaluated on 16 positive questions
and two abstention probes. It scores nDCG@10 0.758 and succeeds on 14/16
positive questions with exact passage citation integrity.

The benchmark is intentionally too small to select a dense model. Its weak
theme/paraphrase slice is the starting evidence for the next retrieval study.

## Commands

```bash
npm install
npm run search -- "children leave bread crumbs birds eat them"
npm run benchmark
npm test
```

`data/derived/releases/corpus-v0.1.0/` is a vendored immutable snapshot. Future
versions should download a verified `folklore-corpus` release by manifest
digest rather than duplicate mutable corpus-building logic.
