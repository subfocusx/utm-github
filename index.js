/**
 * utm-github — Cordis plugin for DeepSeek Harness.
 *
 * Registers the github_* tool family (user, repo get/search/topics, file put,
 * issues, gists, releases) as a thin layer over the GitHub REST API.
 *
 * The token is never in the repo: it is supplied at deploy time via
 * config.token, config.token_path (a file path) or the GITHUB_TOKEN env var.
 * No machine-specific paths or credentials are hardcoded.
 *
 * Install: `pnpm add "file:<plugins-dir>/github"` in the dsh profile, and add
 * to `cordis.patch.yml` — MUST be an insert list:
 *
 *   - insert:
 *       - id: utm-github
 *         name: utm-github
 *         config:
 *           token_path: "<путь-к-файлу-с-токеном>"
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildConfig } from './src/config.js'
import { buildTools } from './src/tools.js'

export const name = 'utm-github'
export const inject = ['tools']

/** Permissive output schema: our tools return heterogeneous result objects. */
const OUTPUT_SCHEMA = { type: 'object', additionalProperties: true }

const MAX_RENDER_CHARS = 30_000

function renderResult(_args, value) {
  if (value && typeof value.ok === 'boolean' && value.ok === false) {
    return [{ type: 'text', text: `github error: ${value.error}` }]
  }
  let json
  try {
    json = JSON.stringify(value, null, 2)
  } catch {
    json = String(value)
  }
  if (json.length > MAX_RENDER_CHARS) {
    json = json.slice(0, MAX_RENDER_CHARS) + '\n… (truncated)'
  }
  return [{ type: 'text', text: json }]
}

/** Plugin entry point: register one tool per definition. */
export function apply(ctx, config = {}) {
  const cfg = buildConfig(config)
  for (const def of buildTools(() => cfg)) {
    ctx.tools.register(defineTool({
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      output: { schema: OUTPUT_SCHEMA, render: renderResult },
      execute: async (args) => {
        try {
          return await def.handler(args ?? {})
        } catch (e) {
          return { ok: false, error: e?.message ?? String(e) }
        }
      },
    }))
  }
}