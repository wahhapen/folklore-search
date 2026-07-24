import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const requiredFilePaths = {
  schema: "schema.json",
  documents: "documents.jsonl",
  witnesses: "witnesses.jsonl",
  passages: "passages.jsonl",
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseJsonLines(contents) {
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertSafeRelativePath(value) {
  const segments = value.split("/");
  if (
    !value
    || value.startsWith("/")
    || value.includes("\\")
    || segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe artifact path: ${value}`);
  }
}

export async function resolveCorpusReleaseRoot() {
  if (process.env.FOLKLORE_CORPUS_DIR) {
    return path.resolve(process.env.FOLKLORE_CORPUS_DIR);
  }
  const releasesRoot = path.resolve("data/derived/releases");
  const candidates = (await readdir(releasesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("corpus-v"))
    .map((entry) => path.join(releasesRoot, entry.name));
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one installed Corpus Release, found ${candidates.length}. Set FOLKLORE_CORPUS_DIR explicitly.`,
    );
  }
  return candidates[0];
}

export async function loadVerifiedCorpusRelease({
  releaseRoot,
} = {}) {
  const root = releaseRoot
    ? path.resolve(releaseRoot)
    : await resolveCorpusReleaseRoot();
  const manifestBytes = await readFile(path.join(root, "manifest.json"));
  const manifestSha256 = sha256(manifestBytes);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Corpus Release manifest is not valid JSON");
  }
  if (manifest.schemaVersion !== "folklore-release-manifest-v1") {
    throw new Error(
      `Unsupported Corpus Release manifest: ${manifest.schemaVersion}`,
    );
  }
  if (manifest.releaseId !== `fa:release:corpus-v${manifest.version}`) {
    throw new Error("Corpus Release ID and version disagree");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error("Corpus Release has no declared artifacts");
  }

  const artifactByPath = new Map();
  for (const artifact of manifest.artifacts) {
    assertSafeRelativePath(artifact.path);
    if (artifactByPath.has(artifact.path)) {
      throw new Error(`Duplicate artifact path: ${artifact.path}`);
    }
    if (
      !Number.isSafeInteger(artifact.byteLength)
      || artifact.byteLength < 0
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)
    ) {
      throw new Error(`Invalid artifact contract: ${artifact.path}`);
    }
    artifactByPath.set(artifact.path, artifact);
  }
  for (const file of Object.values(requiredFilePaths)) {
    if (!artifactByPath.has(file)) {
      throw new Error(`Corpus Release is missing required artifact: ${file}`);
    }
  }

  const verified = await Promise.all(
    manifest.artifacts.map(async (artifact) => {
      const bytes = await readFile(path.join(root, artifact.path));
      if (bytes.byteLength !== artifact.byteLength) {
        throw new Error(
          `Artifact byte length mismatch: ${artifact.path}`,
        );
      }
      if (sha256(bytes) !== artifact.sha256) {
        throw new Error(`Artifact digest mismatch: ${artifact.path}`);
      }
      return [artifact.path, bytes.toString("utf8")];
    }),
  );
  const contents = Object.fromEntries(verified);

  return {
    root,
    manifest,
    identity: {
      releaseId: manifest.releaseId,
      version: manifest.version,
      manifestSchemaVersion: manifest.schemaVersion,
      manifestSha256,
    },
    files: Object.fromEntries(
      Object.entries(requiredFilePaths).map(([key, file]) => [
        key,
        contents[file],
      ]),
    ),
  };
}
