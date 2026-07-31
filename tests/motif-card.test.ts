import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCorpusSearchGateway } from "../src/index.mjs";

describe("motif card CLI", () => {
  const temporaryRoots: string[] = [];
  const ownerLabel = "Owner-supplied test label";

  async function temporaryCardPath(name = "card.md") {
    const root = await mkdtemp(join(tmpdir(), "folklore-motif-card-"));
    temporaryRoots.push(root);
    return join(root, name);
  }

  function runCard({
    motif = ownerLabel,
    query,
    output,
  }: {
    motif?: string;
    query?: string;
    output?: string;
  }) {
    const args = ["scripts/generate-motif-card.mjs"];
    if (motif !== undefined) args.push("--motif", motif);
    if (query !== undefined) args.push("--query", query);
    if (output !== undefined) args.push("--output", output);
    return spawnSync(
      process.execPath,
      args,
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      },
    );
  }

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    );
  });

  it("requires an owner-supplied motif label, lexical query, and output path", () => {
    const result = runCard({ query: "forest signal" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Usage:");
  });

  it("writes a byte-stable card tied to the verified Corpus release", async () => {
    const firstPath = await temporaryCardPath("first.md");
    const secondPath = await temporaryCardPath("second.md");
    const query = "children leave bread crumbs birds eat them";
    const gateway = await loadCorpusSearchGateway();

    for (const output of [firstPath, secondPath]) {
      const result = runCard({
        motif: "Owner # label | [test]",
        query,
        output,
      });
      expect(result.status, result.stderr).toBe(0);
    }

    const first = await readFile(firstPath, "utf8");
    const second = await readFile(secondPath, "utf8");
    expect(first).toBe(second);
    expect(first).toContain("# Motif reference: Owner \\# label \\| \\[test\\]");
    expect(first).toContain(query);
    expect(first).toContain(gateway.release.releaseId);
    expect(first).toContain(gateway.release.manifestSha256);
    expect(first.endsWith("\n")).toBe(true);
    expect(first).not.toMatch(/generated (at|on)/i);
  }, 20_000);

  it("preserves production ranking and complete cited Passage evidence", async () => {
    const output = await temporaryCardPath();
    const query = "children leave bread crumbs birds eat them";
    const gateway = await loadCorpusSearchGateway();
    const expected = gateway.index.search(query, { limit: 10 });

    const result = runCard({ query, output });
    expect(result.status, result.stderr).toBe(0);

    const card = await readFile(output, "utf8");
    const comparison = card.slice(
      card.indexOf("## Comparison"),
      card.indexOf("## Candidate passages"),
    );
    let previousPosition = -1;
    for (const candidate of expected) {
      const position = comparison.indexOf(candidate.id);
      expect(position).toBeGreaterThan(previousPosition);
      previousPosition = position;
      expect(card).toContain(candidate.documentId);
      expect(card).toContain(candidate.witnessId);
      expect(card).toContain(candidate.citationLabel);
      const quotedText = candidate.text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      if (candidate.contentStatus === "metadata-only-no-transcript") {
        expect(card).not.toContain(quotedText);
      } else {
        expect(card).toContain(quotedText);
      }
      expect(card).toContain(
        `${candidate.matchedTerms}/7 normalized query terms`,
      );
    }
    const metadataOnly = expected.find(
      ({ contentStatus }) => contentStatus === "metadata-only-no-transcript",
    );
    expect(metadataOnly).toBeDefined();
    expect(card).toContain("metadata-only-no-transcript");
    const metadataSection = card.slice(card.indexOf("## Metadata-only leads"));
    expect(metadataSection).toContain(metadataOnly?.id);
    expect(metadataSection).toContain("No transcript is available to quote");
  }, 20_000);

  it("rejects a lexical query with no searchable terms before writing", async () => {
    const output = await temporaryCardPath();
    const result = runCard({ query: "the, and!", output });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("searchable term");
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("discloses partial matches using unique normalized query terms", async () => {
    const output = await temporaryCardPath();
    const result = runCard({
      query: "vampire vampire space station",
      output,
    });
    expect(result.status, result.stderr).toBe(0);

    const card = await readFile(output, "utf8");
    expect(card).toContain("1/3 normalized query terms");
    expect(card).toContain("not motif classifications");
    expect(card).not.toContain("confirmed attestation");
  }, 20_000);

  it("writes an honest card when a valid lexical query returns no candidates", async () => {
    const output = await temporaryCardPath();
    const result = runCard({ query: "zzxqvnonexistentmotifterm", output });
    expect(result.status, result.stderr).toBe(0);

    const card = await readFile(output, "utf8");
    expect(card).toContain("No lexical candidates were found.");
    expect(card).toContain("does not establish that the motif is absent");
    expect(card).not.toContain("### 1.");
    expect(card).not.toContain("no attestation");
  }, 20_000);

  it("rejects control characters that could alter the Markdown structure", async () => {
    const output = await temporaryCardPath();
    const result = runCard({
      motif: "Owner label\n# Agent-selected heading",
      query: "forest signal",
      output,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("control characters");
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
