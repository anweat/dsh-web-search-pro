/**
 * "Advanced: text mode": the settings as one commented YAML text, to read or copy. It is a view of the controls (it prints
 * the staged state, secrets excluded), not a second place the settings live. Every key has a comment in front of it.
 * @module web-search-pro/client/group-advanced
 */
import type { Card } from './field-rows.tsx';
export declare function AdvancedGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
