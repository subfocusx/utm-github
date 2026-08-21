/**
 * Minimal GitHub REST client — plain fetch over https://api.github.com.
 * Reads the token from config at request time (file or inline/env).
 */

import { readFileSync } from 'node:fs'
import { buildConfig } from './config.js'

export const GITHUB_API = 'https://api.github.com'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** HTTP-level error; carries status so we never retry 4xx/3xx, only 5xx & network. */
export class HttpError extends Error {
  constructor(method, path, status, detail = '') {
    super(`github ${method} ${path}: HTTP ${status}${detail ? ` — ${detail}` : ''}`)
    this.method = method
    this.path = path
    this.status = status
    this.detail = detail
  }
}

async function parseHttpError(method, path, res) {
  let detail = ''
  try {
    const j = await res.json()
    detail = j?.message ?? JSON.stringify(j).slice(0, 400)
  } catch {
    try {
      detail = (await res.text()).slice(0, 400)
    } catch {
      /* no body */
    }
  }
  return new HttpError(method, path, res.status, detail)
}

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

/**
 * One authenticated/plain REST request with bounded retries.
 *
 * Retries only ON transient conditions: network errors (fetch throws) and
 * HTTP 5xx. 4xx/3xx are surfaced as HttpError immediately. `retries` is the
 * number of automatic retry attempts on top of the first try (default 2).
 * Backoff is linear: delayMs * attempt.
 */
export async function githubRequest(
  config,
  method,
  path,
  { body, query, raw, retries = 3, retryDelayMs = 600 } = {}
) {
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

  const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined

  let lastError = null
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const isLast = attempt > retries
    let res
    try {
      res = await fetch(url.toString(), { method, headers, body: payload })
    } catch (e) {
      lastError = e
      if (!isLast) {
        await sleep(retryDelayMs * attempt)
        continue
      }
      throw new Error(`github ${method} ${path}: fetch failed — ${e?.message ?? String(e)}`)
    }

    // 5xx and not last attempt -> retry with backoff.
    if (res.status >= 500 && !isLast) {
      await sleep(retryDelayMs * attempt)
      continue
    }
    if (!res.ok) throw await parseHttpError(method, path, res)
    if (res.status === 204 || res.headers.get('content-length') === '0') return null
    return res.headers.get('content-type')?.startsWith('application/json')
      ? await res.json()
      : raw
        ? { _body: await res.text() }
        : await res.text()
  }
  throw lastError ?? new Error(`github ${method} ${path}: request failed`)
}