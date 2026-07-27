import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadCorpusSearchGateway } from "folklore-search";
import { createCorpusReleaseFixture } from "./fixtures/corpus-release.js";

describe("verified Corpus search gateway", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  async function loadFixture(
    fixture: ReturnType<typeof createCorpusReleaseFixture>,
    version = "0.3.0",
  ) {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end(fixture.archive);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a port");
    }

    const root = await mkdtemp(join(tmpdir(), "folklore-gateway-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const lockPath = join(root, "corpus-release.lock.json");
    await writeFile(
      lockPath,
      `${JSON.stringify(
        fixture.lock(
          `http://127.0.0.1:${address.port}/folklore-corpus-v${version}.tar.gz`,
        ),
        null,
        2,
      )}\n`,
    );

    return {
      load: () =>
        loadCorpusSearchGateway({
          lockPath,
          cacheRoot: join(root, "cache"),
        }),
      requestCount: () => requests,
    };
  }

  it("installs v0.3 and exposes searchable evidence with rights and translation provenance", async () => {
    const fixture = createCorpusReleaseFixture({
      version: "0.3.0",
      records: {
        "representations.jsonl":
          '{"schemaVersion":"folklore-representation-v1","id":"fa:representation:source","witnessId":"fa:witness:test","kind":"text","language":"fi"}\n{"schemaVersion":"folklore-representation-v1","id":"fa:representation:translated","witnessId":"fa:witness:test","kind":"text","language":"en"}\n',
        "derivations.jsonl":
          '{"schemaVersion":"folklore-derivation-v1","id":"fa:derivation:translation","type":"translation","inputIds":["fa:representation:source"],"outputIds":["fa:representation:translated"]}\n',
        "translations.jsonl":
          '{"schemaVersion":"folklore-translation-v1","id":"fa:translation:test","translationRepresentationId":"fa:representation:translated","sourceRepresentationId":"fa:representation:source","producerClass":"expert-produced","reviewStatus":"accepted","reviewedById":"fa:agent:reviewer","reviewEvidenceArtifactId":null}\n',
        "rights.jsonl":
          '{"schemaVersion":"folklore-rights-assessment-v2","id":"fa:rights:test","subjectId":"fa:witness:test","quotationAllowed":true,"accessPrivateUseAllowed":true,"mlEvaluationAllowed":true,"mlTrainingAllowed":false,"redistributionAllowed":true,"derivativesAllowed":true,"reviewState":"accepted"}\n',
      },
    });
    const consumer = await loadFixture(fixture);
    const gateway = await consumer.load();

    expect(consumer.requestCount()).toBe(1);
    expect(gateway.release.version).toBe("0.3.0");
    expect(gateway.records.rightsAssessments).toEqual([
      expect.objectContaining({
        schemaVersion: "folklore-rights-assessment-v2",
        mlTrainingAllowed: false,
      }),
    ]);
    expect(gateway.records.translations).toEqual([
      expect.objectContaining({
        sourceRepresentationId: "fa:representation:source",
        reviewStatus: "accepted",
      }),
    ]);
    expect(Object.isFrozen(gateway.manifest)).toBe(true);
    expect(Object.isFrozen(gateway.records.rightsAssessments)).toBe(true);
    expect(Object.isFrozen(gateway.records.rightsAssessments[0])).toBe(true);
    expect(() =>
      Object.assign(gateway.records.rightsAssessments[0], {
        mlTrainingAllowed: true,
      }),
    ).toThrow(TypeError);
    expect(gateway.index.search("test")[0]).toMatchObject({
      id: "fa:passage:test",
      citationLabel: "Test, passage 1",
      explanation: {
        matchedQueryTerms: ["test"],
      },
    });
  });

  it("rejects malformed rights records before exposing gateway data", async () => {
    const fixture = createCorpusReleaseFixture({
      version: "0.3.0",
      records: {
        "representations.jsonl": "",
        "derivations.jsonl": "",
        "translations.jsonl": "",
        "rights.jsonl":
          '{"schemaVersion":"folklore-rights-assessment-v2","subjectId":"fa:witness:test"}\n',
      },
    });
    const consumer = await loadFixture(fixture);

    await expect(consumer.load()).rejects.toThrow(
      "Corpus record schema mismatch: rights.jsonl:1",
    );
  });

  it("rejects orphan translation provenance before exposing gateway data", async () => {
    const fixture = createCorpusReleaseFixture({
      version: "0.3.0",
      records: {
        "representations.jsonl":
          '{"schemaVersion":"folklore-representation-v1","id":"fa:representation:translated","witnessId":"fa:witness:test","kind":"text","language":"en"}\n',
        "derivations.jsonl":
          '{"schemaVersion":"folklore-derivation-v1","id":"fa:derivation:translation","type":"translation","inputIds":["fa:representation:source"],"outputIds":["fa:representation:translated"]}\n',
        "translations.jsonl":
          '{"schemaVersion":"folklore-translation-v1","id":"fa:translation:test","translationRepresentationId":"fa:representation:translated","sourceRepresentationId":"fa:representation:source","producerClass":"expert-produced","reviewStatus":"unreviewed","reviewedById":null,"reviewEvidenceArtifactId":null}\n',
        "rights.jsonl": "",
      },
    });
    const consumer = await loadFixture(fixture);

    await expect(consumer.load()).rejects.toThrow(
      "Corpus translation provenance mismatch: fa:translation:test (missing-source-representation)",
    );
  });

  it("rejects a verified release outside the v0.3 gateway contract", async () => {
    const fixture = createCorpusReleaseFixture({
      records: {
        "representations.jsonl": "",
        "derivations.jsonl": "",
        "translations.jsonl": "",
        "rights.jsonl": "",
      },
    });
    const consumer = await loadFixture(fixture, "0.2.0");

    await expect(consumer.load()).rejects.toThrow(
      "Corpus search gateway requires v0.3.0; received 0.2.0",
    );
  });

  it("rejects v0.3 when a gateway record set is absent", async () => {
    const fixture = createCorpusReleaseFixture({
      version: "0.3.0",
      records: {
        "representations.jsonl": "",
        "derivations.jsonl": "",
        "translations.jsonl": "",
      },
    });
    const consumer = await loadFixture(fixture);

    await expect(consumer.load()).rejects.toThrow(
      "Corpus v0.3.0 is missing gateway records: rightsAssessments",
    );
  });
});
