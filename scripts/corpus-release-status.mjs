import path from "node:path";

import {
  cacheEntryPath,
  hasActiveCorpusReleaseLock,
  loadVerifiedCorpusRelease,
  readCorpusReleaseLock,
  verifyCachedCorpusRelease,
} from "../src/corpus-release.mjs";

const lockPath = path.resolve("corpus-release.lock.json");
const hasActiveLock = await hasActiveCorpusReleaseLock(lockPath);
if (hasActiveLock) {
  const lock = await readCorpusReleaseLock(lockPath);
  const root = cacheEntryPath(lock);
  try {
    const release = await verifyCachedCorpusRelease({ lockPath });
    console.log(
      JSON.stringify(
        { status: "verified", corpus: release.identity, root },
        null,
        2,
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          status: "missing-or-invalid",
          corpus: {
            releaseId: lock.releaseId,
            manifestSha256: lock.manifestSha256,
          },
          root,
          error: error.message,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
} else {
  const release = await loadVerifiedCorpusRelease();
  console.log(
    JSON.stringify(
      {
        status: "legacy-vendored",
        corpus: release.identity,
        root: release.root,
        note: "No active corpus-release.lock.json; retained only for v0.1 benchmark reproducibility.",
      },
      null,
      2,
    ),
  );
}
