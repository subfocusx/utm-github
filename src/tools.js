/**
 * GitHub tool handlers + parameter schemas.
 *
 * Thin layer over the GitHub REST API (src/client.js). The Cordis adapter
 * (index.js) binds these through defineTool and handles error surfacing.
 *
 * Tools (all prefixed github_):
 *   github_user            — current authenticated user (or /users/{login} if given)
 *   github_repo_get        — repository metadata
 *   github_repo_search     — search repositories (web index)
 *   github_repo_create     — create a repository under the authenticated user
 *   github_repo_delete     — delete a repository (needs confirm=true)
 *   github_repo_topics     — set repository topics
 *   github_file_put        — create or update one file via the Contents API
 *   github_issue_create    — open an issue
 *   github_issue_close     — close an issue
 *   github_gist_create     — create a gist
 *   github_gist_delete     — delete a gist
 *   github_release_create  — create a release
 */

import { githubRequest, resolveToken } from './client.js'

function slug(value, label) {
  const s = String(value ?? '').trim().replace(/^https?:\/\/(www\.)?github\.com\//, '')
  const parts = s.split('/').filter(Boolean)
  const owner = parts[0]
  const repo = (parts[1] ?? '').replace(/\.git$/i, '')
  if (!owner || !repo) throw new Error(`${label}: нужен формат "owner/repo" или "owner/repo" из URL`)
  return { owner, repo }
}

/** Compact repo shape used in outputs. */
function repoOut(r) {
  return {
    id: r?.id ?? null,
    name: r?.name ?? null,
    full_name: r?.full_name ?? null,
    owner: r?.owner?.login ?? null,
    private: r?.private ?? false,
    html_url: r?.html_url ?? null,
    description: r?.description ?? null,
    default_branch: r?.default_branch ?? null,
    topics: r?.topics ?? null,
    updated_at: r?.updated_at ?? null,
    pushed_at: r?.pushed_at ?? null,
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function user(config, args) {
  const login = args?.login?.trim()
  const hasToken = Boolean(resolveToken(config))
  const ep = hasToken && !login ? '/user' : login ? `/users/${encodeURIComponent(login)}` : '/user'
  const data = await githubRequest(config, 'GET', ep)
  return {
    login: data?.login ?? null,
    name: data?.name ?? null,
    html_url: data?.html_url ?? null,
    avatar_url: data?.avatar_url ?? null,
    public_repos: data?.public_repos ?? null,
    created_at: data?.created_at ?? null,
  }
}

async function repoGet(config, args) {
  const { owner, repo } = slug(args.slug, 'github_repo_get')
  return repoOut(await githubRequest(config, 'GET', `/repos/${owner}/${repo}`))
}

async function repoSearch(config, args) {
  const q = String(args.query ?? '').trim()
  if (!q) throw new Error('query: параметр поиска (например "utm-gsheets user:subfocusx")')
  const data = await githubRequest(config, 'GET', '/search/repositories', {
    query: { q, per_page: Number(args.limit ?? 10), sort: args.sort ?? 'best-match' },
  })
  return {
    total: data?.total_count ?? 0,
    items: (data?.items ?? []).map(repoOut),
  }
}

async function repoCreate(config, args) {
  const name = String(args.name ?? '').trim()
  if (!name) throw new Error('name: имя репозитория обязательно')
  const body = { name }
  if (args.description != null) body.description = String(args.description)
  if (args.homepage) body.homepage = String(args.homepage)
  if (args.private != null) body.private = Boolean(args.private)
  if (args.has_issues != null) body.has_issues = Boolean(args.has_issues)
  if (args.has_wiki != null) body.has_wiki = Boolean(args.has_wiki)
  if (args.auto_init != null) body.auto_init = Boolean(args.auto_init)
  const data = await githubRequest(config, 'POST', '/user/repos', { body })
  return repoOut(data)
}

async function repoDelete(config, args) {
  const { owner, repo } = slug(args.slug, 'github_repo_delete')
  if (args.confirm !== true) {
    throw new Error('confirm: установите confirm=true — удаление репозитория необратимо')
  }
  await githubRequest(config, 'DELETE', `/repos/${owner}/${repo}`)
  return { owner, repo, deleted: true }
}

async function repoTopics(config, args) {
  const { owner, repo } = slug(args.slug, 'github_repo_topics')
  const names = Array.isArray(args.topics) ? args.topics.map(String) : []
  const data = await githubRequest(config, 'PUT', `/repos/${owner}/${repo}/topics`, { body: { names } })
  return { owner, repo, topics: Array.isArray(data) ? data : names }
}

async function filePut(config, args) {
  const { owner, repo } = slug(args.slug, 'github_file_put')
  const path = String(args.path ?? '').trim().replace(/^\/+/, '')
  if (!path) throw new Error('path: путь в репозитории, например "README.md"')

  const body = {
    message: args.message ?? `Update ${path}`,
    content: Buffer.from(String(args.content ?? ''), 'utf8').toString('base64'),
  }
  if (args.branch) body.branch = args.branch
  if (args.sha) body.sha = args.sha
  if (args.committer) body.committer = args.committer

  const data = await githubRequest(config, 'PUT', `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, { body })
  return {
    owner, repo, path,
    committed: Boolean(data?.commit),
    sha: data?.commit?.sha ?? data?.content?.sha ?? null,
    branch: body.branch ?? null,
  }
}

async function issueCreate(config, args) {
  const { owner, repo } = slug(args.slug, 'github_issue_create')
  const title = String(args.title ?? '').trim()
  if (!title) throw new Error('title: заголовок issue обязателен')
  const body = { title }
  if (args.body) body.body = String(args.body)
  if (args.labels?.length) body.labels = args.labels.map(String)
  if (args.assignees?.length) body.assignees = args.assignees.map(String)
  const data = await githubRequest(config, 'POST', `/repos/${owner}/${repo}/issues`, { body })
  return { number: data?.number ?? null, title: data?.title ?? null, html_url: data?.html_url ?? null, state: data?.state ?? null }
}

async function issueClose(config, args) {
  const { owner, repo } = slug(args.slug, 'github_issue_close')
  const number = Number(args.issue_number)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('issue_number: номер issue обязателен')
  }
  const data = await githubRequest(config, 'PATCH', `/repos/${owner}/${repo}/issues/${number}`, {
    body: { state: 'closed' },
  })
  return { number: data?.number ?? null, title: data?.title ?? null, html_url: data?.html_url ?? null, state: data?.state ?? null }
}

async function gistCreate(config, args) {
  const files = {}
  const fileNames = Array.isArray(args.files) ? args.files : [args.file].filter(Boolean)
  if (typeof args.file === 'string') {
    const name = String(args.file_name ?? 'file.txt')
    files[name] = { content: String(args.content ?? '') }
  } else {
    for (const f of fileNames) {
      if (!f || typeof f !== 'object') continue
      const name = String(f?.name ?? 'file.txt')
      files[name] = { content: String(f?.content ?? '') }
    }
  }
  if (!Object.keys(files).length) throw new Error('file или files: передайте содержимое')
  const data = await githubRequest(config, 'POST', '/gists', {
    body: { files, description: args.description ?? null, public: Boolean(args.public) },
  })
  return { id: data?.id ?? null, html_url: data?.html_url ?? null, files: Object.keys(data?.files ?? files) }
}

async function gistDelete(config, args) {
  const id = String(args.gist_id ?? '').trim()
  if (!id) throw new Error('gist_id: ID gist (например из github_gist_create)')
  await githubRequest(config, 'DELETE', `/gists/${encodeURIComponent(id)}`)
  return { gist_id: id, deleted: true }
}

async function releaseCreate(config, args) {
  const { owner, repo } = slug(args.slug, 'github_release_create')
  const tag = String(args.tag_name ?? '').trim()
  if (!tag) throw new Error('tag_name: тег релиза (например "v0.1.0")')
  const body = { tag_name: tag }
  if (args.name) body.name = String(args.name)
  if (args.target_commitish) body.target_commitish = String(args.target_commitish)
  if (args.body) body.body = String(args.body)
  if (args.draft != null) body.draft = Boolean(args.draft)
  if (args.prerelease != null) body.prerelease = Boolean(args.prerelease)
  const data = await githubRequest(config, 'POST', `/repos/${owner}/${repo}/releases`, { body })
  return { id: data?.id ?? null, tag_name: data?.tag_name ?? null, html_url: data?.html_url ?? null, draft: data?.draft ?? null }
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function buildTools(makeConfig) {
  return [
    {
      name: 'github_user',
      description: 'Текущий авторизованный пользователь GitHub (или профиль по login). Read-only.',
      parameters: {
        login: { type: 'string', description: 'Логин пользователя. Пусто — свой профиль по токену.' },
      },
      handler: async (args) => {
        const config = makeConfig()
        return user(config, args)
      },
    },
    {
      name: 'github_repo_get',
      description: 'Метаданные репозитория GitHub. Принимает slug "owner/repo" или полный URL. Read-only.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL вида https://github.com/owner/repo.' },
      },
      handler: async (args) => repoGet(makeConfig(), args),
    },
    {
      name: 'github_repo_search',
      description: 'Поиск репозиториев по индексу (web). query в формате GitHub, например "user:subfocusx topic:plugin". Read-only.',
      parameters: {
        query: { type: 'string', required: true, description: 'Строка поиска в формате GitHub.' },
        limit: { type: 'integer', description: 'Максимум результатов (по умолчанию 10).' },
        sort: { type: 'string', description: 'best-match | stars | forks | updated (по умолчанию best-match).' },
      },
      handler: async (args) => repoSearch(makeConfig(), args),
    },
    {
      name: 'github_repo_create',
      description: 'Создать репозиторий под авторизованным пользователем (POST /user/repos).',
      parameters: {
        name: { type: 'string', required: true, description: 'Имя репозитория.' },
        description: { type: 'string', description: 'Описание.' },
        homepage: { type: 'string', description: 'Сайт / homepage.' },
        private: { type: 'boolean', description: 'Приватный? (по умолчанию false).' },
        has_issues: { type: 'boolean', description: 'Включить Issues (по умолчанию true).' },
        has_wiki: { type: 'boolean', description: 'Включить Wiki.' },
        auto_init: { type: 'boolean', description: 'Создать с README (по умолчанию false).' },
      },
      handler: async (args) => repoCreate(makeConfig(), args),
    },
    {
      name: 'github_repo_delete',
      description: 'Удалить репозиторий (DELETE /repos/{owner}/{repo}). НЕОБРАТИМО — требует confirm=true.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        confirm: { type: 'boolean', required: true, description: 'true для подтверждения удаления.' },
      },
      handler: async (args) => repoDelete(makeConfig(), args),
    },
    {
      name: 'github_repo_topics',
      description: 'Задать список topics репозитория (PUT /repos/{owner}/{repo}/topics). Полностью заменяет текущий список.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        topics: { type: 'array', required: true, description: 'Массив имён topics, например ["plugin","js"].', items: { type: 'string' } },
      },
      handler: async (args) => repoTopics(makeConfig(), args),
    },
    {
      name: 'github_file_put',
      description: 'Создать или обновить один файл в репозитории через Contents API (PUT /repos/{owner}/{repo}/contents/{path}). Полезно для быстрого коммита без локального git.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        path: { type: 'string', required: true, description: 'Путь к файлу в репозитории, например "README.md".' },
        content: { type: 'string', required: true, description: 'Новое содержимое файла (UTF-8).' },
        message: { type: 'string', description: 'Сообщение коммита (по умолчанию "Update <path>").' },
        branch: { type: 'string', description: 'Ветка. Пусто — default branch.' },
        sha: { type: 'string', description: 'SHA текущего содержимого файла. Для обновления существующего файла обязателен.' },
        committer: { type: 'object', additionalProperties: true, description: 'Опциональные {name, email} для коммита.' },
      },
      handler: async (args) => filePut(makeConfig(), args),
    },
    {
      name: 'github_issue_create',
      description: 'Открыть issue в репозитории.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        title: { type: 'string', required: true, description: 'Заголовок issue.' },
        body: { type: 'string', description: 'Текст issue (Markdown).' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Метки.' },
        assignees: { type: 'array', items: { type: 'string' }, description: 'Логины исполнителей.' },
      },
      handler: async (args) => issueCreate(makeConfig(), args),
    },
    {
      name: 'github_issue_close',
      description: 'Закрыть issue в репозитории (PATCH state=closed).',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        issue_number: { type: 'integer', required: true, description: 'Номер issue (не id, а number).' },
      },
      handler: async (args) => issueClose(makeConfig(), args),
    },
    {
      name: 'github_gist_create',
      description: 'Создать gist: либо {file, file_name, content}, либо массив {name, content} в files.',
      parameters: {
        file: { type: 'object', additionalProperties: true, description: 'Один файл {name?, content} (или {name, content}).' },
        file_name: { type: 'string', description: 'Имя файла для варианта с одним файлом.' },
        content: { type: 'string', description: 'Содержимое для варианта с одним файлом.' },
        files: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Несколько файлов: [{name, content}].' },
        description: { type: 'string', description: 'Описание gist.' },
        public: { type: 'boolean', description: 'Публичный? (по умолчанию false).' },
      },
      handler: async (args) => gistCreate(makeConfig(), args),
    },
    {
      name: 'github_gist_delete',
      description: 'Удалить gist по ID (DELETE /gists/{gist_id}).',
      parameters: {
        gist_id: { type: 'string', required: true, description: 'ID gist.' },
      },
      handler: async (args) => gistDelete(makeConfig(), args),
    },
    {
      name: 'github_release_create',
      description: 'Создать релиз с тегом.',
      parameters: {
        slug: { type: 'string', required: true, description: 'owner/repo или URL.' },
        tag_name: { type: 'string', required: true, description: 'Имя тега, например "v0.1.0".' },
        name: { type: 'string', description: 'Название релиза. По умолчанию == tag_name.' },
        target_commitish: { type: 'string', description: 'Ветка или SHA (по умолчанию default branch).' },
        body: { type: 'string', description: 'Описание релиза (Markdown).' },
        draft: { type: 'boolean', description: 'Черновик?' },
        prerelease: { type: 'boolean', description: 'Пререлиз?' },
      },
      handler: async (args) => releaseCreate(makeConfig(), args),
    },
  ]
}