/**
 * What "Adopt into configuration" writes, and the small formatting the agent section needs. Pure and free of the Host: the
 * controller calls these, the tests call the same functions.
 *
 * Adopting an overlay entry means the user takes the agent's value as their own: it is written into the profile (the baseline) with
 * the same atomic `mutate` the save bar uses, at the leaf the entry is about (`sources.confidence.<id>`, `cliAdapters.<id>`,
 * `platformBackends.<platform>`, `engines`, `sources.priority`, `sources.disabled`), and only then is the overlay entry dropped, so there
 * is never a moment when the value is in neither place. Revoking only drops the entry.
 * @module web-search-pro/client/overlay-ops
 */

import type { OverlayItem } from '../overlay-types.ts'

export type SectionOp = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] }

export interface Adoption {
  /** The Host ops that write the value into the configuration. */
  ops: SectionOp[]
  /** Card fields whose staged draft the adopted value replaces (the draft would otherwise be shown against a changed baseline). */
  drop: string[]
}

/** The ops that write an overlay item into the configuration; undefined for a key that is none of the overridable ones. */
export function adoptionOf(item: Pick<OverlayItem, 'kind' | 'target' | 'value'>): Adoption | undefined {
  const value = structuredClone(item.value)
  switch (item.kind) {
    case 'engines': return { ops: [{ op: 'set', path: ['engines'], value }], drop: ['engines'] }
    case 'priority': return { ops: [{ op: 'set', path: ['sources', 'priority'], value }], drop: ['sources.priority'] }
    case 'disabled': return { ops: [{ op: 'set', path: ['sources', 'disabled'], value }], drop: ['sources.disabled'] }
    case 'confidence': return item.target ? { ops: [{ op: 'set', path: ['sources', 'confidence', item.target], value }], drop: ['sources.confidence.' + item.target] } : undefined
    case 'platform': return item.target ? { ops: [{ op: 'set', path: ['platformBackends', item.target], value }], drop: ['platformBackends'] } : undefined
    case 'cli': return item.target ? { ops: [{ op: 'set', path: ['cliAdapters', item.target], value }], drop: ['cliAdapters'] } : undefined
  }
}

/** The overlay key a card field is the baseline of (the row that shows it carries the "changed by the agent" mark), or undefined. */
export function overlayKeyOfField(field: string): string | undefined {
  return field === 'engines' || field === 'sources.priority' || field === 'sources.disabled' ? field : undefined
}

const two = (n: number): string => String(n).padStart(2, '0')

/** `2026-10-27 22:35` in the viewer's time zone; the text itself when it is no date. */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate()) + ' ' + two(date.getHours()) + ':' + two(date.getMinutes())
}

/**
 * The custom CLIs an overlay item leans on that only the overlay holds: an engine list or a platform chain that names `custom-cli:<id>`
 * where `cliAdapters.<id>` is itself an overlay entry. Adopting such an item alone would leave the configuration naming a CLI it does not
 * define, so the card says to adopt the CLI too.
 */
export function overlayCliDependencies(item: Pick<OverlayItem, 'kind' | 'value'>, items: readonly Pick<OverlayItem, 'key'>[]): string[] {
  if ((item.kind !== 'engines' && item.kind !== 'platform' && item.kind !== 'priority') || !Array.isArray(item.value)) return []
  const held = new Set(items.map(entry => entry.key))
  return item.value.filter((id): id is string => typeof id === 'string' && id.startsWith('custom-cli:') && held.has('cliAdapters.' + id.slice('custom-cli:'.length))).map(id => id.slice('custom-cli:'.length))
}
