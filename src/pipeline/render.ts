/**
 * Text rendering of an EvidencePack for the model (tool output `render`) and
 * for size accounting in the offline eval. Compact on purpose: one card per
 * excerpt, gaps in one line, remaining sources as bare links.
 * @module web-search-pro/pipeline/render
 */

import type { EvidencePack } from './types.ts'

export interface RenderSource { url: string; title?: string; snippet?: string; publishedAt?: string; lowConfidence?: boolean }

/** Marker for a source / excerpt whose page only passed the S4 floor, not the relevance gate (dev-plan §3.1). */
export const LOW_RELEVANCE = ' (low relevance)'

const hostOf = (url: string): string => { try { return new URL(url).hostname } catch { return url } }

/** One line under the header (dev-plan M3b): "covered" is a lexical judgement, and a missing passage proves nothing. */
export const COVERAGE_CAVEAT = 'Coverage is heuristic: no evidence here does not mean it does not exist; fetch/expand before concluding.'

export function renderEvidencePack(pack: Pick<EvidencePack, 'resultId' | 'profile' | 'needs' | 'evidence' | 'coveredNeeds' | 'gaps' | 'partial' | 'notes' | 'verification'> & Partial<Pick<EvidencePack, 'uncertainNeeds'>>, sources: readonly RenderSource[], engineLine: string, expandLine = 'To read around an excerpt: history.expand evidenceId=<id>.'): string {
  const parts: string[] = []
  const covered = new Set(pack.coveredNeeds)
  const unsure = new Set(pack.uncertainNeeds ?? [])
  parts.push('Evidence pack ' + pack.resultId + ' (' + pack.profile + (pack.partial ? ', PARTIAL: deadline reached' : '') + '): ' + pack.evidence.length + ' excerpt(s); needs covered ' + pack.coveredNeeds.length + '/' + pack.needs.length + '.\n' + COVERAGE_CAVEAT)
  if (pack.evidence.length) {
    parts.push(pack.evidence.map((e, i) => {
      const lines = ['[' + (i + 1) + '] ' + e.evidenceId + ' — ' + (e.title ? e.title + ' — ' : '') + e.url + (e.publishedAt ? ' (' + e.publishedAt + ')' : '') + (e.lowConfidence ? LOW_RELEVANCE : '')]
      if (e.heading) lines.push('    § ' + e.heading)
      lines.push('    ' + e.excerpt.replace(/\n+/g, '\n    '))
      lines.push('    needs ' + e.needIds.join(',') + ' · grade ' + e.grade + (e.source ? ' · via ' + e.source : ''))
      return lines.join('\n')
    }).join('\n\n'))
  } else {
    parts.push('No evidence excerpt reached the required support level.')
  }
  parts.push('Needs: ' + pack.needs.map(n => n.id + ' "' + n.text + '"' + (covered.has(n.id) ? (unsure.has(n.id) ? ' ✓ (judge unsure)' : ' ✓') : ' ✗')).join('; '))
  if (pack.gaps.length) {
    parts.push('Gaps: ' + pack.gaps.map(g => g.needId + ' ' + g.reason + (g.band ? ' (judge)' : g.bestGrade !== undefined ? ' (best grade ' + g.bestGrade + ')' : '') + (g.critical ? '' : ' [optional]')).join('; ')
      + '. Fetch a listed source with read.fetch, or search again with a different query.')
  }
  const shown = new Set(pack.evidence.map(e => e.url))
  const others = sources.filter(s => !shown.has(s.url))
  if (others.length) parts.push('Other sources:\n' + others.map(s => '- [' + (s.title || hostOf(s.url)) + '](' + s.url + ')' + (s.publishedAt ? ' (' + s.publishedAt + ')' : '') + (s.lowConfidence ? LOW_RELEVANCE : '')).join('\n'))
  const v = pack.verification
  if (v.native.length || v.local.length) parts.push('Constraints — enforced by the search provider: ' + (v.native.join(', ') || 'none') + '; checked locally only: ' + (v.local.join(', ') || 'none') + '.')
  parts.push(engineLine + (pack.notes.length ? '\nNotes: ' + pack.notes.join(' | ') : ''))
  if (pack.evidence.length) parts.push(expandLine)
  return parts.join('\n\n')
}

/** The pack as `search.run` and the ctx.web provider return it (`EvidenceOutput` of pipeline/service.ts). */
type PackFields = Parameters<typeof renderEvidencePack>[0]
export interface RenderableOutput extends PackFields {
  sources: readonly RenderSource[]
  engine: string
  enginesTried?: readonly string[] | undefined
}

/**
 * Pack text with the engine line `search.run` shows. `omitOtherSources`: the caller lists the sources itself (the ctx.web tool does).
 * `expandLine` replaces the closing "how to read on" line (the ctx.web tool names the calls on its tool surface).
 */
export function renderEvidenceOutput(out: RenderableOutput, opts: { omitOtherSources?: boolean; expandLine?: string } = {}): string {
  const tried = out.enginesTried ?? []
  return renderEvidencePack(out, opts.omitOtherSources ? [] : out.sources, 'Engine: ' + out.engine + (tried.length ? '; tried: ' + tried.join(', ') : ''), opts.expandLine)
}
