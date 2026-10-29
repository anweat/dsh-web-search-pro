#!/usr/bin/env node
/**
 * Documentation checks, no dependencies:
 *  1. every relative link in the repository's Markdown files points at an existing file, and `#anchor` fragments exist as
 *     headings (GitHub slug rules) in the target file;
 *  2. README.md and README.en.md have the same number of second-level headings (the English page mirrors the Chinese one).
 *
 * Skipped: node_modules, lib, .git and bench (bench keeps its own notes), absolute URLs, and anything inside fenced code.
 * Run: node scripts/check-docs-links.mjs   (also part of `pnpm run verify`)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', 'lib', '.git', 'bench', '.codegraph'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(dir, entry.name))
  }
  return out
}

/** Lines outside fenced code blocks, with their 1-based numbers. */
function proseLines(text) {
  const lines = text.split('\n')
  const out = []
  let fence = null
  lines.forEach((line, i) => {
    const m = /^\s*(```+|~~~+)/.exec(line)
    if (m) {
      if (!fence) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
      return
    }
    if (!fence) out.push([i + 1, line])
  })
  return out
}

/** GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens. */
function slug(heading) {
  return heading
    .trim()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '')
    .replace(/ /g, '-')
}

const anchorCache = new Map()
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file)
  const seen = new Map()
  const set = new Set()
  for (const [, line] of proseLines(fs.readFileSync(file, 'utf8'))) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (!m) continue
    const base = slug(m[2])
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    set.add(n === 0 ? base : `${base}-${n}`)
  }
  anchorCache.set(file, set)
  return set
}

const problems = []
const files = walk(root)
for (const file of files) {
  const rel = path.relative(root, file)
  for (const [lineNo, line] of proseLines(fs.readFileSync(file, 'utf8'))) {
    // [text](target) and <target>-less reference-free links only; inline code is stripped first.
    const stripped = line.replace(/`[^`]*`/g, '')
    for (const m of stripped.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1]
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue // http:, https:, mailto: ...
      const [pathPart, rawFragment] = target.split('#')
      const fragment = rawFragment === undefined ? undefined : decodeURIComponent(rawFragment)
      const targetFile = pathPart === '' ? file : path.resolve(path.dirname(file), decodeURIComponent(pathPart))
      if (!fs.existsSync(targetFile)) { problems.push(`${rel}:${lineNo}: missing file ${target}`); continue }
      if (fragment !== undefined && fragment !== '') {
        if (!targetFile.endsWith('.md')) continue
        if (!anchorsOf(targetFile).has(fragment.toLowerCase())) problems.push(`${rel}:${lineNo}: missing anchor #${fragment} in ${path.relative(root, targetFile)}`)
      }
    }
  }
}

function h2Count(file) {
  return proseLines(fs.readFileSync(file, 'utf8')).filter(([, line]) => /^## /.test(line)).length
}
const zh = path.join(root, 'README.md')
const en = path.join(root, 'README.en.md')
if (!fs.existsSync(zh) || !fs.existsSync(en)) problems.push('README.md and README.en.md must both exist')
else if (h2Count(zh) !== h2Count(en)) problems.push(`README.md has ${h2Count(zh)} second-level headings but README.en.md has ${h2Count(en)}`)

if (problems.length) {
  console.error(`docs check failed (${problems.length}):\n` + problems.map(p => '  ' + p).join('\n'))
  process.exit(1)
}
console.log(`docs check ok: ${files.length} Markdown files, links and anchors resolve, README headings match`)
