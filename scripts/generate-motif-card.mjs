import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { tokenize } from "../src/bm25.mjs";
import { loadCorpusSearchGateway } from "../src/index.mjs";

const usage = [
  "Usage:",
  "  node scripts/generate-motif-card.mjs --motif <label> --query <terms> --output <file.md>",
].join("\n");

function escapeMarkdownInline(value) {
  return String(value).replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function blockquote(value) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function requiredCandidateField(candidate, field) {
  const value = candidate[field];
  if (typeof value !== "string" || !value) {
    throw new Error(
      `Cannot render uncitable candidate ${candidate.id ?? "<unknown>"}: missing ${field}`,
    );
  }
  return value;
}

function candidateContext(candidate, gateway) {
  const passageId = requiredCandidateField(candidate, "id");
  const documentId = requiredCandidateField(candidate, "documentId");
  const witnessId = requiredCandidateField(candidate, "witnessId");
  const citationLabel = requiredCandidateField(candidate, "citationLabel");
  const text = requiredCandidateField(candidate, "text");
  const document = gateway.records.documents.find(({ id }) => id === documentId);
  const witness = gateway.records.witnesses.find(({ id }) => id === witnessId);
  if (!document || !witness || witness.documentId !== documentId) {
    throw new Error(`Cannot render candidate ${passageId}: broken Corpus join`);
  }
  const display = {
    title: document.title ?? candidate.title ?? documentId,
    tradition: document.representedTradition ?? "Unspecified in Corpus",
    region: document.representedRegion ?? "Unspecified in Corpus",
    language:
      witness.language ?? document.language ?? "Unspecified in Corpus",
    recordType: document.recordType ?? "Unspecified in Corpus",
    witnessKind: witness.kind ?? "Unspecified in Corpus",
    contentStatus: candidate.contentStatus ?? "text",
  };
  return {
    candidate,
    passageId,
    documentId,
    witnessId,
    citationLabel,
    text,
    document,
    display,
  };
}

function renderCitation(document) {
  const preferred = document.citation?.preferred;
  const sourceUrl = document.citation?.sourceUrl;
  if (preferred && sourceUrl) {
    return `${escapeMarkdownInline(preferred)} — <${sourceUrl}>`;
  }
  if (preferred) return escapeMarkdownInline(preferred);
  if (sourceUrl) return `<${sourceUrl}>`;
  return "Not recorded in this Corpus release";
}

function renderCandidateDetails(context, queryTermCount) {
  const {
    candidate,
    passageId,
    documentId,
    witnessId,
    citationLabel,
    document,
    display,
  } = context;
  const matchedTerms = candidate.explanation.matchedQueryTerms;
  return [
    `- Corpus labels: ${escapeMarkdownInline(display.tradition)}; ${escapeMarkdownInline(display.region)}`,
    `- Record: ${escapeMarkdownInline(display.recordType)}; witness ${escapeMarkdownInline(display.witnessKind)}; language ${escapeMarkdownInline(display.language)}`,
    `- Evidence content: ${escapeMarkdownInline(display.contentStatus)}`,
    `- Citation: ${renderCitation(document)}`,
    `- Passage record: \`${passageId}\` — ${escapeMarkdownInline(citationLabel)}`,
    `- Witness: \`${witnessId}\``,
    `- Document: \`${documentId}\``,
    `- Retrieval: matched ${matchedTerms.map((term) => `\`${escapeMarkdownInline(term)}\``).join(", ")}; ${candidate.matchedTerms}/${queryTermCount} normalized query terms; BM25F score \`${candidate.score.toFixed(6)}\``,
  ];
}

function renderMotifCard({ motif, query, gateway }) {
  const queryTerms = [...new Set(tokenize(query))];
  const candidates = gateway.index.search(query, { limit: 10 });
  const contexts = candidates.map((candidate, index) => ({
    ...candidateContext(candidate, gateway),
    rank: index + 1,
  }));
  const passageContexts = contexts.filter(
    ({ display }) => display.contentStatus !== "metadata-only-no-transcript",
  );
  const metadataOnlyContexts = contexts.filter(
    ({ display }) => display.contentStatus === "metadata-only-no-transcript",
  );
  const lines = [
    `# Motif reference: ${escapeMarkdownInline(motif)}`,
    "",
    "> Lexical retrieval candidates from the verified Corpus release. These are not motif classifications, and missing results do not establish that a tradition lacks the motif.",
    "",
    `- Lexical query: ${escapeMarkdownInline(query)}`,
    `- Corpus release: \`${gateway.release.releaseId}\` (${gateway.release.version})`,
    `- Manifest SHA-256: \`${gateway.release.manifestSha256}\``,
    `- Producer commit: \`${gateway.release.producerCommit}\``,
    "- Retrieval view: top 10 unique Documents under the production BM25F policy",
    "",
    "## Comparison",
    "",
  ];

  if (contexts.length === 0) {
    lines.push(
      "No lexical candidates were found. This does not establish that the motif is absent; lexical search can miss paraphrases, translations, and variant wording.",
      "",
    );
  } else {
    lines.push(
      "| Rank | Corpus tradition label | Region | Language | Work | Evidence content | Passage | Matched terms |",
      "| ---: | --- | --- | --- | --- | --- | --- | ---: |",
      ...contexts.map(({ candidate, passageId, display, rank }) => {
        return `| ${rank} | ${escapeMarkdownInline(display.tradition)} | ${escapeMarkdownInline(display.region)} | ${escapeMarkdownInline(display.language)} | ${escapeMarkdownInline(display.title)} | ${escapeMarkdownInline(display.contentStatus)} | \`${passageId}\` | ${candidate.matchedTerms}/${queryTerms.length} |`;
      }),
      "",
    );
  }

  lines.push("## Candidate passages", "");
  if (passageContexts.length === 0) {
    lines.push("No retrieved candidate contains Passage text to quote.", "");
  }
  for (const context of passageContexts) {
    lines.push(
      `### ${context.rank}. ${escapeMarkdownInline(context.display.title)}`,
      "",
      blockquote(context.text),
      "",
      ...renderCandidateDetails(context, queryTerms.length),
      "",
    );
  }

  if (metadataOnlyContexts.length > 0) {
    lines.push(
      "## Metadata-only leads",
      "",
      "These ranked leads contain source metadata only. No transcript is available to quote, so they are not presented as Passage evidence.",
      "",
    );
    for (const context of metadataOnlyContexts) {
      lines.push(
        `### ${context.rank}. ${escapeMarkdownInline(context.display.title)}`,
        "",
        ...renderCandidateDetails(context, queryTerms.length),
        "",
      );
    }
  }

  const candidatesWithoutLabels = contexts.filter(
    ({ document }) =>
      !document.representedTradition || !document.representedRegion,
  ).length;
  lines.push(
    "## Coverage limits",
    "",
    "- Retrieval is lexical and preserves the production ranking. It can miss paraphrases, translations, and variant wording.",
    "- Only one Passage per retrieved Document is shown. Documents outside the top 10 are not evidence of absence.",
    "- Missing Corpus tradition or region labels are reported as unspecified; none are inferred.",
    `- ${metadataOnlyContexts.length} of ${contexts.length} candidate Documents are metadata-only leads and are not quoted as Passage evidence.`,
    `- ${candidatesWithoutLabels} of ${contexts.length} candidate Documents lack a Corpus-supplied tradition or region label.`,
    "",
  );
  return lines.join("\n");
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      motif: { type: "string" },
      query: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
} catch (error) {
  console.error(`${error.message}\n\n${usage}`);
  process.exitCode = 2;
}

if (parsed) {
  const motif = parsed.values.motif?.trim();
  const query = parsed.values.query?.trim();
  const output = parsed.values.output?.trim();
  if (!motif || !query || !output) {
    console.error(usage);
    process.exitCode = 2;
  } else if ([motif, query, output].some(hasControlCharacters)) {
    console.error(`Arguments must not contain control characters.\n\n${usage}`);
    process.exitCode = 2;
  } else if (tokenize(query).length === 0) {
    console.error(`The lexical query must contain at least one searchable term.\n\n${usage}`);
    process.exitCode = 2;
  } else {
    try {
      const gateway = await loadCorpusSearchGateway();
      const markdown = renderMotifCard({ motif, query, gateway });
      const outputPath = resolve(output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, markdown, "utf8");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
