# utm-github

Cordis-плагин для DeepSeek Harness: тулы `github_*` поверх GitHub REST API (простой `fetch` к `https://api.github.com`, без Octokit и зависимостей).

## Тулы

| Инструмент | Что делает |
|---|---|
| `github_user` | свой профиль по токену или чужой по `login` |
| `github_repo_get` | метаданные репозитория (`owner/repo` или URL) |
| `github_repo_search` | поиск репозиториев по web-индексу |
| `github_repo_topics` | задать topics репозитория (PUT, полная замена) |
| `github_file_put` | создать/обновить файл через Contents API (коммит без локального git) |
| `github_issue_create` | открыть issue |
| `github_gist_create` | создать gist |
| `github_release_create` | создать релиз с тегом |

## Токен

В репо токена нет — он задаётся при деплое через конфиг плагина (`token` или `token_path`) либо env `GITHUB_TOKEN`. Порядок: `config.token` → `config.token_path` (читать файл) → `GITHUB_TOKEN`.

## Установка

В профиле DSH (`cordis.patch.yml` — именно `insert`-список):

```yaml
- insert:
    - id: utm-github
      name: utm-github
      config:
        token_path: "<путь-к-файлу-с-токеном>"
```

и пакет:

```bash
pnpm add "file:<plugins-dir>/github"
```

## Тесты

```bash
node test/run-tests.mjs
```

Документация архитектуры плагинов DSH — в корневом `README.md` в папке плагинов.