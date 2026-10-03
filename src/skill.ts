/**
 * The bundled `dsh-web-search-pro` skill: usage guidance for the web_index / web_call tools.
 *
 * The skill is registered with the Host's skill registry when that service
 * exists. It must never be a hard dependency of the plugin: Cordis 4.0.4 treats
 * every declared `inject` as required, so a missing `skills` service would hang
 * the whole plugin. The plugin therefore asks for it through a scoped
 * `ctx.inject(['skills'], ...)` and works the same without it (the `web_index`
 * root then carries a compact guide).
 * @module web-search-pro/skill
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

export const SKILL_NAME = 'dsh-web-search-pro'
const PROVIDER_NAME = 'dsh-web-search-pro'
/** Same rank the Host gives packaged skills (`BUNDLED_SKILL_RANK`). */
const BUNDLED_SKILL_RANK = 600

/** `assets/skills/dsh-web-search-pro/`, resolved next to `src/` or the built `lib/`. */
export const SKILL_DIR = fileURLToPath(new URL('../assets/skills/dsh-web-search-pro/', import.meta.url))

/** Parse `name` and `description` out of a SKILL.md and return the body without the front matter. */
export function parseSkillFile(raw: string): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) throw new Error('SKILL.md is missing its front matter')
  const field = (key: string): string => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(match[1]!)
    return line ? line[1]!.trim().replace(/^["']|["']$/g, '') : ''
  }
  return { name: field('name'), description: field('description'), body: match[2]!.replace(/^\s+/, '') }
}

export function readSkill(dir = SKILL_DIR): { name: string; description: string; body: string } {
  return parseSkillFile(fs.readFileSync(dir + 'SKILL.md', 'utf8'))
}

/**
 * A provider object shaped like the Host's `SkillProvider` (declared locally to avoid a build-time dependency).
 * It re-reads the packaged file on every call, so it is never stale.
 */
export function createSkillProvider(dir = SKILL_DIR) {
  const resourceBase = { kind: 'directory' as const, path: dir }
  const invocation = { modelInvocable: true, userInvocable: true }
  // Fail at creation when the packaged file is missing or malformed.
  readSkill(dir)
  return {
    name: PROVIDER_NAME,
    list: async () => {
      const skill = readSkill(dir)
      return [{
        name: skill.name,
        description: skill.description,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase,
        rank: BUNDLED_SKILL_RANK,
        locator: dir + 'SKILL.md',
      }]
    },
    get: async () => {
      const current = readSkill(dir)
      return { name: current.name, description: current.description, invocation, provider: PROVIDER_NAME, source: 'bundled', resourceBase, content: current.body }
    },
  }
}

export interface SkillRegistration {
  /** Whether the skill is registered with the Host right now (false without a skill service). */
  isAvailable: () => boolean
}

/**
 * Register the skill when the Host provides a skill registry, and track whether
 * it is registered so the index can fall back to its compact guide otherwise.
 */
export function registerSkillWhenAvailable(ctx: Context, dir = SKILL_DIR): SkillRegistration {
  let available = false
  // `skills` is optional: this opens a child scope that is applied only while
  // the service exists, and is torn down (provider included) when it goes away.
  ;(ctx as any).inject(['skills'], (skillCtx: any) => {
    let provider: ReturnType<typeof createSkillProvider>
    try { provider = createSkillProvider(dir) } catch (error) {
      skillCtx.logger?.(PROVIDER_NAME)?.warn?.('dsh-web-search-pro skill not registered: ' + String(error))
      return
    }
    const handle = skillCtx.skills.registerProvider(() => provider)
    const unregister: () => void = typeof handle === 'function' ? handle : () => {}
    available = true
    skillCtx.effect?.(() => () => {
      try { unregister() } catch { /* the Host may already have dropped it */ }
      available = false
    })
  })
  return { isAvailable: () => available }
}
