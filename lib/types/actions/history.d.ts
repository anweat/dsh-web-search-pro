/**
 * `history` group: list, replay, expand (evidence), export and delete what the plugin stored.
 * @module web-search-pro/actions/history
 */
import { type ActionDef } from './types.ts';
export declare const HISTORY_ACTIONS: ActionDef[];
export interface RemovedCounts {
    removedQueries: number;
    removedResults: number;
    removedPages: number;
}
export declare function removedText(v: RemovedCounts): string;
