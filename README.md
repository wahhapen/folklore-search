# Folklore Search

Cited retrieval experiments over immutable Folklore Corpus releases.

The checked v0.1 baseline is passage BM25F evaluated on 16 positive questions
and two negative probes. It scores nDCG@10 0.758 and succeeds on 14/16
positive questions with exact passage citation integrity. Under the same
configuration as interactive search it returns partial lexical matches for both
negative probes, so its honest negative-abstention score is 0.0.

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

`corpus-release.lock.json` pins the published Corpus v0.3.0 archive, producer
commit, and enclosed manifest by SHA-256 for interactive search and current
consumer verification.
The committed `.example` documents the lock format.

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

The historical `search-v0.1` benchmark is always evaluated against the
vendored Corpus v0.1 release it was judged on: 170 Documents and 3,291 Passages,
with an exact manifest identity. It refuses a different release or candidate
universe even while interactive search consumes the newer locked Corpus.
A separately versioned and re-judged benchmark will cover Corpus v0.2.x; these
historical metrics must not be relabeled as v0.2.x results.

The full transport and verification contract is in
`docs/research/corpus-release-consumption-v0.2.md`.

## Verified Corpus gateway

Server-side consumers can install or reuse the exact locked Corpus v0.3.0
release and construct the production search index through one package import:

```js
import { loadCorpusSearchGateway } from "folklore-search";

const gateway = await loadCorpusSearchGateway();
const results = gateway.index.search("children leave bread crumbs", {
  limit: 10,
  filters: { language: "en" },
});
```

The default lock is package-owned, so the consumer does not need to copy a lock
or depend on its process working directory.

The promise resolves only after the archive, manifest, producer identity,
manifest schema (including its shipped schema dependency), and every declared
artifact have passed verification. The returned `records` preserve Documents,
Witnesses, Passages, Representations, Derivations, Rights Contract v2
assessments, and translation provenance/review records. `offline: true` forbids
network access and requires the exact verified cache entry to exist.

The interactive CLI uses this gateway. The historical benchmark continues to
load its separately verified and digest-frozen Corpus v0.1 universe, while
sharing the same production BM25F constructor and ranking policy.

## Importable BM25F module

The same in-process implementation used by the CLI and benchmark is available
through the package root:

```js
import { createCorpusSearchIndex } from "folklore-search";

const index = createCorpusSearchIndex({ documents, passages });
const results = index.search("children leave bread crumbs", {
  limit: 10,
  filters: {
    language: "en",
    representedRegion: ["Nordic Europe", "Northern Europe"],
  },
});
```

`createSearchIndex(records)` is the lower-level seam for callers that already
have search records containing `id`, `title`, `text`, citation fields, and a
flat `metadata` object. Both constructors use the production BM25F policy by
default, including one best passage per document. A caller may override an
individual query option explicitly; the complete frozen defaults are exported
as `PRODUCTION_RETRIEVAL_OPTIONS`.

Metadata filters have explicit exact-match semantics:

- different fields are combined with AND;
- an array of accepted values within one field uses OR;
- values are compared case-sensitively without normalization;
- a missing field or an empty accepted-values array does not match;
- filters determine candidate eligibility before document deduplication and
  result limiting, while BM25F statistics remain those of the complete index.

Every result preserves the source record and adds `score`, `matchedTerms`, and
a machine-readable `explanation`. The explanation lists matched normalized
query terms and the actual additive title/text contribution computed for each
term. Scores are retrieval diagnostics, not probabilities, evidence quality,
or claims of cultural authority.
