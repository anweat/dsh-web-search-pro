/**
 * `rules` group: per-site extraction rules (contentSelectors / removeSelectors by hostname) used by read.fetch
 * and read.snapshot; stored in SQLite, they override the built-ins.
 * @module web-search-pro/actions/rules
 */
import { type ActionDef } from './types.ts';
export declare const RULES_ACTIONS: ActionDef[];
