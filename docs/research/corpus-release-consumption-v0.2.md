# Verified Corpus Release consumption contract (v0.2 research)

Status: implemented; retained as the original v0.2 design record  
Issue: [`folklore-search#2`](https://github.com/wahhapen/folklore-search/issues/2)  
Researched: 2026-07-24

The active consumer lock now pins Corpus v0.3.0. `README.md` and
`corpus-release.lock.json` describe current behavior; v0.2 names below are
historical design examples.

## Decision

For Corpus v0.2, publish one deterministic `tar.gz` as an **immutable GitHub
Release asset**, pin its SHA-256 and the enclosed `manifest.json` SHA-256 in a
small lock file committed by each consumer, and install it into a
content-addressed local cache only after complete verification.

This is the smallest boundary that gives Search and ML Lab the same immutable
input without:

- vendoring another corpus copy into every repository;
- teaching consumers how Corpus is built;
- resolving a mutable `latest` release;
- operating an npm, OCI, Hugging Face, DVC, or custom object registry before
  release size or access patterns require one.

GitHub explicitly recommends Releases for distributing large repository
artifacts. A release may have up to 1,000 assets, each under 2 GiB, and GitHub
currently documents no total release-size or bandwidth limit
([About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases),
[About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)).
That is ample for the current 7.8 MiB text projection. Original scans, audio,
and books remain in the Corpus artifact store; they do not have to be copied
into every Search release package.

The Corpus repository should enable GitHub's immutable releases setting.
Published immutable releases prevent both the Git tag and attached assets from
being changed. GitHub recommends assembling such releases as drafts and adding
all assets before publication
([Immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases),
[Managing releases](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)).
The consumer lock remains mandatory even with this setting: it makes a reviewed
digest, not a remote release name, the consumer's source of truth.

## Evidence from v0.1

The vendored Search release and the Corpus release at Corpus commit
`e8cb8a3d60031c2e15eaa3b278ca6353208ecb39` are byte-identical. Their
`manifest.json` SHA-256 is:

```text
440728e8b3f6efcb540e7357a84ee1ab990edd8574441774a0676f6af880fa71
```

The existing manifest is already a strong inner integrity index:

- `schemaVersion`, `releaseId`, and `version` identify the release contract;
- every artifact has a relative path, byte length, and SHA-256;
- input URL, byte length, and SHA-256 preserve source acquisition evidence;
- compiler and parser versions preserve part of the build provenance.

Corpus's current validator checks artifact digests, record schema, identities,
references, source spans, counts, and deterministic rebuilding. Search must not
copy that build validator. It needs only the distribution boundary and the
consumer-side compatibility checks described below.

Three current Search behaviors prevent that boundary from being executable:

1. [`search-corpus.mjs`](../../scripts/search-corpus.mjs) and
   [`run-search-benchmark.mjs`](../../scripts/run-search-benchmark.mjs)
   hard-code `data/derived/releases/corpus-v0.1.0`.
2. The benchmark hashes the manifest, but no code verifies its declared
   artifact hashes or byte lengths before use.
3. The manifest's `schema.json` describes corpus **records**. There is no JSON
   Schema for `manifest.json` itself, so its required fields are implicit in
   producer code.

The third point should be corrected in Corpus v0.2 by shipping and testing a
`folklore-release-manifest-v1` schema. Keeping the record schema and manifest
schema distinct avoids the misleading implication that one validates both.
Draft 2020-12 is already used by the record schema and remains the current
published JSON Schema dialect
([JSON Schema specification](https://json-schema.org/specification)).

## Producer contract

### Version and naming

A published Corpus release MUST have:

```text
Git tag:       corpus-v0.2.0
Release ID:    fa:release:corpus-v0.2.0
Asset:         folklore-corpus-v0.2.0.tar.gz
Checksum:      folklore-corpus-v0.2.0.tar.gz.sha256
```

Version numbers are examples; the invariant is that the tag, release ID, asset
name, manifest version, and lock version agree. A published version is never
rebuilt in place. A correction becomes a new version.

### Archive

The archive MUST:

- be deterministic for byte-identical release contents;
- contain `manifest.json` at its root and exactly the artifact paths declared
  by that manifest;
- contain regular files only—no symlinks, hard links, devices, absolute paths,
  `..` components, or duplicate normalized paths;
- preserve artifact bytes exactly; extraction MUST NOT normalize line endings;
- include the record schema and dataset card as declared artifacts.

`manifest.json` cannot securely contain its own digest. The producer therefore
computes two outer values after packing:

1. SHA-256 of the exact archive bytes;
2. SHA-256 of the exact enclosed `manifest.json` bytes.

The first is published in the `.sha256` sidecar and both are printed as a
consumer-lock snippet by the pack command. SHA-256 is already used throughout
Corpus and is standardized for change detection by NIST
([FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)).

GitHub's Release Asset API also exposes a `digest` field and documents that
binary downloads may be returned directly or by redirect
([Release assets REST API](https://docs.github.com/en/rest/releases/assets)).
The API digest is a useful publication cross-check, but the reviewed,
repository-committed lock is authoritative: a value fetched from the same
remote location at download time is not a pin.

### Manifest

Corpus v0.2 MAY retain `folklore-release-manifest-v1`, provided its new manifest
schema makes at least these fields mandatory:

- `schemaVersion`, `releaseId`, `version`, `publishedAt`;
- `compiler.command`, `compiler.parser`, and the supported Node range;
- producer repository and exact producer commit;
- `counts`;
- `inputs[]` with source locator, byte length, and SHA-256;
- `artifacts[]` with unique normalized relative path, byte length (including
  zero), and SHA-256.

The manifest schema SHOULD reject unknown contract-level properties until a
deliberate schema revision is made. Individual corpus record schemas can keep
their current forward-compatible `additionalProperties` policy.

The producer command surface should be:

```bash
npm run release:pack -- --release data/derived/releases/corpus-v0.2.0
npm run release:verify -- --archive dist/folklore-corpus-v0.2.0.tar.gz
```

`release:verify` MUST exercise the same outer archive and inner-manifest checks
as a consumer. Corpus's deeper provenance and semantic validation remains an
additional producer gate.

## Consumer lock

Search commits one human-reviewable file, recommended at
`corpus-release.lock.json`:

```json
{
  "schemaVersion": "folklore-corpus-lock-v1",
  "source": {
    "repository": "wahhapen/folklore-corpus",
    "tag": "corpus-v0.2.0",
    "asset": "folklore-corpus-v0.2.0.tar.gz",
    "url": "https://github.com/wahhapen/folklore-corpus/releases/download/corpus-v0.2.0/folklore-corpus-v0.2.0.tar.gz"
  },
  "archiveSha256": "<64 lowercase hex characters>",
  "manifestSha256": "<64 lowercase hex characters>",
  "releaseId": "fa:release:corpus-v0.2.0",
  "version": "0.2.0",
  "manifestSchemaVersion": "folklore-release-manifest-v1",
  "producerCommit": "<40 lowercase hex characters>"
}
```

The lock MUST be sufficient to consume a release without querying "latest" or
the GitHub API. An update is an ordinary reviewed commit changing this file.
The same shape can be copied into ML Lab without sharing implementation code or
introducing a package registry.

The URL is transport metadata, not identity. The two digests, release ID, and
producer commit are identity and integrity metadata. A mirror may therefore
replace the URL in a future lock revision without changing the expected
release.

## Verification and installation algorithm

The implementation should follow this order and fail closed:

1. Parse and validate the committed lock. Reject an unsupported lock schema,
   malformed digest, or unapproved URL scheme.
2. Resolve the final cache directory from `manifestSha256`.
3. If that directory exists, verify it against the lock and return it without
   network access.
4. If offline mode is active and no valid cache exists, stop with the expected
   release ID, manifest digest, cache location, and the exact online fetch
   command.
5. Create a unique staging directory beside the final cache directory.
6. Download to a staging `.part` file while computing SHA-256. Require an HTTP
   success response, follow GitHub's redirect, and reject a mismatched archive
   digest **before extraction**.
7. Extract into staging with the archive restrictions above. Reject an
   unexpected entry, missing entry, duplicate path, or path that escapes the
   staging root.
8. Hash the exact `manifest.json` bytes and compare with the lock before
   parsing it.
9. Validate the manifest schema. Require exact agreement with locked
   `releaseId`, `version`, and `manifestSchemaVersion`.
10. For every declared artifact, verify path uniqueness, byte length, and
    SHA-256. Require the Search compatibility set:
    `schema.json`, `documents.jsonl`, `witnesses.jsonl`, and `passages.jsonl`.
11. Validate every record Search will read against the enclosed record schema.
    This is compatibility checking, not a duplicate corpus build.
12. Write `acquisition.json` in staging, then rename the complete staging
    directory into its final content-addressed location.
13. If a concurrent process won the rename race, verify the winner and discard
    only this process's staging directory.

Node exposes promise-based `rename`; operations depending on it must await its
completion
([Node file-system documentation](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)).
Staging and destination must be siblings on the same filesystem, and the
destination must not be mutated after installation. That gives consumers only
two observable states: no cached release, or a completely verified release.
Interrupted downloads and extraction failures remain unreachable staging data.

Do not automatically delete or overwrite a corrupt final cache. Report the
failed path and require an explicit repair command. Silent fallback to another
version is forbidden.

## Cache and offline behavior

Use one user-level cache so Search and ML Lab can reuse the same immutable
release:

```text
<cache-root>/folklore-atlas/corpus/sha256/<manifestSha256>/
```

`FOLKLORE_CACHE_DIR` provides an explicit CI and local override. Without it,
the client should use the platform's normal user cache root. Cache identity
MUST NOT be a version string, tag, or URL.

Offline behavior is part of the contract:

- a valid cache hit succeeds and performs zero network requests;
- a missing, incomplete, or corrupt cache fails clearly;
- offline mode never resolves another version and never attempts a network
  probe;
- Search and benchmark scripts accept `FOLKLORE_OFFLINE=1`;
- a normal online run also reuses a valid cache without contacting GitHub.

`corpus:verify` should hash every declared artifact. Search and benchmark startup
must at minimum verify the lock, manifest, and every artifact they consume.
At the current release size, verifying all artifacts on every run is also
reasonable and is the safer initial behavior.

## Consumer commands and provenance

Recommended Search command surface:

```bash
npm run corpus:fetch
npm run corpus:fetch -- --offline
npm run corpus:verify
npm run corpus:status
npm run search -- "children leave bread crumbs birds eat them"
npm run benchmark
```

- `corpus:fetch` installs or verifies exactly the lock-pinned release.
- `corpus:verify` is network-free and verifies the full cached release.
- `corpus:status` is network-free and prints lock, cache, and validation status.
- Search and benchmark resolve their release root through the same module; no
  script contains a versioned directory literal.

Every benchmark result MUST preserve:

```json
{
  "corpus": {
    "releaseId": "fa:release:corpus-v0.2.0",
    "version": "0.2.0",
    "manifestSchemaVersion": "folklore-release-manifest-v1",
    "manifestSha256": "<digest>",
    "archiveSha256": "<digest>",
    "sourceRepository": "wahhapen/folklore-corpus",
    "sourceTag": "corpus-v0.2.0",
    "sourceAsset": "folklore-corpus-v0.2.0.tar.gz"
  }
}
```

`fetchedAt`, resolved redirect URL, and local cache path belong in
`acquisition.json`, not in deterministic benchmark identity. The benchmark
should not record only `version`, because a digest is what proves which bytes
were evaluated.

## Security boundary

SHA-256 verification proves that downloaded bytes match the reviewed lock; it
does not by itself prove who produced those bytes. For v0.2, authorship rests
on review of the lock change, repository access control, HTTPS, and GitHub
immutable releases.

GitHub artifact attestations can later add cryptographically signed build
provenance and can be verified with GitHub's tooling
([Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations),
[Verify release integrity](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)).
They are a compatible hardening step, not a v0.2 prerequisite. Requiring them
now would add CI identity and `gh` tooling without fixing a current consumer
failure.

## Options not selected

| Option | Decision now | Revisit when |
|---|---|---|
| Git checkout/submodule | Reject. It couples data delivery to source history and repeats the current vendoring problem. | Never for released corpus payloads. |
| Git LFS | Reject for consumer distribution. It adds pointer and quota behavior where Releases already provide direct assets. | Only if contributor workflows require versioning large source assets in Git. |
| npm package | Reject. The corpus is data, not a JavaScript library; package installation would conflate dependency and dataset lifecycles. | A genuinely shared client library has multiple stable consumers. |
| OCI artifact registry | Defer. Content-addressed blobs and manifests fit future sharding, but registry auth, media types, publishing, and garbage collection are operational surface area. | Partial pulls, deduplication across many large releases, or multiple distribution backends become measured needs. |
| Hugging Face/DVC/custom registry | Defer. Each introduces another canonical platform before the release contract itself is proven. | Corpus discovery, dataset streaming, remote execution, or collaboration requirements exceed GitHub Releases. |
| GitHub Actions artifacts | Reject for releases. Workflow artifacts have a CI lifecycle; GitHub Releases are the durable user-facing distribution primitive. | Never as the canonical published release. |

The first scaling trigger is not "the database is large." It is one of:

- a single projection archive approaches GitHub's 2 GiB per-asset limit;
- consumers need a small shard without downloading the full projection;
- the same large blobs are duplicated materially across releases;
- private-source access control differs from public-release access;
- download reliability or measured bandwidth becomes unacceptable.

At that point, keep the lock/manifest/digest/cache contract and replace only
the transport. This is why URL is not release identity.

## Implementation acceptance tests

The contract is executable when automated tests prove:

1. a valid fixture downloads once, verifies, and is reused;
2. a changed archive byte is rejected before extraction;
3. a changed manifest byte is rejected before parsing;
4. a changed or truncated artifact is rejected;
5. wrong release ID, version, or schema version is rejected;
6. absolute paths, `..`, symlinks, hard links, duplicate paths, and undeclared
   entries are rejected;
7. interrupted download/extraction never creates the final cache path;
8. concurrent fetches result in one valid final cache;
9. offline valid-cache succeeds with a network function that would fail the
   test if called;
10. offline missing/corrupt-cache fails with an actionable message;
11. Search and benchmark have no hard-coded corpus version path;
12. benchmark output contains the complete deterministic provenance block;
13. repeated Corpus packing of identical release contents produces the same
    archive digest.

## Minimal implementation sequence

1. In Corpus, add the manifest schema, producer commit fields, deterministic
   pack/verify scripts, the sidecar checksum, and the tests above that belong
   to the producer.
2. Publish Corpus v0.2 as a draft with both assets, then publish it with
   immutable releases enabled.
3. In Search, commit `corpus-release.lock.json`, add one release resolver,
   cache installer, verifier, and the consumer acceptance tests.
4. Route Search and benchmark through the resolver and expand benchmark
   provenance.
5. Delete the vendored v0.1 release only after the locked v0.2 path passes in
   clean online and offline CI jobs.
6. Apply the same lock shape and behavior in ML Lab. Copying the small client
   implementation once is acceptable; extract a shared package only after two
   working consumers expose a real stable API.

This sequence resolves the current distribution gap while preserving the
architectural rule: Corpus owns acquisition and release construction;
consumers own only pinning, verification, caching, and compatibility.
