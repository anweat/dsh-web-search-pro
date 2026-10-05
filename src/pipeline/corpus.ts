/**
 * Page-level term statistics for the S6 rule scorer (dev-plan M3b).
 *
 * Problem (real host, after M3a): on the node:sqlite page `DatabaseSync` sits in
 * the code sample of nearly every section, so a section about serialize() or
 * loadExtension() matched "DatabaseSync ... timeout" on that identifier (plus
 * `node:sqlite`) alone and graded 2, while the section that documents the
 * `timeout` constructor option was crowded out. Terms are therefore weighed by
 * how few blocks of the page contain them (IDF, floor 0.2, the M2c pre-rank
 * idea), and a grade of 2 or more needs at least one distinctive matched term.
 *
 * Statistics come from the blocks of one URL when it has enough of them, else
 * from all blocks read; with fewer than {@link STATS_MIN_BLOCKS} blocks there is
 * nothing to count and the scorer keeps its un-weighted behaviour.
 * @module web-search-pro/pipeline/corpus
 */

import { latinTermsOf } from './align.ts'
import { blockScoringText, type RankableBlock } from './blocks.ts'
import { termsOf, type PageTermStats } from './lexical.ts'

export interface CorpusBlock extends RankableBlock { url: string }

/** Fewer blocks than this: no statistics. */
export const STATS_MIN_BLOCKS = 8
/** A URL with at least this many blocks gets its own statistics. */
export const STATS_PAGE_MIN_BLOCKS = 12

class TermTable implements PageTermStats {
  readonly n: number
  private readonly lexical = new Map<string, number>()
  private readonly latin = new Map<string, number>()

  constructor(blocks: readonly RankableBlock[]) {
    this.n = blocks.length
    for (const block of blocks) {
      const text = blockScoringText(block)
      for (const term of termsOf(text).keys()) this.lexical.set(term, (this.lexical.get(term) ?? 0) + 1)
      for (const term of latinTermsOf(text).keys()) this.latin.set(term, (this.latin.get(term) ?? 0) + 1)
    }
  }

  dfLexical(term: string): number { return this.lexical.get(term) ?? 0 }
  dfLatin(term: string): number { return this.latin.get(term) ?? 0 }
}

export class CorpusStats {
  private readonly byUrl = new Map<string, CorpusBlock[]>()
  private readonly tables = new Map<string, TermTable | undefined>()
  private all: TermTable | undefined
  readonly size: number

  constructor(private readonly blocks: readonly CorpusBlock[]) {
    this.size = blocks.length
    for (const block of blocks) {
      const list = this.byUrl.get(block.url)
      if (list) list.push(block)
      else this.byUrl.set(block.url, [block])
    }
  }

  /** Statistics to weigh a block of `url` with, or undefined when the corpus is too small. */
  statsFor(url: string): PageTermStats | undefined {
    const own = this.byUrl.get(url)
    if (own && own.length >= STATS_PAGE_MIN_BLOCKS) {
      let table = this.tables.get(url)
      if (!table) { table = new TermTable(own); this.tables.set(url, table) }
      return table
    }
    if (this.size < STATS_MIN_BLOCKS) return undefined
    this.all ??= new TermTable(this.blocks)
    return this.all
  }
}
