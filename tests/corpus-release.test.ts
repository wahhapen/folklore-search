import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadVerifiedCorpusRelease } from "../scripts/lib/corpus-release.mjs";

describe("Corpus Release consumer boundary", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("opens a release only after verifying every declared artifact", async () => {
    const release = await loadVerifiedCorpusRelease();

    expect(release.identity).toEqual({
      releaseId: "fa:release:corpus-v0.1.0",
      version: "0.1.0",
      manifestSchemaVersion: "folklore-release-manifest-v1",
      manifestSha256: "1e614c013f4ec9a21e574a17653c8430eee11ae95ba80cc099a7dc52c7f257ca",
    });
    expect(release.files.passages).toContain("fa:passage:");
  });

  it("rejects a changed corpus artifact before Search reads it", async () => {
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "folklore-search-release-"),
    );
    temporaryDirectories.push(temporaryRoot);
    const releaseRoot = join(temporaryRoot, "release");
    await cp(
      resolve("data/derived/releases/corpus-v0.1.0"),
      releaseRoot,
      { recursive: true },
    );
    const passagesPath = join(releaseRoot, "passages.jsonl");
    await writeFile(
      passagesPath,
      `${await readFile(passagesPath, "utf8")}changed`,
    );

    await expect(
      loadVerifiedCorpusRelease({ releaseRoot }),
    ).rejects.toThrow("Artifact byte length mismatch: passages.jsonl");
  });
});
