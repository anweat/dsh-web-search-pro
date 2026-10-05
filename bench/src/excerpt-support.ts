/** Curated excerpt-level requirements, separate from draft full-block labels. */
import type { EvidencePack } from '../../src/pipeline/types.ts'

export interface ExcerptRequirement {
  needId: string
  /** Each alternative is a complete set of required literal support spans. */
  alternatives: readonly (readonly string[])[]
}

/** Remove presentation markup only; retain numbers, negation, conditions and punctuation. */
export function normalizeSupportText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

/** Evaluate only delivered excerpts, never title/heading/metadata or the original block. */
export function evaluateExcerptSupport(pack: Pick<EvidencePack, 'evidence' | 'coveredNeeds'>, requirements: readonly ExcerptRequirement[]) {
  const excerpts = pack.evidence.map(e => normalizeSupportText(e.excerpt))
  return requirements.map(requirement => {
    const supported = requirement.alternatives.some(spans => spans.length > 0 && spans.every(span => {
      const normalized = normalizeSupportText(span)
      return normalized.length > 0 && excerpts.some(text => text.includes(normalized))
    }))
    const claimed = pack.coveredNeeds.includes(requirement.needId)
    return { needId: requirement.needId, supported, claimed, falseCovered: claimed && !supported }
  })
}
