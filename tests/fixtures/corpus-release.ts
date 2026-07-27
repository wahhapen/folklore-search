import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

type TarEntry = {
  name: string;
  bytes?: Buffer;
  type?: "0" | "1" | "2";
  linkName?: string;
};

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

function writeString(
  target: Buffer,
  value: string,
  offset: number,
  length: number,
) {
  target.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(
  target: Buffer,
  value: number,
  offset: number,
  length: number,
) {
  writeString(
    target,
    `${value.toString(8).padStart(length - 1, "0")}\0`,
    offset,
    length,
  );
}

export function createTarGz(entries: TarEntry[]) {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    writeString(header, entry.name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, bytes.byteLength, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    writeString(header, entry.type ?? "0", 156, 1);
    writeString(header, entry.linkName ?? "", 157, 100);
    writeString(header, "ustar\0", 257, 6);
    writeString(header, "00", 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeString(
      header,
      `${checksum.toString(8).padStart(6, "0")}\0 `,
      148,
      8,
    );
    chunks.push(header, bytes);
    const padding = (512 - (bytes.byteLength % 512)) % 512;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { mtime: 0 });
}

export function createCorpusReleaseFixture(
  overrides: {
    archiveEntries?: (entries: TarEntry[]) => TarEntry[];
    manifest?: (manifest: Record<string, unknown>) => Record<string, unknown>;
    records?: Record<string, string>;
    version?: string;
  } = {},
) {
  const version = overrides.version ?? "0.2.0";
  const records = {
    "schema.json": `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["schemaVersion", "id"],
      properties: {
        schemaVersion: { type: "string" },
        id: { type: "string", pattern: "^fa:" },
      },
      additionalProperties: true,
    })}\n`,
    "documents.jsonl":
      '{"schemaVersion":"folklore-document-v1","id":"fa:document:test","title":"Test"}\n',
    "witnesses.jsonl":
      '{"schemaVersion":"folklore-witness-v1","id":"fa:witness:test","documentId":"fa:document:test","text":"A test witness."}\n',
    "passages.jsonl":
      '{"schemaVersion":"folklore-passage-v1","id":"fa:passage:test","documentId":"fa:document:test","witnessId":"fa:witness:test","ordinal":1,"text":"A test witness.","citationLabel":"Test, passage 1"}\n',
    ...overrides.records,
    "manifest.schema.json": `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: [
        "schemaVersion",
        "releaseId",
        "version",
        "publishedAt",
        "producer",
        "compiler",
        "counts",
        "inputs",
        "artifacts",
      ],
      properties: {
        schemaVersion: { const: "folklore-release-manifest-v1" },
        releaseId: { type: "string" },
        version: { type: "string" },
        publishedAt: { type: "string" },
        producer: { type: "object" },
        compiler: { type: "object" },
        counts: { type: "object" },
        inputs: { type: "array" },
        artifacts: { type: "array" },
      },
    })}\n`,
  };
  const artifacts = Object.entries(records).map(([path, contents]) => {
    const bytes = Buffer.from(contents);
    return { path, byteLength: bytes.byteLength, sha256: sha256(bytes) };
  });
  const baseManifest = {
    schemaVersion: "folklore-release-manifest-v1",
    releaseId: `fa:release:corpus-v${version}`,
    version,
    publishedAt: "2026-07-25",
    producer: {
      repository: "wahhapen/folklore-corpus",
      commit: "a".repeat(40),
    },
    compiler: {
      command: "npm run release:build",
      parser: "fixture-v1",
      node: ">=22.13.0",
    },
    counts: { documents: 1, witnesses: 1, passages: 1 },
    inputs: [],
    artifacts,
  };
  const manifest = overrides.manifest
    ? overrides.manifest(baseManifest)
    : baseManifest;
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const baseEntries: TarEntry[] = [
    { name: "manifest.json", bytes: manifestBytes },
    ...Object.entries(records).map(([name, contents]) => ({
      name,
      bytes: Buffer.from(contents),
    })),
  ];
  const archiveEntries = overrides.archiveEntries
    ? overrides.archiveEntries(baseEntries)
    : baseEntries;
  const archive = createTarGz(archiveEntries);
  return {
    archive,
    lock(url: string) {
      return {
        schemaVersion: "folklore-corpus-lock-v1",
        source: {
          repository: "wahhapen/folklore-corpus",
          tag: `corpus-v${version}`,
          asset: `folklore-corpus-v${version}.tar.gz`,
          url,
        },
        archiveSha256: sha256(archive),
        manifestSha256: sha256(manifestBytes),
        producerCommit: "a".repeat(40),
        releaseId: `fa:release:corpus-v${version}`,
        version,
        manifestSchemaVersion: "folklore-release-manifest-v1",
      };
    },
  };
}
