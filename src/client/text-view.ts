/**
 * The "Advanced: text mode" view: the plugin's settings as one commented YAML text. It is a read-only print of the controls'
 * staged state, not a second place the settings live. Every key has a comment in front of it (see field-docs.ts); keys you have
 * overridden are plain lines, the others are commented `# key: value` lines showing the value in force; secrets never appear
 * (only the names of the credentials that hold them). Comment lines start with `#`, so stripping them leaves exactly the
 * overrides as valid YAML.
 * @module web-search-pro/client/text-view
 */

import { fieldDoc, textViewDocs, type DocLang } from './field-docs.ts'
import { CONFIG_GROUP_IDS, CONFIG_GROUPS } from '../config-groups.ts'
import { isRestartField } from '../restart.ts'
import { isPathSpec, type FieldSpec, type Json, type PathSpec } from './form-specs.ts'

interface FieldView { text: string; overridden: boolean }

interface Leaf { spec: FieldSpec; value: unknown; set: boolean; overridden: boolean }
interface Node { children: Map<string, Node>; leaf?: Leaf }

const newNode = (): Node => ({ children: new Map() })
const hasActive = (node: Node): boolean => (node.leaf?.overridden ?? false) || [...node.children.values()].some(hasActive)

const scalar = (value: unknown): string => JSON.stringify(value)
const quoteKey = (key: string): string => /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key)

/** The tail of a comment for a setting the plugin reads only when it starts (`playwright` holds one such option: snapshotDir). */
function restartNote(field: string, lang: DocLang | string): string {
  if (field === 'playwright') return lang === 'zh' ? ' 【snapshotDir 重启插件后生效】' : ' [snapshotDir applies after a plugin restart]'
  return isRestartField(field) ? (lang === 'zh' ? ' 【重启插件后生效】' : ' [applies after a plugin restart]') : ''
}

function valueOf(spec: FieldSpec, view: FieldView): { value: unknown; set: boolean } {
  const write = spec.parse(view.text)
  if (write?.kind === 'set') return { value: write.value, set: true }
  return { value: undefined, set: false }
}

/** Print one node and what is below it; a node with nothing overridden below it is printed commented out. */
function print(node: Node, key: string, depth: number, lang: DocLang | string, out: string[]): void {
  const pad = '  '.repeat(depth)
  if (node.leaf) {
    const { spec, value, set, overridden } = node.leaf
    const doc = fieldDoc(spec.field, lang)
    // A setting the plugin reads only when it starts says so in its own comment.
    if (doc) out.push(pad + '# ' + doc + restartNote(spec.field, lang))
    const line = quoteKey(key) + ':' + (set ? ' ' + scalar(value) : '')
    out.push(overridden ? pad + line : pad + '# ' + line)
    return
  }
  const active = hasActive(node)
  out.push(pad + (active ? '' : '# ') + quoteKey(key) + ':')
  for (const [childKey, child] of node.children) print(child, childKey, depth + 1, lang, out)

}

/**
 * The text of the card's current (staged) settings in `lang`. `views` is the staged text and override flag of every field, as the
 * card state carries them; `specs` are the field specs of the form model.
 */
export function renderTextView(views: Readonly<Record<string, FieldView | undefined>>, specs: readonly FieldSpec[], lang: DocLang | string = 'en'): string {
  const docs = textViewDocs(lang)
  const lines: string[] = docs.header.map(line => '# ' + line)
  const leaves = new Map<string, Leaf>()
  const roots = new Map<string, Node>()
  for (const spec of specs) {
    const view = views[spec.field]
    if (!view) continue
    const { value, set } = valueOf(spec, view)
    const leaf: Leaf = { spec, value, set, overridden: view.overridden && set }
    if (isPathSpec(spec)) {
      const root = roots.get((spec as PathSpec).root) ?? newNode()
      roots.set((spec as PathSpec).root, root)
      let node = root
      for (const key of (spec as PathSpec).path) {
        const next = node.children.get(key) ?? newNode()
        node.children.set(key, next)
        node = next
      }
      node.leaf = leaf
    } else {
      leaves.set(spec.field, leaf)
    }
  }
  // Group by group in the order of config-groups.ts, and inside a group key by key in the order of the schema: a plain key is one
  // leaf, an object key (`sources`, `evidence`, ...) is the tree of its options.
  for (const group of CONFIG_GROUP_IDS) {
    const body: string[] = []
    for (const key of CONFIG_GROUPS[group]) {
      const leaf = leaves.get(key)
      if (leaf) print({ children: new Map(), leaf }, key, 0, lang, body)
      const root = roots.get(key)
      if (root) print(root, key, 0, lang, body)
    }
    if (body.length) lines.push('', '# ── ' + docs.group[group] + ' ──', ...body)
  }
  return lines.join('\n') + '\n'
}

/** The text of the lines that are data: every comment line and blank line dropped (what a YAML reader sees). */
export function stripComments(text: string): string {
  return text.split('\n').filter(line => line.trim() !== '' && !line.trimStart().startsWith('#')).join('\n')
}

export type { Json }
