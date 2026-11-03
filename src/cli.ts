#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { categoriesDocument, errorDocument, formatSearchText, searchDocument, SCHEMA_VERSION, sourceInfo } from './output.ts'
import { createSearcher, DEFAULT_LIMIT, MAX_LIMIT } from './search.ts'
import { readServerInfo } from './discovery.ts'
import { startServer } from './server.ts'
import { cacheHome, loadSnapshot } from './snapshot.ts'
import { SyncError, syncSnapshot } from './sync.ts'
import { InputError } from './types.ts'

class UsageError extends Error {}
class NotRunningError extends Error {}

const version = (): string => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
  } catch {
    return '0.0.0'
  }
}

const MAIN_HELP = `public-apis-index - offline search over the public-apis/public-apis list

Usage:
  public-apis-index search <query...> [options]   search APIs (never uses the network)
  public-apis-index categories [--json]           list categories with counts
  public-apis-index info [--json]                 show which snapshot is loaded
  public-apis-index sync [options]                refresh the local snapshot (the only command that fetches)
  public-apis-index serve [options]               run a local HTTP search server (for agents using curl)
  public-apis-index url [--json]                  print the URL of the running serve process
  public-apis-index --version | --help

Run "public-apis-index <command> --help" for command options.
`

const SEARCH_HELP = `Usage: public-apis-index search <query...> [options]

Search the local snapshot. Chinese and mixed queries are supported (e.g. 天气, "免费 weather api").

Options:
  --limit <n>        number of results, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}
  --category <name>  only this category (name, slug, or Chinese alias); with no query lists the category
  --auth <kind>      none | apikey | oauth | other
  --https            only APIs served over HTTPS (--no-https for the opposite)
  --cors <value>     yes | no | unknown
  --json             print one JSON document on stdout:
                     { ok, schema_version, query, terms, total, notes, items[], source }
  -h, --help         show this help
`

const SYNC_HELP = `Usage: public-apis-index sync [options]

Download the current README from GitHub and rebuild the local snapshot cache
($PUBLIC_APIS_INDEX_HOME or ~/.cache/public-apis-index). Search never does this by itself.

Options:
  --force            re-download even if the upstream commit is unchanged
  --from <path>      read a README.md file or a cloned repo directory instead of the network
  --url <url>        raw README URL (for mirrors); default raw.githubusercontent.com/public-apis/public-apis/master/README.md
  --json             print one JSON document on stdout
  -h, --help         show this help

Behind an HTTP proxy, Node 24 needs NODE_USE_ENV_PROXY=1 (with HTTPS_PROXY set).
`

const SERVE_HELP = `Usage: public-apis-index serve [options]

Endpoints: GET / (agent guide)  GET /search?q=&limit=&category=&auth=&keyless=&https=&cors=&format=text|json&pretty=1
           GET /api/<id>  GET /categories  GET /health  POST /sync (--allow-sync only)
Writes server.json ({url,pid,startedAt}) into the cache dir; "public-apis-index url" reads it.

Options:
  --port <n>         default 8787 (0 = pick a free port)
  --host <addr>      default 127.0.0.1
  --refresh <hours>  sync in the background now and then every <hours>; failures keep the old index
  --allow-sync       enable POST /sync
  -h, --help         show this help
`

const INFO_HELP = 'Usage: public-apis-index info [--json]\n\nShow the loaded snapshot (cache or bundled), its source commit, fetch time and entry count.\n'
const CATEGORIES_HELP = 'Usage: public-apis-index categories [--json]\n\nList categories with slug, Chinese alias and entry count.\n'

function parse<T extends Record<string, { type: 'string' | 'boolean'; short?: string }>>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message.replace(/\. To specify a positional.*$/, '') : String(error))
  }
}

function out(text: string): void {
  process.stdout.write(text)
}

function printJson(doc: unknown): void {
  out(JSON.stringify(doc, null, 2) + '\n')
}

async function main(argv: string[]): Promise<void> {
  const json = argv.includes('--json')
  try {
    await dispatch(argv, json)
  } catch (error) {
    let code = 'error'
    let exit = 1
    let message = error instanceof Error ? error.message : String(error)
    if (error instanceof UsageError) { code = 'usage'; exit = 2 }
    else if (error instanceof NotRunningError) code = 'not_running'
    else if (error instanceof InputError) { code = error.code; exit = 2 }
    else if (error instanceof SyncError) { code = error.code; exit = error.code === 'bad_argument' ? 2 : 1 }
    process.exitCode = exit
    if (json) printJson(errorDocument(code, message))
    else process.stderr.write(`error: ${message}\n${exit === 2 ? 'Run "public-apis-index --help" for usage.\n' : ''}`)
  }
}

async function dispatch(argv: string[], json: boolean): Promise<void> {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    if (command === undefined && json) throw new UsageError('missing command')
    out(MAIN_HELP)
    return
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    out(version() + '\n')
    return
  }
  const wantsHelp = rest.includes('--help') || rest.includes('-h')
  switch (command) {
    case 'search': {
      if (wantsHelp) return out(SEARCH_HELP)
      // A query that starts with a single dash ("-foo", "-1") is query text, not a flag.
      const dashQuery = rest[0] !== undefined && /^-[^-]/.test(rest[0]) ? rest[0] : undefined
      const { values, positionals } = parse(dashQuery === undefined ? rest : rest.slice(1), {
        limit: { type: 'string' }, category: { type: 'string' }, auth: { type: 'string' },
        https: { type: 'boolean' }, 'no-https': { type: 'boolean' }, cors: { type: 'string' }, json: { type: 'boolean' },
      })
      let limit: number | undefined
      if (values.limit !== undefined) {
        limit = Number(values.limit)
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit must be a positive integer, got "${values.limit}"`)
      }
      if (values.https && values['no-https']) throw new UsageError('--https and --no-https are mutually exclusive')
      const query = [...(dashQuery === undefined ? [] : [dashQuery]), ...positionals].join(' ').trim()
      const hasFilter = values.category !== undefined || values.auth !== undefined || values.cors !== undefined || values.https || values['no-https']
      if (!query && !hasFilter) throw new UsageError('search needs a query (or a filter such as --category)')
      const { snapshot } = loadSnapshot()
      const result = createSearcher(snapshot).search(query, {
        ...(limit !== undefined ? { limit } : {}),
        ...(values.category !== undefined ? { category: values.category } : {}),
        ...(values.auth !== undefined ? { auth: values.auth } : {}),
        ...(values.cors !== undefined ? { cors: values.cors } : {}),
        ...(values.https ? { https: true } : values['no-https'] ? { https: false } : {}),
      })
      if (json) printJson(searchDocument(result, snapshot))
      else out(formatSearchText(result))
      return
    }
    case 'categories': {
      if (wantsHelp) return out(CATEGORIES_HELP)
      parse(rest, { json: { type: 'boolean' } })
      const { snapshot } = loadSnapshot()
      const cats = createSearcher(snapshot).categories()
      if (json) printJson(categoriesDocument(cats, snapshot))
      else out(cats.map(c => `${c.name.padEnd(32)} ${c.slug.padEnd(30)} ${(c.zh ?? '').padEnd(10)} ${c.count}`).join('\n') + '\n')
      return
    }
    case 'info': {
      if (wantsHelp) return out(INFO_HELP)
      parse(rest, { json: { type: 'boolean' } })
      const loaded = loadSnapshot()
      const cats = createSearcher(loaded.snapshot).categories()
      const info = {
        loaded_from: loaded.origin, path: loaded.path, cache_dir: cacheHome(),
        entries: loaded.snapshot.entries.length, categories: cats.length, source: loaded.snapshot.source,
      }
      if (json) printJson({ ok: true, schema_version: SCHEMA_VERSION, ...info })
      else {
        out([
          `loaded from : ${info.loaded_from} (${info.path})`, `cache dir   : ${info.cache_dir}`,
          `entries     : ${info.entries} in ${info.categories} categories`, `repo        : ${info.source.repo}`,
          `sha         : ${info.source.sha ?? 'unknown'}`, `commit date : ${info.source.commitDate ?? 'unknown'}`,
          `fetched at  : ${info.source.fetchedAt}`, `source url  : ${info.source.url}`,
        ].join('\n') + '\n')
      }
      return
    }
    case 'sync': {
      if (wantsHelp) return out(SYNC_HELP)
      const { values } = parse(rest, { force: { type: 'boolean' }, from: { type: 'string' }, url: { type: 'string' }, json: { type: 'boolean' } })
      const result = await syncSnapshot({
        ...(values.force ? { force: true } : {}),
        ...(values.from ? { from: values.from } : {}),
        ...(values.url ? { url: values.url } : {}),
      })
      if (json) printJson({ ok: true, schema_version: SCHEMA_VERSION, sync: result })
      else {
        out(result.status === 'unchanged'
          ? `already up to date (sha ${result.sha}); ${result.count} entries. Use --force to rewrite.\n`
          : `synced ${result.count} entries (${result.skipped} skipped rows), sha ${result.sha ?? 'unknown'} -> ${result.path}\n`)
      }
      return
    }
    case 'serve': {
      if (wantsHelp) return out(SERVE_HELP)
      const { values } = parse(rest, {
        port: { type: 'string' }, host: { type: 'string' }, refresh: { type: 'string' }, 'allow-sync': { type: 'boolean' },
      })
      const port = values.port === undefined ? 8787 : Number(values.port)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`--port must be 0-65535, got "${values.port}"`)
      let refreshHours: number | undefined
      if (values.refresh !== undefined) {
        refreshHours = Number(values.refresh)
        if (!Number.isFinite(refreshHours) || refreshHours <= 0) throw new UsageError(`--refresh must be a positive number of hours, got "${values.refresh}"`)
      }
      const running = await startServer({
        port, ...(values.host ? { host: values.host } : {}), ...(refreshHours ? { refreshHours } : {}),
        allowSync: values['allow-sync'] === true, serverFile: true,
      })
      out(`public-apis-index listening on ${running.url}\n`)
      const stop = () => { void running.close().then(() => process.exit(0)) }
      process.on('SIGINT', stop)
      process.on('SIGTERM', stop)
      return
    }
    case 'url': {
      if (wantsHelp) return out('Usage: public-apis-index url [--json]\n\nPrint the base URL of the running "serve" process (from server.json in the cache dir). Exit 1 if none is running.\n')
      parse(rest, { json: { type: 'boolean' } })
      const info = readServerInfo()
      if (!info) throw new NotRunningError('no running public-apis-index server found (start one with: public-apis-index serve --port 8787)')
      if (json) printJson({ ok: true, schema_version: SCHEMA_VERSION, ...info })
      else out(info.url + '\n')
      return
    }
    default:
      throw new UsageError(`unknown command "${command}"`)
  }
}

void main(process.argv.slice(2))
