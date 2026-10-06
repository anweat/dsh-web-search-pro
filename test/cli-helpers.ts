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
