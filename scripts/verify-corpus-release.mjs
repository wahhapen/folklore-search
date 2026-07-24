import { loadVerifiedCorpusRelease } from "./lib/corpus-release.mjs";

const release = await loadVerifiedCorpusRelease();
console.log(
  JSON.stringify(
    {
      ...release.identity,
      artifactCount: release.manifest.artifacts.length,
      root: release.root,
    },
    null,
    2,
  ),
);
