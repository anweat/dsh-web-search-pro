/**
 * Evidence-pipeline types (dev-plan §4.2 TaskSpec/Constraint, design §6.1
 * candidate fields). Pure data; nothing here touches the network or storage.
 * @module web-search-pro/pipeline/types
 */
export type Profile = 'docs_code' | 'news_fact' | 'academic' | 'experience' | 'compare' | 'general';
export declare const PROFILES: readonly Profile[];
export type ConstraintKind = 'must_term' | 'exclude_term' | 'entity' | 'version' | 'time_window' | 'site' | 'exclude_site' | 'language' | 'region' | 'source_type';
export declare const CONSTRAINT_KINDS: readonly ConstraintKind[];
export type ConstraintStrength = 'hard' | 'soft';
/** Priority when sources disagree: param > query_syntax > rule_extracted; judge_extracted is soft-only until proven. */
export type ConstraintOrigin = 'param' | 'query_syntax' | 'rule_extracted' | 'judge_extracted';
export interface Need {
    id: string;
    text: string;
    critical: boolean;
}
export interface Constraint {
    id: string;
    kind: ConstraintKind;
    value: string;
    strength: ConstraintStrength;
    origin: ConstraintOrigin;
}
/** Placeholder: the plan leaves BudgetProfile open (M2b fills it in). */
export type BudgetProfile = Record<string, unknown>;
export interface TaskSpec {
    /** Short goal, written by the calling model (never the full chat). */
    goal: string;
    query: string;
    profile?: Profile;
    /** Sub-questions to answer; callers default it to `[goal]`. */
    needs: Need[];
    constraints: Constraint[];
    budget: BudgetProfile;
}
/** One provider hit for a candidate. `rank` is 1-based within that provider's result list. */
export interface Contribution {
    providerId: string;
    rank: number;
    /** The exact query sent to the provider (may be a compiled variant). */
    query: string;
}
export type Satisfied = 'yes' | 'no' | 'unknown';
export interface ConstraintCheck {
    constraintId: string;
    satisfied: Satisfied;
    /** Probability-like confidence that the constraint holds (rule verdicts: 0, 0.x or 1). */
    prob: number;
}
export interface GateVerdict {
    keep: boolean;
    /** Lexical relevance (gate.relevance.v1 definition: query + goal + needs, no constraint terms). */
    relevance: number;
    /** Threshold the relevance score was compared with. */
    threshold: number;
    /** Why it was dropped; absent when kept. */
    reason?: 'constraint' | 'relevance';
    /** Ids of the hard constraints definitely violated. */
    violated?: string[];
}
export interface Candidate {
    /** `c_` + 12 hex of sha1(canonicalUrl): stable across runs and providers. */
    candidateId: string;
    canonicalUrl: string;
    /** First-seen raw URL. */
    url: string;
    title: string;
    snippet: string;
    publishedAt?: string;
    /** Every (provider, rank, query) that returned this URL. */
    contributions: Contribution[];
    checks?: ConstraintCheck[];
    gate?: GateVerdict;
}
