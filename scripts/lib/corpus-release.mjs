import { createHash, randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Ajv2020 from "ajv/dist/2020.js";
import { t as listTar, x as extractTar } from "tar";

const LOCK_SCHEMA_VERSION = "folklore-corpus-lock-v1";
const ACTIVE_LOCK_PATH = "corpus-release.lock.json";
const REQUIRED_FILE_PATHS = {
  schema: "schema.json",
  documents: "documents.jsonl",
  witnesses: "witnesses.jsonl",
  passages: "passages.jsonl",
};
const REQUIRED_ARTIFACTS = new Set([
  ...Object.values(REQUIRED_FILE_PATHS),
  "manifest.schema.json",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function parseJsonLines(contents) {
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has unsupported or missing fields`);
  }
}

export function validateCorpusReleaseLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
    throw new Error("Corpus Release lock must be a JSON object");
  }
  assertExactKeys(
    lock,
    [
      "schemaVersion",
      "source",
      "archiveSha256",
      "manifestSha256",
      "releaseId",
      "version",
      "manifestSchemaVersion",
    ],
    "Corpus Release lock",
  );
  if (lock.schemaVersion !== LOCK_SCHEMA_VERSION) {
    throw new Error(`Unsupported Corpus Release lock: ${lock.schemaVersion}`);
  }
  if (!lock.source || typeof lock.source !== "object") {
    throw new Error("Corpus Release lock source must be an object");
  }
  assertExactKeys(
    lock.source,
    ["repository", "tag", "asset", "url"],
    "Corpus Release lock source",
  );
  if (
    typeof lock.source.repository !== "string"
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(lock.source.repository)
  ) {
    throw new Error("Corpus Release lock has an invalid source repository");
  }
  if (!VERSION_PATTERN.test(lock.version)) {
    throw new Error("Corpus Release lock has an invalid version");
  }
  if (lock.releaseId !== `fa:release:corpus-v${lock.version}`) {
    throw new Error("Corpus Release lock ID and version disagree");
  }
  if (lock.source.tag !== `corpus-v${lock.version}`) {
    throw new Error("Corpus Release lock tag and version disagree");
  }
  if (lock.source.asset !== `folklore-corpus-v${lock.version}.tar.gz`) {
    throw new Error("Corpus Release lock asset and version disagree");
  }
  if (
    !SHA256_PATTERN.test(lock.archiveSha256)
    || !SHA256_PATTERN.test(lock.manifestSha256)
  ) {
    throw new Error("Corpus Release lock has a malformed SHA-256 digest");
  }
  if (lock.manifestSchemaVersion !== "folklore-release-manifest-v1") {
    throw new Error(
      `Unsupported locked manifest schema: ${lock.manifestSchemaVersion}`,
    );
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(lock.source.url);
  } catch {
    throw new Error("Corpus Release lock has an invalid source URL");
  }
  const localHttp =
    sourceUrl.protocol === "http:"
    && (sourceUrl.hostname === "127.0.0.1"
      || sourceUrl.hostname === "::1"
      || sourceUrl.hostname === "localhost");
  if (sourceUrl.protocol !== "https:" && !localHttp) {
    throw new Error("Corpus Release lock source URL must use HTTPS");
  }
  if (path.posix.basename(sourceUrl.pathname) !== lock.source.asset) {
    throw new Error("Corpus Release lock URL and asset disagree");
  }
  return lock;
}

export async function readCorpusReleaseLock(
  lockPath = path.resolve(ACTIVE_LOCK_PATH),
) {
  let contents;
  try {
    contents = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        `No active Corpus Release lock at ${lockPath}. Add the published v0.2 lock as one reviewed file before fetching.`,
      );
    }
    throw error;
  }
  let lock;
  try {
    lock = JSON.parse(contents);
  } catch {
    throw new Error(`Corpus Release lock is not valid JSON: ${lockPath}`);
  }
  return validateCorpusReleaseLock(lock);
}

function defaultUserCacheRoot() {
  if (process.env.FOLKLORE_CACHE_DIR) {
    return path.resolve(process.env.FOLKLORE_CACHE_DIR);
  }
  if (platform() === "win32") {
    return path.resolve(
      process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
    );
  }
  if (platform() === "darwin") {
    return path.join(homedir(), "Library", "Caches");
  }
  return path.resolve(
    process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"),
  );
}

export function cacheEntryPath(lock, cacheRoot = defaultUserCacheRoot()) {
  return path.join(
    path.resolve(cacheRoot),
    "folklore-atlas",
    "corpus",
    "sha256",
    lock.manifestSha256,
  );
}

function assertSafeRelativePath(value, label = "artifact") {
  if (typeof value !== "string") {
    throw new Error(`Unsafe ${label} path: ${String(value)}`);
  }
  const segments = value.split("/");
  if (
    !value
    || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
    || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe ${label} path: ${value}`);
  }
}

async function assertRegularFile(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  return stats;
}

async function assertReleaseRoot(root) {
  const stats = await lstat(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Corpus cache entry is not a directory: ${root}`);
  }
}

async function assertArtifactFile(root, relativePath, label) {
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`${label} has an unsafe parent directory`);
    }
  }
  return assertRegularFile(path.join(root, ...segments), label);
}

function validateManifestIdentity(manifest, lock) {
  if (manifest.schemaVersion !== lock.manifestSchemaVersion) {
    throw new Error("Corpus Release manifest schema disagrees with lock");
  }
  if (manifest.releaseId !== lock.releaseId) {
    throw new Error("Corpus Release manifest ID disagrees with lock");
  }
  if (manifest.version !== lock.version) {
    throw new Error("Corpus Release manifest version disagrees with lock");
  }
  if (
    manifest.producer?.repository
    && manifest.producer.repository !== lock.source.repository
  ) {
    throw new Error("Corpus Release producer repository disagrees with lock");
  }
}

function artifactIndex(manifest) {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error("Corpus Release has no declared artifacts");
  }
  const result = new Map();
  for (const artifact of manifest.artifacts) {
    assertSafeRelativePath(artifact.path);
    if (result.has(artifact.path)) {
      throw new Error(`Duplicate artifact path: ${artifact.path}`);
    }
    if (
      !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength < 0
      || !SHA256_PATTERN.test(artifact.sha256)
    ) {
      throw new Error(`Invalid artifact contract: ${artifact.path}`);
    }
    result.set(artifact.path, artifact);
  }
  for (const requiredPath of REQUIRED_ARTIFACTS) {
    if (!result.has(requiredPath)) {
      throw new Error(
        `Corpus Release is missing required artifact: ${requiredPath}`,
      );
    }
  }
  return result;
}

function compileSchema(schema, label) {
  try {
    return new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  } catch (error) {
    throw new Error(`${label} is not a valid JSON Schema: ${error.message}`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function validateSearchRecords(contents, schema) {
  const validate = compileSchema(schema, "Corpus record schema");
  for (const [filePath, body] of Object.entries(contents)) {
    if (!filePath.endsWith(".jsonl")) {
      continue;
    }
    const records = parseJsonLines(body);
    for (const [index, record] of records.entries()) {
      if (!validate(record)) {
        throw new Error(
          `Corpus record schema mismatch: ${filePath}:${index + 1} ${new Ajv2020().errorsText(validate.errors)}`,
        );
      }
    }
  }
}

function provenanceIdentity(lock) {
  return {
    releaseId: lock.releaseId,
    version: lock.version,
    manifestSchemaVersion: lock.manifestSchemaVersion,
    manifestSha256: lock.manifestSha256,
    archiveSha256: lock.archiveSha256,
    sourceRepository: lock.source.repository,
    sourceTag: lock.source.tag,
    sourceAsset: lock.source.asset,
  };
}

async function verifyReleaseDirectory(root, { lock } = {}) {
  await assertReleaseRoot(root);
  const manifestPath = path.join(root, "manifest.json");
  await assertRegularFile(manifestPath, "Corpus Release manifest");
  const manifestBytes = await readFile(manifestPath);
  const manifestDigest = sha256(manifestBytes);
  if (lock && manifestDigest !== lock.manifestSha256) {
    throw new Error(`Manifest digest mismatch in cache: ${root}`);
  }
  const manifest = parseJson(manifestBytes, "Corpus Release manifest");
  if (lock) {
    validateManifestIdentity(manifest, lock);
  } else {
    if (manifest.schemaVersion !== "folklore-release-manifest-v1") {
      throw new Error(
        `Unsupported Corpus Release manifest: ${manifest.schemaVersion}`,
      );
    }
    if (manifest.releaseId !== `fa:release:corpus-v${manifest.version}`) {
      throw new Error("Corpus Release ID and version disagree");
    }
  }

  const artifacts = artifactIndex(manifest);
  const manifestSchemaArtifact = artifacts.get("manifest.schema.json");
  const manifestSchemaStats = await assertArtifactFile(
    root,
    "manifest.schema.json",
    "Manifest schema",
  );
  const manifestSchemaBytes = await readFile(
    path.join(root, "manifest.schema.json"),
  );
  if (
    manifestSchemaStats.size !== manifestSchemaArtifact.byteLength
    || sha256(manifestSchemaBytes) !== manifestSchemaArtifact.sha256
  ) {
    throw new Error("Artifact digest mismatch: manifest.schema.json");
  }
  const validateManifest = compileSchema(
    parseJson(manifestSchemaBytes, "Corpus Release manifest schema"),
    "Corpus Release manifest schema",
  );
  if (!validateManifest(manifest)) {
    throw new Error(
      `Corpus Release manifest schema mismatch: ${new Ajv2020().errorsText(validateManifest.errors)}`,
    );
  }

  const verified = await Promise.all(
    [...artifacts.values()].map(async (artifact) => {
      let stats;
      try {
        stats = await assertArtifactFile(
          root,
          artifact.path,
          `Corpus artifact ${artifact.path}`,
        );
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(`Missing Corpus artifact: ${artifact.path}`);
        }
        throw error;
      }
      if (stats.size !== artifact.byteLength) {
        throw new Error(`Artifact byte length mismatch: ${artifact.path}`);
      }
      const artifactPath = path.join(root, ...artifact.path.split("/"));
      const retainedForSearch = Object.values(REQUIRED_FILE_PATHS).includes(
        artifact.path,
      );
      const bytes = retainedForSearch ? await readFile(artifactPath) : null;
      const digest = bytes ? sha256(bytes) : await sha256File(artifactPath);
      if (digest !== artifact.sha256) {
        throw new Error(`Artifact digest mismatch: ${artifact.path}`);
      }
      return [
        artifact.path,
        bytes ? bytes.toString("utf8") : undefined,
      ];
    }),
  );
  const contents = Object.fromEntries(verified);
  validateSearchRecords(
    Object.fromEntries(
      Object.values(REQUIRED_FILE_PATHS).map((filePath) => [
        filePath,
        contents[filePath],
      ]),
    ),
    parseJson(Buffer.from(contents["schema.json"]), "Corpus record schema"),
  );

  return {
    root,
    manifest,
    identity: lock
      ? provenanceIdentity(lock)
      : {
          releaseId: manifest.releaseId,
          version: manifest.version,
          manifestSchemaVersion: manifest.schemaVersion,
          manifestSha256: manifestDigest,
        },
    files: Object.fromEntries(
      Object.entries(REQUIRED_FILE_PATHS).map(([key, filePath]) => [
        key,
        contents[filePath],
      ]),
    ),
  };
}

async function listAndValidateArchive(archivePath) {
  const entries = [];
  let validationError;
  await listTar({
    file: archivePath,
    gzip: true,
    strict: true,
    onentry(entry) {
      if (validationError) {
        return;
      }
      try {
        const rawPath = entry.path;
        assertSafeRelativePath(rawPath, "archive entry");
        if (entry.type !== "File") {
          throw new Error(
            `Archive entry is not a regular file: ${rawPath} (${entry.type})`,
          );
        }
        if (entries.includes(rawPath)) {
          throw new Error(`Duplicate archive entry: ${rawPath}`);
        }
        entries.push(rawPath);
      } catch (error) {
        validationError = error;
      }
    },
  });
  if (validationError) {
    throw validationError;
  }
  if (!entries.includes("manifest.json")) {
    throw new Error("Corpus archive is missing manifest.json");
  }
  return entries;
}

async function downloadArchive(url, destination, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (error) {
    throw new Error(`Corpus Release download failed: ${error.message}`);
  }
  if (!response.ok || !response.body) {
    throw new Error(
      `Corpus Release download failed with HTTP ${response.status}`,
    );
  }
  const archiveHash = createHash("sha256");
  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      archiveHash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    hashStream,
    createWriteStream(destination, { flags: "wx" }),
  );
  return {
    resolvedUrl: response.url,
    archiveSha256: archiveHash.digest("hex"),
  };
}

export async function installCorpusRelease({
  lockPath = path.resolve(ACTIVE_LOCK_PATH),
  cacheRoot,
  offline = process.env.FOLKLORE_OFFLINE === "1",
  fetchImpl = globalThis.fetch,
} = {}) {
  const lock = await readCorpusReleaseLock(path.resolve(lockPath));
  const finalRoot = cacheEntryPath(lock, cacheRoot);
  let finalExists = true;
  try {
    await lstat(finalRoot);
  } catch (error) {
    if (error.code === "ENOENT") {
      finalExists = false;
    } else {
      throw error;
    }
  }
  if (finalExists) {
    try {
      return await verifyReleaseDirectory(finalRoot, { lock });
    } catch (error) {
      throw new Error(
        `Locked Corpus cache is present but invalid at ${finalRoot}: ${error.message}. Remove it explicitly before retrying.`,
      );
    }
  }
  if (offline) {
    throw new Error(
      `Offline Corpus Release unavailable: ${lock.releaseId} (${lock.manifestSha256}) is not verified at ${finalRoot}. Run npm run corpus:fetch while online.`,
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("No HTTP fetch implementation is available");
  }

  const parent = path.dirname(finalRoot);
  await mkdir(parent, { recursive: true });
  const stagingRoot = await mkdtemp(
    path.join(parent, `.${lock.manifestSha256}.stage-`),
  );
  const archivePath = path.join(stagingRoot, `${randomUUID()}.part`);
  const extractedRoot = path.join(stagingRoot, "release");
  try {
    const download = await downloadArchive(
      lock.source.url,
      archivePath,
      fetchImpl,
    );
    if (download.archiveSha256 !== lock.archiveSha256) {
      throw new Error("Corpus Release archive digest mismatch");
    }
    const archiveEntries = await listAndValidateArchive(archivePath);
    await mkdir(extractedRoot);
    await extractTar({
      file: archivePath,
      cwd: extractedRoot,
      gzip: true,
      strict: true,
      preservePaths: false,
    });
    const verified = await verifyReleaseDirectory(extractedRoot, { lock });
    const declaredEntries = new Set([
      "manifest.json",
      ...verified.manifest.artifacts.map((artifact) => artifact.path),
    ]);
    for (const entry of archiveEntries) {
      if (!declaredEntries.has(entry)) {
        throw new Error(`Undeclared archive entry: ${entry}`);
      }
    }
    for (const declared of declaredEntries) {
      if (!archiveEntries.includes(declared)) {
        throw new Error(`Missing archive entry: ${declared}`);
      }
    }
    await writeFile(
      path.join(extractedRoot, "acquisition.json"),
      `${JSON.stringify(
        {
          schemaVersion: "folklore-corpus-acquisition-v1",
          release: provenanceIdentity(lock),
          requestedUrl: lock.source.url,
          resolvedUrl: download.resolvedUrl,
          fetchedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
    try {
      await rename(extractedRoot, finalRoot);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) {
        throw error;
      }
      return await verifyReleaseDirectory(finalRoot, { lock });
    }
    return await verifyReleaseDirectory(finalRoot, { lock });
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function resolveLegacyVendoredRelease() {
  if (process.env.FOLKLORE_CORPUS_DIR) {
    return path.resolve(process.env.FOLKLORE_CORPUS_DIR);
  }
  const releasesRoot = path.resolve("data/derived/releases");
  const candidates = (await readdir(releasesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("corpus-v"))
    .map((entry) => path.join(releasesRoot, entry.name));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one legacy vendored Corpus Release, found ${candidates.length}. Set FOLKLORE_CORPUS_DIR explicitly.`,
    );
  }
  return candidates[0];
}

export async function hasActiveCorpusReleaseLock(
  lockPath = path.resolve(ACTIVE_LOCK_PATH),
) {
  try {
    await access(lockPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function resolveCorpusRelease({
  lockPath = path.resolve(ACTIVE_LOCK_PATH),
  cacheRoot,
  offline = process.env.FOLKLORE_OFFLINE === "1",
  allowLegacy = process.env.FOLKLORE_ALLOW_LEGACY_CORPUS === "1",
} = {}) {
  if (await hasActiveCorpusReleaseLock(lockPath)) {
    return installCorpusRelease({ lockPath, cacheRoot, offline });
  }
  if (process.env.FOLKLORE_CORPUS_DIR) {
    return verifyReleaseDirectory(path.resolve(process.env.FOLKLORE_CORPUS_DIR));
  }
  if (offline && !allowLegacy) {
    throw new Error(
      "Offline resolution has no active Corpus Release lock. Add the published lock, or explicitly opt into the legacy development snapshot with FOLKLORE_ALLOW_LEGACY_CORPUS=1.",
    );
  }
  return verifyReleaseDirectory(await resolveLegacyVendoredRelease());
}

export async function resolveCorpusReleaseRoot(options = {}) {
  return (await resolveCorpusRelease(options)).root;
}

export async function loadVerifiedCorpusRelease({
  releaseRoot,
  lock,
  ...resolverOptions
} = {}) {
  if (releaseRoot) {
    return verifyReleaseDirectory(path.resolve(releaseRoot), {
      lock: lock ? validateCorpusReleaseLock(lock) : undefined,
    });
  }
  return resolveCorpusRelease(resolverOptions);
}

export async function verifyCachedCorpusRelease({
  lockPath = path.resolve(ACTIVE_LOCK_PATH),
  cacheRoot,
} = {}) {
  const lock = await readCorpusReleaseLock(lockPath);
  return verifyReleaseDirectory(cacheEntryPath(lock, cacheRoot), { lock });
}
