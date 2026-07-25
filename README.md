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
npm run corpus:fetch
npm run corpus:verify
npm run corpus:status
npm run search -- "children leave bread crumbs birds eat them"
npm run benchmark
npm test
```

`corpus-release.lock.json` pins the published Corpus v0.2.0 archive and enclosed
manifest by SHA-256. The committed `.example` documents the lock format.

With an active lock, `corpus:fetch` downloads the exact archive into a
same-filesystem staging directory, verifies the outer archive digest, enclosed
manifest digest, manifest schema, every declared artifact, and the Search
record compatibility set, then atomically exposes a cache entry keyed by the
manifest digest. `corpus:verify` and `corpus:status` never use the network.
`FOLKLORE_OFFLINE=1` or `corpus:fetch -- --offline` fails unless that exact
entry is already valid. `FOLKLORE_CACHE_DIR` overrides the user cache root.
Without an active lock, offline resolution also fails instead of silently
falling back to v0.1. Local reproduction may explicitly opt in with
`FOLKLORE_ALLOW_LEGACY_CORPUS=1` or point `FOLKLORE_CORPUS_DIR` at a verified
development release.

The current v0.1 snapshot remains vendored only to reproduce the checked
benchmark until the real v0.2 lock lands. Search resolves it without a
versioned path literal and verifies every declared artifact before indexing.
`FOLKLORE_CORPUS_DIR` remains an explicit legacy/development override.

The full transport and verification contract is in
`docs/research/corpus-release-consumption-v0.2.md`.
