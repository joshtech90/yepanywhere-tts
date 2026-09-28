import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Leaf name every legacy location shares, before its instance digest. */
const LEGACY_LEAF = "speech-vocabulary";

function instanceSuffix(dataDir: string): string {
  return createHash("sha256").update(dataDir).digest("hex").slice(0, 12);
}

/**
 * Legacy speech vocabulary directories outside the data directory: the places
 * an earlier YA could have kept this data directory's vocabulary table and
 * seen-filter, which `VocabularyStore` probes once to adopt them. In the order
 * those versions preferred: the `YEP_SCRATCH_DIR` override, the cache home,
 * the temporary directory, then `<dataDir>/speech-vocabulary`. Every leaf but
 * the last carries a digest of the data directory, so two instances sharing a
 * root are told apart. Naming a directory never creates it.
 */
export function legacySpeechVocabularyDirectories(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const leaf = `${LEGACY_LEAF}-${instanceSuffix(dataDir)}`;
  const override = env.YEP_SCRATCH_DIR?.trim();
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
  return [
    ...(override ? [join(override, leaf)] : []),
    join(cacheHome, "yep-anywhere", leaf),
    join(tmpdir(), "yep-anywhere", leaf),
    join(dataDir, LEGACY_LEAF),
  ];
}
