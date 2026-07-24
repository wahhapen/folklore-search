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
npm run corpus:verify
npm run search -- "children leave bread crumbs birds eat them"
npm run benchmark
npm test
```

The current v0.1 snapshot remains vendored temporarily, but Search now resolves
the single installed Release without a version literal and verifies every
manifest-declared artifact before indexing. `FOLKLORE_CORPUS_DIR` can point to
another installed Release. The next transport step is the digest-pinned,
atomic GitHub Release cache specified in
`docs/research/corpus-release-consumption-v0.2.md`.
