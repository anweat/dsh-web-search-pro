/**
 * Coverage judge policy (dev-plan M9, S8): which needs the judge is asked about,
 * what it is shown (the "evidence view": the selected excerpts mapped to the
 * need), how its probability is read (bands against thresholds calibrated per
 * provider and rubric) and how a verdict changes the coverage.
 *
 * S8's rule ("a selected block has grade >= 2") is lexical: it cannot tell that
 * the docs do not contain the answer (dev-plan M3b). The judge asks the model
 * whether the excerpts by themselves state the answer. Modes:
 *   off     - nothing is asked (default);
 *   shadow  - asked and recorded in `stats.coverage`, the coverage is unchanged;
 *   control - a weak verdict turns a claimed-covered need into a `weak_support` gap
 *             (a critical one may trigger the bounded second round), an uncertain one
 *             stays covered with a caution marker.
 * A probability is meaningless without thresholds from a calibration on labelled
 * data, so control / shadow only run with thresholds for the provider and rubric
 * in use (configured, or the ones this plugin shipped for that pair).
 * @module web-search-pro/pipeline/coverage
 */
import type { CoverageJudge } from './judges/coverage.ts';
import type { ResolvedRubric } from './rubrics.ts';
import type { Coverage, SelectedBlock } from './select.ts';
import type { CoverageBand, Need } from './types.ts';
export declare const COVERAGE_MODES: readonly ["off", "shadow", "control"];
export type CoverageMode = typeof COVERAGE_MODES[number];
/** `prob < weak` is weak, `prob >= covered` is covered, in between is uncertain. */
export interface CoverageThresholds {
    weak: number;
    covered: number;
}
/** `evidence.coverage` as the user writes it. */
export interface CoverageSettings {
    mode: CoverageMode;
    /** Judge provider (default: `evidence.judge.provider`, else bocha-jev). Must speak the systemone protocol. */
    provider?: string | undefined;
    /** Absent = the thresholds shipped for the provider + rubric pair, if any. */
    thresholds?: CoverageThresholds | undefined;
}
/** The configured judge, ready to ask (built by the service from `evidence.coverage`). */
export interface CoverageStage {
    mode: 'shadow' | 'control';
    judge: CoverageJudge;
    thresholds: CoverageThresholds;
}
/** `evidence.coverage` validated: an invalid mode means off, an invalid provider is dropped; every problem is reported. */
export declare function resolveCoverageSettings(raw: unknown): {
    settings: CoverageSettings;
    diagnostics: string[];
};
export declare const COVERAGE_RUBRIC_ID = "cover.sufficient";
/** Characters of the evidence view handed to the judge (the rubric's candidate cap). */
export declare const DEFAULT_VIEW_CHARS = 2400;
/** Needs asked about at most (every claimed-covered need is asked; this only bounds a pathological task). */
export declare const MAX_COVERAGE_QUESTIONS = 12;
/**
 * Thresholds fitted on the v1 CALIBRATION split (bench/README, dev-plan M9: false weak <= 5% of the truly covered claims,
 * then the most false claims removed; `covered` = lowest probability from which the standing claims reach 85% precision),
 * keyed `provider|rubric@version`. Another provider, model or rubric version has no entry: it needs `evidence.coverage.thresholds`.
 * Shipping them does not turn the judge on: `evidence.coverage.mode` stays `off` until set.
 */
export declare const CALIBRATED_THRESHOLDS: Readonly<Record<string, CoverageThresholds>>;
export declare const thresholdKey: (providerId: string, rubric: Pick<ResolvedRubric, "id" | "version">) => string;
/** Problems of a thresholds object; empty = valid. */
export declare function thresholdsProblems(raw: unknown): string[];
export interface ThresholdResolution {
    thresholds?: CoverageThresholds;
    source?: 'configured' | 'calibrated';
    reason?: string;
}
/** The thresholds for this provider + rubric: configured, else the shipped pair calibration, else none (with the reason). */
export declare function resolveThresholds(settings: Pick<CoverageSettings, 'thresholds'>, providerId: string, rubric: Pick<ResolvedRubric, 'id' | 'version'>): ThresholdResolution;
export declare function bandOf(prob: number, t: CoverageThresholds): CoverageBand;
/**
 * What the judge reads for a need: the selected excerpts mapped to it, highest grade first (selection order on ties),
 * numbered, each with its title / host and heading, cut to `budget` characters (the last one is shortened when at
 * least 200 characters remain). Empty when no selected excerpt is mapped to the need.
 */
export declare function evidenceView(needId: string, selected: readonly SelectedBlock[], budget?: number): string;
export interface CoverageVerdict {
    needId: string;
    prob: number;
    band: CoverageBand;
}
export declare function verdictsOf(probs: ReadonlyMap<string, number>, thresholds: CoverageThresholds): CoverageVerdict[];
export interface JudgedCoverage extends Coverage {
    /** Covered needs the judge was unsure about. */
    uncertain: string[];
}
/** Control mode: weak verdicts leave `covered` and become `weak_support` gaps (needs order kept), uncertain ones stay covered and are listed. */
export declare function applyVerdicts(needs: readonly Need[], coverage: Coverage, verdicts: readonly CoverageVerdict[]): JudgedCoverage;
