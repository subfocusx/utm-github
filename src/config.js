/**
 * Plugin config: where the GitHub token lives.
 *
 * The token itself is NOT in the repo. It is supplied at deploy time in three
 * ways (checked in order):
 *   - config.token_path — a PATH to a file containing the raw token (no
 *     machine-specific paths hardcoded; the path is set in cordis.patch.yml)
 *   - config.token      — the token value inline
 *   - GITHUB_TOKEN env  — environment variable fallback
 * No credential material and no real machine paths are ever committed.
 */

/** Merge raw plugin config with process.env fallbacks. */
export function buildConfig(config = {}) {
  const c = config ?? {}
  return {
    token: c.token || process.env.GITHUB_TOKEN || null,
    token_path: c.token_path || process.env.GITHUB_TOKEN_PATH || null,
  }
}