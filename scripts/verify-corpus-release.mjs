import path from "node:path";

import {
  hasActiveCorpusReleaseLock,
  loadVerifiedCorpusRelease,
  verifyCachedCorpusRelease,
} from "../src/corpus-release.mjs";

const lockPath = path.resolve("corpus-release.lock.json");
const hasActiveLock = await hasActiveCorpusReleaseLock(lockPath);
const release = hasActiveLock
  ? await verifyCachedCorpusRelease({ lockPath })
  : await loadVerifiedCorpusRelease();
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
