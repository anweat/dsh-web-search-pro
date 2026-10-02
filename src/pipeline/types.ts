/**
 * Evidence-pipeline types (dev-plan §4.2 TaskSpec/Constraint, design §6.1
 * candidate fields). Pure data; nothing here touches the network or storage.
 * @module web-search-pro/pipeline/types
 */

export type Profile = 'docs_code' | 'news_fact' | 'academic' | 'experience' | 'compare' | 'general'
export const PROFILES: readonly Profile[] = ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general']

export type ConstraintKind =
  | 'must_term' | 'exclude_term' | 'entity' | 'version' | 'time_window'
  | 'site' | 'exclude_site' | 'language' | 'region' | 'source_type'
export const CONSTRAINT_KINDS: readonly ConstraintKind[] = [
  'must_term', 'exclude_term', 'entity', 'version', 'time_window',
  'site', 'exclude_site', 'language', 'region', 'source_type',
]

export type ConstraintStrength = 'hard' | 'soft'
/** Priority when sources disagree: param > query_syntax > rule_extracted; judge_extracted is soft-only until proven. */
export type ConstraintOrigin = 'param' | 'query_syntax' | 'rule_extracted' | 'judge_extracted'

export interface Need { id: string; text: string; critical: boolean }

export interface Constraint {
  id: string
  kind: ConstraintKind
  value: string
  strength: ConstraintStrength
  origin: ConstraintOrigin
}

/** Limits of one pipeline run; every field is optional and defaults live where it is used. */
export interface BudgetProfile {
  /** Total characters of evidence excerpts in the pack (default 6000). */
  chars?: number
  /** Kept candidates whose pages are read (default 4). */
  fetchTopK?: number
  /** Blocks from one URL in the pack (default 2). */
  maxPerUrl?: number
  /** Overall wall-clock deadline in ms; partial results return when it passes. */
  deadlineMs?: number
}

export interface TaskSpec {
  /** Short goal, written by the calling model (never the full chat). */
  goal: string
  query: string
  profile?: Profile
  /** Sub-questions to answer; callers default it to `[goal]`. */
  needs: Need[]
  constraints: Constraint[]
  budget: BudgetProfile
}

/** One provider hit for a candidate. `rank` is 1-based within that provider's result list. */
export interface Contribution {
  providerId: string
  rank: number
  /** The exact query sent to the provider (may be a compiled variant). */
  query: string
}

export type Satisfied = 'yes' | 'no' | 'unknown'

export interface ConstraintCheck {
  constraintId: string
  satisfied: Satisfied
  /** Probability-like confidence that the constraint holds (rule verdicts: 0, 0.x or 1). */
  prob: number
}

export interface GateVerdict {
  keep: boolean
  /** Lexical relevance (gate.relevance.v1 definition: query + goal + needs, no constraint terms). */
  relevance: number
  /** Threshold the relevance score was compared with. */
  threshold: number
  /** Why it was dropped; absent when kept. */
  reason?: 'constraint' | 'relevance'
  /** Ids of the hard constraints definitely violated. */
  violated?: string[]
  /** Relevance was computed with the cross-lingual alignment (needs and candidate text in different languages); absent for the lexical-v1 score. */
  aligned?: true
  /** Dropped on relevance alone but kept by the floor (`keep` is true): too few candidates passed the gate. */
  lowConfidence?: true
}

export interface Candidate {
  /** `c_` + 12 hex of sha1(canonicalUrl): stable across runs and providers. */
  candidateId: string
  canonicalUrl: string
  /** First-seen raw URL. */
  url: string
  title: string
  snippet: string
  publishedAt?: string
  /** Every (provider, rank, query) that returned this URL. */
  contributions: Contribution[]
  checks?: ConstraintCheck[]
  gate?: GateVerdict
}

/** One addressable piece of a page (see blocks.ts). */
export interface Block {
  /** `b_` + 12 hex of sha1(url + ':' + start). Stable for the same url + text layout. */
  blockId: string
  /** Heading path, `A > B > C`, when the block sits under a heading. */
  heading?: string
  text: string
  /** Character offsets into the page `text`; `text === page.text.slice(start, end)`. */
  start: number
  end: number
  /** 16 hex of sha1(text): detects drift when a page is re-fetched. */
  hash: string
}

// ── S5–S8 and the EvidencePack (dev-plan §4.3, §4.5) ────────────────────────

/** A block together with the page it came from; the unit S6 scores and S7 selects. */
export interface PageBlock {
  candidateId: string
  url: string
  /** Candidate title, else the page title. */
  title: string
  publishedAt?: string
  /** Provider ids that returned the URL (`ddg+bing`): provenance shown to the model as `source`. */
  providers: string[]
  /** The candidate only passed the S4 floor, not the relevance gate. */
  lowConfidence?: true
  block: Block
}

/** `grade` is 0..3 (rule: integer buckets; Jev: the level expectation). `rank` is a finer tie-breaker. */
export interface BlockGrade { grade: number; rank?: number }

export interface ScoredBlock extends PageBlock {
  /** needId -> grade for the needs the block was scored against. */
  grades: ReadonlyMap<string, BlockGrade>
}

export interface EvidenceItem {
  evidenceId: string
  blockId: string
  url: string
  title?: string
  excerpt: string
  /** Heading path of the block. */
  heading?: string
  publishedAt?: string
  /** Needs the block supports, best first. */
  needIds: string[]
  /** Best grade over the needs (0..3). */
  grade: number
  /** Provider ids that returned the page (`ddg+bing`). */
  source: string
  /** The page's candidate failed the relevance gate and was kept only by the floor. */
  lowConfidence?: true
}

export type GapReason = 'no_candidates' | 'no_page_content' | 'weak_support' | 'budget'

export interface Gap { needId: string; text: string; critical: boolean; reason: GapReason; bestGrade?: number }

export interface PackStats {
  candidates: number
  kept: number
  /** Of `kept`: candidates that failed the relevance gate and were kept by the floor. */
  lowConfidence?: number
  fetched: number
  blocksScored: number
  excerptChars: number
  scorer: string
  /** Retrieval rounds run (1, or 2 when a follow-up round searched for critical gaps). */
  rounds?: number
  /** Search queries made over all rounds: one per provider call (broader fallback retries of one provider, e.g. GitHub keywords, count once). */
  queries?: number
  /** Jev usage of this run (control or shadow). */
  jev?: { requests: number; questions: number; inputTokens: number; outputTokens: number; mode: 'control' | 'shadow' | 'hybrid'; /** `id@version#hash` of the judge rubric. */ rubric?: string; /** The rubric is a user override of the built-in. */ rubricOverridden?: boolean; /** Model judge behind the grades (dev-plan M5): provider id, protocol, model and the calibration version. */ provider?: string; protocol?: string; model?: string; calibration?: string; /** Some input tokens are the plugin's estimate (the service reported none). */ estimated?: boolean }
}

export interface EvidencePack {
  resultId: string
  profile: Profile
  /** Profile was inferred by rule (the caller gave none). */
  profileInferred: boolean
  /** The needs the run was asked to cover (ids are what `needIds` / `coveredNeeds` / `gaps` refer to). */
  needs: Need[]
  evidence: EvidenceItem[]
  /** Need ids with a selected block of grade >= 2. */
  coveredNeeds: string[]
  gaps: Gap[]
  /** Fused kept candidates, best first (unshaped; the tool exit applies `shapeSources`). */
  sources: { url: string; title?: string; snippet?: string; publishedAt?: string; lowConfidence?: true }[]
  engine: string
  enginesTried: string[]
  partial: boolean
  notes: string[]
  /** Constraints enforced natively by at least one provider vs. verified locally only (`kind=value`). */
  verification: { native: string[]; local: string[] }
  stats: PackStats
}
