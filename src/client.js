/**
 * Minimal GitHub REST client — plain fetch over https://api.github.com.
 * Reads the token from config at request time (file or inline/env).
 */

import { readFileSync } from 'node:fs'
import { buildConfig } from './config.js'

export const GITHUB_API = 'https://api.github.com'

/** Resolve the raw token value from the merged plugin config. */
export function resolveToken(config = {}) {
  const cfg = buildConfig(config)
  if (cfg.token) return cfg.token
  if (cfg.token_path) {
    const blob = readFileSync(cfg.token_path, 'utf8')
    return blob.trim()
  }
  return null
}

/** One authenticated/plain REST request. Throws on HTTP errors. */
export async function githubRequest(config, method, path, { body, query, raw } = {}) {
  const token = resolveToken(config)
  const url = new URL(`${GITHUB_API}${path}`)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))

  const headers = raw
    ? {}
    : {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j?.message ?? JSON.stringify(j).slice(0, 400)
    } catch {
      detail = (await res.text()).slice(0, 400)
    }
    throw new Error(`github ${method} ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return null
  const data = res.headers.get('content-type')?.startsWith('application/json')
    ? await res.json()
    : raw
      ? { _body: await res.text() }
      : await res.text()
  return data
}