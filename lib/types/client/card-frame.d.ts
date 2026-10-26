/**
 * The frame around the groups: the status summary on top (with the warnings dialog) and the save bar at the bottom.
 *
 * The Host's `SettingsForm` offers one save button below the controls. This card needs the bar to stay in view while a long
 * page scrolls, to say how many edits are waiting, and to offer "Discard", so the frame is built here; the behaviors a
 * settings form has are kept: it says so when the settings are not served or read-only, and it drops the staged edits when
 * the page is left.
 * @module web-search-pro/client/card-frame
 */
import { type ReactNode } from 'react';
import { type Card } from './field-rows.tsx';
import type { WebSearchCardState } from './form.ts';
/** The chain a plain search would try, from the staged settings; undefined when the draft leaves nothing to try. */
export declare function chainOf(snapshot: Pick<WebSearchCardState, 'fields' | 'credentials'>): string[] | undefined;
/** Everything the warnings badge counts: what the validation says about a field, and the rubric problems. */
export declare function warningsOf(snapshot: WebSearchCardState, t: Card['t']): string[];
export declare function SummaryBar({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function SaveBar({ card }: {
    card: Card;
}): import("react").JSX.Element;
/** The page frame: nothing but a notice while the settings are not served; the staged edits are dropped when the page is left. */
export declare function Frame({ card, children }: {
    card: Card;
    children: ReactNode;
}): import("react").JSX.Element;
