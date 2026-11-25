import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CliAdapterSpec } from '../src/cli/spec.ts'

export const posix = process.platform !== 'win32'

/** Run `fn` with PATH limited to a temp dir holding the given fake commands (shell scripts) plus the system dirs. */
export async function withCommands<T>(commands: Record<string, string>, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsp-fake-bin-'))
  const original = process.env.PATH
  for (const [name, body] of Object.entries(commands)) {
    const file = path.join(dir, name)
    fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n')
    fs.chmodSync(file, 0o755)
  }
  process.env.PATH = dir + path.delimiter + '/usr/bin' + path.delimiter + '/bin'
  try { return await fn(dir) } finally {
    process.env.PATH = original
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** A small valid user spec; tests change single fields. */
export function baseSpec(over: Record<string, unknown> = {}): CliAdapterSpec {
  return {
    id: 'demo',
    bins: ['demo-cli'],
    packageNote: 'demo-cli (npm i -g demo-cli)',
    platforms: ['demo'],
    probe: { versionArgs: ['--version'], helpArgs: ['search', '--help'], mustContain: ['--json'] },
    allowedSubcommands: ['search'],
    search: {
      argv: ['search', '{query}', '--limit', '{count}', '--json'],
      maxCount: 5,
      output: { format: 'json', itemsPath: 'data', fields: { url: 'url', title: 'title', snippet: 'summary' } },
    },
    env: {},
    needsLogin: false,
    timeoutMs: 5_000,
    maxOutputBytes: 64 * 1024,
    ...over,
  } as CliAdapterSpec
}

const FIXTURES = new URL('./fixtures/cli/', import.meta.url).pathname

export interface FakeSite {
  code?: number
  stdout?: string
  stderr?: string
  /** What `opencli <site> search --help` prints as TEXT (default: the three browser flags a real 1.8.8 lists). A site with its own text help gets no JSON help: an older 1.8.x. */
  help?: string
  /** `overview`: the site has no search command, so `search --help -f json` prints the site overview (the real v2ex output). */
  overview?: boolean
}

export const OPENCLI_SILENT_HELP = [
  'Usage: opencli SITE search <query> [options]',
  'Browser common options:',
  '  --window <mode>        Browser window mode: foreground or background',
  '  --site-session <mode>  Adapter site session lifecycle: ephemeral or persistent',
  '  --keep-tab <bool>      Keep the browser tab lease after the command finishes',
].join('\n')

/**
 * The body of a fake `opencli` (1.8.8): `--version`, `list --help`, `list -f json` (the real command table captured in
 * fixtures/cli/opencli-list.json), `<site> search --help`, and `<site> search ...`, which prints the given stdout / stderr and
 * exits with the given code. Every real search call is appended to `argv.log` next to the command, one line per call.
 */
export function fakeOpencli(sites: Record<string, FakeSite>, options: { version?: string; generation?: 1 | 2 } = {}): string {
  const version = options.version ?? '1.8.8'
  const generation = options.generation ?? (version.startsWith('1.') ? 1 : 2)
  const heredoc = (tag: string, text: string): string => 'cat <<\'' + tag + '\'\n' + text + '\n' + tag + '\n'
  // The real `search --help -f json` of the generation, captured from 1.8.8 and 2.0.3 (fixtures/cli/help/opencli<N>-<site>-search.json).
  const jsonHelpOf = (site: string, s: FakeSite): string | undefined => {
    if (s.help !== undefined) return undefined
    const file = FIXTURES + 'help/opencli' + generation + '-' + (s.overview ? 'v2ex' : site) + '-search.json'
    return fs.existsSync(file) ? file : undefined
  }
  const cases = Object.entries(sites).map(([site, s]) => [
    site + ')',
    '  if [ "$3" = "--help" ]; then',
    jsonHelpOf(site, s) ? '    if [ "$4" = "-f" ]; then cat \'' + jsonHelpOf(site, s) + '\'; exit 0; fi' : '',
    heredoc('HELP_' + site.toUpperCase().replace(/[^A-Z]/g, ''), (s.help ?? OPENCLI_SILENT_HELP).replace('SITE', site)),
    '    exit 0',
    '  fi',
    '  printf \'%s\\n\' "$*" >> "$(dirname "$0")/argv.log"',
    s.stdout ? heredoc('OUT_' + site.toUpperCase().replace(/[^A-Z]/g, ''), s.stdout) : '',
    s.stderr ? heredoc('ERR_' + site.toUpperCase().replace(/[^A-Z]/g, ''), s.stderr).replace(/^cat </, 'cat >&2 <') : '',
    '  exit ' + (s.code ?? 0),
    '  ;;',
  ].join('\n')).join('\n')
  const unknown = generation === 1
    ? '*) echo "error: unknown command \'$1\'" >&2; exit 2;;'
    : '*) cat \'' + FIXTURES + 'live-opencli2-unknown-command.json\'; exit 2;;'
  return [
    'case "$1" in',
    '--version) echo "' + version + '";;',
    'list) if [ "$2" = "--help" ]; then cat \'' + FIXTURES + 'help/opencli-list.txt\'; elif [ "$2" = "-f" ]; then cat \'' + FIXTURES + (generation === 1 ? 'opencli-list.json' : 'live-opencli2-list-page.json') + '\'; fi;;',
    cases,
    unknown,
    'esac',
  ].join('\n')
}
