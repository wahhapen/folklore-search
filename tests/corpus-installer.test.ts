import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cacheEntryPath,
  installCorpusRelease,
  resolveCorpusRelease,
} from "../scripts/lib/corpus-release.mjs";
import { runSearchBenchmark } from "../scripts/run-search-benchmark.mjs";
import {
  createCorpusReleaseFixture,
  createTarGz,
} from "./fixtures/corpus-release.js";

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

describe("digest-pinned Corpus Release installer", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function temporaryRoot() {
    const root = await mkdtemp(join(tmpdir(), "folklore-installer-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    return root;
  }

  async function serve(
    handler: Parameters<typeof createServer>[0],
  ): Promise<{ server: Server; url: string }> {
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a port");
    }
    return {
      server,
      url: `http://127.0.0.1:${address.port}/folklore-corpus-v0.2.0.tar.gz`,
    };
  }

  async function writeLock(
    root: string,
    lock: Record<string, unknown>,
  ) {
    const lockPath = join(root, "corpus-release.lock.json");
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    return lockPath;
  }

  it("downloads once and resolves the verified cache while offline", async () => {
    const fixture = createCorpusReleaseFixture();
    let requests = 0;
    const { url } = await serve((_request, response) => {
      requests += 1;
      response.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": fixture.archive.byteLength,
      });
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lock = fixture.lock(url);
    const lockPath = await writeLock(root, lock);

    const first = await installCorpusRelease({
      lockPath,
      cacheRoot: join(root, "cache"),
    });
    const second = await installCorpusRelease({
      lockPath,
      cacheRoot: join(root, "cache"),
      offline: true,
    });

    expect(second.root).toBe(first.root);
    expect(second.identity).toEqual({
      releaseId: "fa:release:corpus-v0.2.0",
      version: "0.2.0",
      manifestSchemaVersion: "folklore-release-manifest-v1",
      manifestSha256: lock.manifestSha256,
      archiveSha256: lock.archiveSha256,
      sourceRepository: "wahhapen/folklore-corpus",
      sourceTag: "corpus-v0.2.0",
      sourceAsset: "folklore-corpus-v0.2.0.tar.gz",
    });
    expect(requests).toBe(1);
  });

  it("preserves the complete locked release provenance in benchmark output", async () => {
    const fixture = createCorpusReleaseFixture();
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lock = fixture.lock(url);
    const lockPath = await writeLock(root, lock);
    const release = await installCorpusRelease({
      lockPath,
      cacheRoot: join(root, "cache"),
    });

    const result = await runSearchBenchmark({
      writeReports: false,
      releaseRoot: release.root,
      lock,
    });

    expect(result.metrics.corpus).toEqual(release.identity);
  });

  it("rejects changed archive bytes before creating a cache entry", async () => {
    const fixture = createCorpusReleaseFixture();
    const changedArchive = Buffer.from(fixture.archive);
    changedArchive[changedArchive.length - 1] ^= 1;
    const { url } = await serve((_request, response) => {
      response.end(changedArchive);
    });
    const root = await temporaryRoot();
    const lock = fixture.lock(url);
    const lockPath = await writeLock(root, lock);

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("archive digest mismatch");
    await expect(access(cacheEntryPath(lock, join(root, "cache")))).rejects.toThrow();
  });

  it("rejects a changed manifest even when the archive digest is pinned", async () => {
    const fixture = createCorpusReleaseFixture();
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lock = {
      ...fixture.lock(url),
      manifestSha256: "0".repeat(64),
    };
    const lockPath = await writeLock(root, lock);

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("Manifest digest mismatch");
  });

  it("rejects a changed artifact declared by a locked manifest", async () => {
    const fixture = createCorpusReleaseFixture({
      manifest(manifest) {
        return {
          ...manifest,
          artifacts: (
            manifest.artifacts as Array<Record<string, unknown>>
          ).map((artifact) =>
            artifact.path === "passages.jsonl"
              ? { ...artifact, sha256: "0".repeat(64) }
              : artifact,
          ),
        };
      },
    });
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("Artifact digest mismatch: passages.jsonl");
  });

  it("rejects a locked archive whose manifest names another release", async () => {
    const fixture = createCorpusReleaseFixture({
      manifest(manifest) {
        return { ...manifest, releaseId: "fa:release:corpus-v9.9.9" };
      },
    });
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("manifest ID disagrees with lock");
  });

  it.each([
    [
      "version",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        version: "9.9.9",
      }),
      "manifest version disagrees with lock",
    ],
    [
      "manifest schema version",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        schemaVersion: "folklore-release-manifest-v2",
      }),
      "manifest schema disagrees with lock",
    ],
    [
      "producer repository",
      (manifest: Record<string, unknown>) => ({
        ...manifest,
        producer: {
          ...(manifest.producer as Record<string, unknown>),
          repository: "someone/other-corpus",
        },
      }),
      "producer repository disagrees with lock",
    ],
  ])(
    "rejects a locked archive with the wrong %s",
    async (_label, changeManifest, expectedError) => {
      const fixture = createCorpusReleaseFixture({
        manifest: changeManifest,
      });
      const { url } = await serve((_request, response) => {
        response.end(fixture.archive);
      });
      const root = await temporaryRoot();
      const lockPath = await writeLock(root, fixture.lock(url));

      await expect(
        installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
      ).rejects.toThrow(expectedError);
    },
  );

  it.each([
    ["absolute", "/escape.txt", "0", ""],
    ["traversal", "../escape.txt", "0", ""],
    ["symlink", "escape.txt", "2", "manifest.json"],
    ["hard link", "escape.txt", "1", "manifest.json"],
  ] as const)(
    "rejects an archive containing an %s entry",
    async (_label, name, type, linkName) => {
      const fixture = createCorpusReleaseFixture({
        archiveEntries(entries) {
          return [
            ...entries,
            {
              name,
              type,
              linkName,
              bytes: Buffer.from(type === "0" ? "escape" : ""),
            },
          ];
        },
      });
      const { url } = await serve((_request, response) => {
        response.end(fixture.archive);
      });
      const root = await temporaryRoot();
      const lockPath = await writeLock(root, fixture.lock(url));

      await expect(
        installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
      ).rejects.toThrow(/Unsafe archive entry|not a regular file/);
    },
  );

  it("rejects duplicate normalized archive paths", async () => {
    const fixture = createCorpusReleaseFixture({
      archiveEntries(entries) {
        return [
          ...entries,
          {
            name: "passages.jsonl",
            bytes: Buffer.from("replacement"),
          },
        ];
      },
    });
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("Duplicate archive entry: passages.jsonl");
  });

  it("rejects undeclared regular files", async () => {
    const fixture = createCorpusReleaseFixture({
      archiveEntries(entries) {
        return [
          ...entries,
          { name: "surprise.txt", bytes: Buffer.from("not declared") },
        ];
      },
    });
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("Undeclared archive entry: surprise.txt");
  });

  it("fails offline with an actionable error and performs no request", async () => {
    const fixture = createCorpusReleaseFixture();
    let requests = 0;
    const { url } = await serve((_request, response) => {
      requests += 1;
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({
        lockPath,
        cacheRoot: join(root, "cache"),
        offline: true,
      }),
    ).rejects.toThrow(/Offline Corpus Release unavailable.*corpus:fetch/);
    expect(requests).toBe(0);
  });

  it("does not silently use the legacy corpus offline without an explicit opt-in", async () => {
    const root = await temporaryRoot();
    const lockPath = join(root, "missing.lock.json");

    await expect(
      resolveCorpusRelease({ lockPath, offline: true }),
    ).rejects.toThrow(/offline.*no active Corpus Release lock/i);

    const legacy = await resolveCorpusRelease({
      lockPath,
      offline: true,
      allowLegacy: true,
    });
    expect(legacy.identity.version).toBe("0.1.0");
  });

  it("retries an interrupted response without exposing a partial cache", async () => {
    const fixture = createCorpusReleaseFixture();
    let requests = 0;
    const { url } = await serve((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(200, {
          "content-length": fixture.archive.byteLength,
        });
        response.write(fixture.archive.subarray(0, 128));
        response.destroy();
      } else {
        response.end(fixture.archive);
      }
    });
    const root = await temporaryRoot();
    const lock = fixture.lock(url);
    const cacheRoot = join(root, "cache");
    const lockPath = await writeLock(root, lock);

    await expect(
      installCorpusRelease({ lockPath, cacheRoot }),
    ).rejects.toThrow();
    await expect(access(cacheEntryPath(lock, cacheRoot))).rejects.toThrow();
    const parent = join(
      cacheRoot,
      "folklore-atlas",
      "corpus",
      "sha256",
    );
    expect(await readdir(parent)).toEqual([]);

    const release = await installCorpusRelease({ lockPath, cacheRoot });
    expect(release.root).toBe(cacheEntryPath(lock, cacheRoot));
    expect(requests).toBe(2);
  });

  it("concurrent installers converge on one complete cache entry", async () => {
    const fixture = createCorpusReleaseFixture();
    const { url } = await serve((_request, response) => {
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const cacheRoot = join(root, "cache");
    const lockPath = await writeLock(root, fixture.lock(url));

    const installations = await Promise.all([
      installCorpusRelease({ lockPath, cacheRoot }),
      installCorpusRelease({ lockPath, cacheRoot }),
      installCorpusRelease({ lockPath, cacheRoot }),
    ]);

    expect(new Set(installations.map((release) => release.root)).size).toBe(1);
    const parent = join(
      cacheRoot,
      "folklore-atlas",
      "corpus",
      "sha256",
    );
    expect(await readdir(parent)).toEqual([
      installations[0].identity.manifestSha256,
    ]);
  });

  it("refuses to overwrite or redownload a corrupt final cache entry", async () => {
    const fixture = createCorpusReleaseFixture();
    let requests = 0;
    const { url } = await serve((_request, response) => {
      requests += 1;
      response.end(fixture.archive);
    });
    const root = await temporaryRoot();
    const cacheRoot = join(root, "cache");
    const lock = fixture.lock(url);
    const lockPath = await writeLock(root, lock);
    const release = await installCorpusRelease({ lockPath, cacheRoot });
    await writeFile(join(release.root, "passages.jsonl"), "corrupt");

    await expect(
      installCorpusRelease({ lockPath, cacheRoot }),
    ).rejects.toThrow(/cache is present but invalid.*Remove it explicitly/);
    expect(requests).toBe(1);
  });

  it("rejects invalid Search records before exposing the cache", async () => {
    const baseFixture = createCorpusReleaseFixture();
    const entries = await extractFixtureEntries(baseFixture.archive);
    entries.set(
      "passages.jsonl",
      Buffer.from('{"schemaVersion":"folklore-passage-v1","id":"bad"}\n'),
    );
    const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    manifest.artifacts = manifest.artifacts.map(
      (artifact: Record<string, unknown>) => {
        const bytes = entries.get(artifact.path as string)!;
        return {
          ...artifact,
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        };
      },
    );
    entries.set(
      "manifest.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    const archive = createTarGz(
      [...entries].map(([name, bytes]) => ({ name, bytes })),
    );
    const fixture = {
      archive,
      lock(url: string) {
        return {
          ...baseFixture.lock(url),
          archiveSha256: sha256(archive),
          manifestSha256: sha256(entries.get("manifest.json")!),
        };
      },
    };
    const { url } = await serve((_request, response) => response.end(archive));
    const root = await temporaryRoot();
    const lockPath = await writeLock(root, fixture.lock(url));

    await expect(
      installCorpusRelease({ lockPath, cacheRoot: join(root, "cache") }),
    ).rejects.toThrow("Corpus record schema mismatch");
  });
});

async function extractFixtureEntries(archive: Buffer) {
  const { gunzipSync } = await import("node:zlib");
  const tar = gunzipSync(archive);
  const entries = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.byteLength; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = header
      .subarray(0, 100)
      .toString("utf8")
      .replace(/\0.*$/, "");
    const size = Number.parseInt(
      header
        .subarray(124, 136)
        .toString("ascii")
        .replace(/\0.*$/, "")
        .trim(),
      8,
    );
    const start = offset + 512;
    entries.set(name, Buffer.from(tar.subarray(start, start + size)));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}
