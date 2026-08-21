/**
 * Offline tests for the utm-github plugin. Pure Node — no DSH runtime, no live
 * GitHub API. Stubs globalThis.fetch and covers:
 *   - resolveToken: config.token / token_path (file) / env precedence
 *   - githubRequest: URL building, auth header, JSON body, error surfacing
 *   - buildTools: catalogue shape + slug parsing via mocked handlee
 * Run: node test/run-tests.mjs
 */

import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildConfig } from '../src/config.js'
import { githubRequest, resolveToken } from '../src/client.js'
import { buildTools } from '../src/tools.js'

let passed = 0
let failed = 0
const failures = []

function ok(label, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✅ ${label}`)
  } else {
    failed++
    failures.push(label + (extra ? ` — ${extra}` : ''))
    console.log(`  ❌ ${label} ${extra}`)
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  ok(label, a === e, `got ${a}, expected ${e}`)
}

// ---------------------------------------------------------------------------
// buildConfig
// ---------------------------------------------------------------------------
console.log('\n— buildConfig:')
eq('empty config', buildConfig({}), { token: null, token_path: null })
eq('inline token', buildConfig({ token: 'tok-abc' }), { token: 'tok-abc', token_path: null })
eq('token path', buildConfig({ token_path: '/tmp/t' }), { token: null, token_path: '/tmp/t' })
eq('both: token wins surface', buildConfig({ token: 'a', token_path: '/b' }), { token: 'a', token_path: '/b' })

// ---------------------------------------------------------------------------
// resolveToken precedence + file read
// ---------------------------------------------------------------------------
console.log('\n— resolveToken:')
{
  const tmp = join(tmpdir(), `utm-github-tok-${Date.now()}.txt`)
  writeFileSync(tmp, 'file-token\n', 'utf8')
  eq('reads token from file path', resolveToken({ token_path: tmp }), 'file-token')
  eq('inline token beats file', resolveToken({ token: 'inline-token', token_path: tmp }), 'inline-token')
  unlinkSync(tmp)

  const prev = process.env.GITHUB_TOKEN
  process.env.GITHUB_TOKEN = 'env-token'
  ok('falls back to env', resolveToken({}) === 'env-token')
  ok('inline beats env', resolveToken({ token: 'inline-token' }) === 'inline-token')
  if (prev === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = prev
}

// ---------------------------------------------------------------------------
// githubRequest via stub fetch
// ---------------------------------------------------------------------------
console.log('\n— githubRequest:')
{
  let captured = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init }
    return new Response(JSON.stringify({ login: 'subfocusx', public_repos: 7 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const data = await githubRequest({ token: 'SECRET' }, 'GET', '/user')
    eq('returns parsed json', data.login, 'subfocusx')
    ok('auth header injected', captured.init.headers.Authorization === 'Bearer SECRET')
    ok('accept header', /vnd\.github\+json/.test(captured.init.headers.Accept))
    ok('api version header', captured.init.headers['X-GitHub-Api-Version'] === '2022-11-28')
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log('\n— githubRequest query + body + errors:')
{
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/search/repositories?q=')) {
      return new Response(JSON.stringify({ total_count: 1, items: [{ id: 1, name: 'x' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (String(url).includes('/repos/') && init.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const data = await githubRequest({ token: 't' }, 'GET', '/search/repositories', {
      query: { q: 'user:subfocusx', per_page: '5' },
    })
    ok('query string built', data.total_count === 1)
    const put = await githubRequest({}, 'PUT', '/repos/o/r/topics', { body: { names: ['a'] } })
    ok('PUT body ok', put.ok === true)
    let err
    try { await githubRequest({}, 'GET', '/repos/o/nope') } catch (e) { err = e }
    ok('404 surfaces message', err && /HTTP 404/.test(err.message) && /Not Found/.test(err.message))
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log('\n— githubRequest retries:')
{
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async (url) => {
    attempts++
    // Two 500s, then success — verifies backoff retry.
    if (attempts <= 2) {
      return new Response('oops', { status: 503, headers: { 'content-type': 'text/plain' } })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const data = await githubRequest({ token: 't' }, 'GET', '/user', { retries: 2 })
    ok('retries 5xx until success', attempts === 3 && data.ok === true)
  } finally {
    globalThis.fetch = originalFetch
  }

  attempts = 0
  globalThis.fetch = async () => {
    attempts++
    return new Response(JSON.stringify({ message: 'Nope' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
  }
  let err
  try {
    await githubRequest({}, 'GET', '/repos/o/nope', { retries: 2 })
  } catch (e) {
    err = e
  }
  ok('does not retry 4xx', attempts === 1 && /HTTP 404/.test(err.message))
  globalThis.fetch = originalFetch
}

// ---------------------------------------------------------------------------
// buildTools catalogue shape
// ---------------------------------------------------------------------------
console.log('\n— buildTools catalogue:')
{
  const tools = buildTools(() => ({ token: 't' }))
  const names = tools.map((t) => t.name)
  const expected = [
    'github_user',
    'github_repo_get',
    'github_repo_search',
    'github_repo_create',
    'github_repo_delete',
    'github_repo_topics',
    'github_file_put',
    'github_issue_create',
    'github_issue_close',
    'github_gist_create',
    'github_gist_delete',
    'github_release_create',
  ]
  eq('tool names', names, expected)
  for (const t of tools) {
    ok(`${t.name} has description`, typeof t.description === 'string' && t.description.length > 0)
    ok(`${t.name} has parameters`, t.parameters && typeof t.parameters === 'object')
    ok(`${t.name} has handler fn`, typeof t.handler === 'function')
  }
  for (const [name, req] of [
    ['github_repo_get', 'slug'],
    ['github_repo_search', 'query'],
    ['github_repo_create', 'name'],
    ['github_repo_delete', 'slug'],
    ['github_repo_delete', 'confirm'],
    ['github_repo_topics', 'slug'],
    ['github_file_put', 'slug'],
    ['github_file_put', 'path'],
    ['github_issue_create', 'title'],
    ['github_issue_close', 'issue_number'],
    ['github_gist_delete', 'gist_id'],
    ['github_release_create', 'tag_name'],
  ]) {
    const t = tools.find((x) => x.name === name)
    ok(`${name}.${req} required`, t.parameters[req]?.required === true)
  }
}

// ---------------------------------------------------------------------------
// Handler — github_repo_get slug parsing via stub fetch
// ---------------------------------------------------------------------------
console.log('\n— handlers:')
{
  let gotPath = null
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    gotPath = new URL(String(url)).pathname
    return new Response(JSON.stringify({ id: 2, full_name: 'o/r', private: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const cfg = { token: 't' }
    const tools = buildTools(() => cfg)
    const repo = tools.find((t) => t.name === 'github_repo_get')
    const out = await repo.handler({ slug: 'https://github.com/o/r.git' })
    ok('normalizes URL + .git', gotPath === '/repos/o/r')
    ok('returns repo shape', out.full_name === 'o/r' && out.private === true && out.owner === null)
  } finally {
    globalThis.fetch = originalFetch
  }
}

console.log('\n— handlers (create/close/delete):')
{
  const cfg = { token: 't' }
  const tools = buildTools(() => cfg)

  // repo_delete guard: confirm required before DELETE.
  const del = tools.find((t) => t.name === 'github_repo_delete')
  let guardErr
  try {
    await del.handler({ slug: 'o/r' })
  } catch (e) {
    guardErr = e
  }
  ok('repo_delete refuses without confirm', /confirm/.test(guardErr?.message ?? ''))

  let calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, method: init?.method, body: JSON.parse(init?.body ?? '{}') })
    const ok = { ok: true }
    return new Response(JSON.stringify(ok), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    await del.handler({ slug: 'o/r', confirm: true })
    const delCall = calls.find((c) => c.method === 'DELETE')
    ok('repo_delete issues DELETE', calls.length === 1 && delCall?.path === '/repos/o/r')

    calls = []
    const close = tools.find((t) => t.name === 'github_issue_close')
    await close.handler({ slug: 'https://github.com/o/r', issue_number: 5 })
    const patch = calls.find((c) => c.method === 'PATCH')
    ok('issue_close PATCHes correct path+state', patch?.path === '/repos/o/r/issues/5' && patch?.body?.state === 'closed')

    calls = []
    const gdel = tools.find((t) => t.name === 'github_gist_delete')
    await gdel.handler({ gist_id: 'abc123' })
    const gdelCall = calls.find((c) => c.method === 'DELETE')
    ok('gist_delete issues DELETE', gdelCall?.path === '/gists/abc123')

    calls = []
    const create = tools.find((t) => t.name === 'github_repo_create')
    const out = await create.handler({ name: 'demo', private: true, description: 'd' })
    const post = calls.find((c) => c.method === 'POST')
    ok('repo_create POSTs /user/repos', post?.path === '/user/repos' && post?.body?.name === 'demo' && post?.body?.private === true)
    ok('repo_create returns repoOut', out.name === null)
  } finally {
    globalThis.fetch = originalFetch
  }
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  console.log('\nFailures:')
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}