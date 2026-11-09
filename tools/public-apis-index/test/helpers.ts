import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
export const FIXTURE = fileURLToPath(new URL('./fixtures/sample-readme.md', import.meta.url))

export function tempHome(): { home: string; cleanup(): void } {
  const home = mkdtempSync(join(tmpdir(), 'pai-home-'))
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) }
}

export interface CliRun {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs the built CLI (npm test builds first). Always isolates the cache dir. */
export function runCli(args: string[], home: string, extraEnv: Record<string, string> = {}): Promise<CliRun> {
  if (!existsSync(CLI)) throw new Error('dist/cli.js missing: run `npm run build` (npm test does this)')
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, PUBLIC_APIS_INDEX_HOME: home, ...extraEnv } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

export function spawnCli(args: string[], home: string): ChildProcess {
  return spawn(process.execPath, [CLI, ...args], { env: { ...process.env, PUBLIC_APIS_INDEX_HOME: home } })
}
