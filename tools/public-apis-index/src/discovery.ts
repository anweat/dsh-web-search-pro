import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cacheHome } from './snapshot.ts'

export interface ServerInfo {
  url: string
  pid: number
  startedAt: string
}

export const serverFilePath = (home = cacheHome()): string => join(home, 'server.json')

export function writeServerFile(info: ServerInfo, home = cacheHome()): void {
  const file = serverFilePath(home)
  mkdirSync(home, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(info) + '\n')
  renameSync(tmp, file)
}

/** Remove server.json only if it still belongs to this pid (another server may have replaced it). */
export function removeServerFile(home = cacheHome(), pid = process.pid): void {
  const file = serverFilePath(home)
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerInfo>
    if (info.pid === pid) rmSync(file, { force: true })
  } catch {
    /* missing or unreadable: nothing to remove */
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The running server's info, or null when there is no server.json or its pid is gone. */
export function readServerInfo(home = cacheHome()): ServerInfo | null {
  const file = serverFilePath(home)
  if (!existsSync(file)) return null
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServerInfo>
    if (typeof info.url !== 'string' || typeof info.pid !== 'number' || typeof info.startedAt !== 'string') return null
    return pidAlive(info.pid) ? (info as ServerInfo) : null
  } catch {
    return null
  }
}
