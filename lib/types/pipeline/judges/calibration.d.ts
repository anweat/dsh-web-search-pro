/**
 * Per-provider calibration of raw scores onto grades 0..3 (design §7: scores of
 * different models are never mixed without calibration).
 * @module web-search-pro/pipeline/judges/calibration
 */
import type { Calibration } from './types.ts';
/** Problems of a calibration definition; empty = valid. */
export declare function calibrationProblems(c: unknown): string[];
/** Raw score -> grade 0..3 (linear between points, constant outside). Assumes a valid calibration. */
export declare function applyCalibration(c: Calibration, raw: number): number;
/** `version#hash`: what results and cache keys record (a changed point changes the hash). */
export declare function calibrationKey(c: Calibration): string;
