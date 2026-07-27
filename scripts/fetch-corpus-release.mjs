import { installCorpusRelease } from "../src/corpus-release.mjs";

const unsupported = process.argv
  .slice(2)
  .filter((argument) => argument !== "--offline");
if (unsupported.length) {
  throw new Error(`Unsupported corpus:fetch argument: ${unsupported[0]}`);
}

const release = await installCorpusRelease({
  offline:
    process.argv.includes("--offline")
    || process.env.FOLKLORE_OFFLINE === "1",
});
console.log(
  JSON.stringify(
    {
      status: "verified",
      corpus: release.identity,
      root: release.root,
    },
    null,
    2,
  ),
);
