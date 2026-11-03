// Regenerate data/snapshot.json from a local README.md path, or from the network when no path is given.
// Usage: npm run snapshot -- [path/to/README.md] [--sha <sha>] [--date <iso>] [--out <file>]
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { RAW_README_URL, SOURCE_REPO, fetchCommitInfo, parseReadmeDetailed, writeSnapshotFile } from '../dist/index.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { sha: { type: 'string' }, date: { type: 'string' }, out: { type: 'string' } },
})
const out = values.out ?? fileURLToPath(new URL('../data/snapshot.json', import.meta.url))
const from = positionals[0]

let md
let sha = values.sha ?? null
let commitDate = values.date ?? null
let url = RAW_README_URL
if (from) {
  md = readFileSync(from, 'utf8')
  url = RAW_README_URL
} else {
  const res = await fetch(RAW_README_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${RAW_README_URL}`)
  md = await res.text()
  if (!sha) {
    const info = await fetchCommitInfo({}).catch(() => null)
    sha = info?.sha ?? null
    commitDate = info?.commitDate ?? null
  }
}
const { entries, skipped } = parseReadmeDetailed(md)
writeSnapshotFile(out, {
  schemaVersion: 1,
  source: { repo: SOURCE_REPO, sha, commitDate, fetchedAt: new Date().toISOString(), url },
  entries,
})
console.log(`wrote ${out}: ${entries.length} entries, ${skipped.length} skipped rows, sha=${sha ?? 'null'}`)
