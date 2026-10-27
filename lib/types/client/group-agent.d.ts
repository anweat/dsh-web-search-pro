/**
 * "Agent changes": what an agent changed with the `config.*` actions, kept apart from the user's configuration. The plugin keeps those
 * changes in a managed overlay file that takes effect at once and never edits the profile; this group lists every entry with the reason
 * and time the agent gave, the newest audit records, and for each entry two buttons: "Adopt into configuration" (write the value into
 * the profile with the card's atomic write, then drop the overlay entry) and "Revoke" (drop it). "Revoke all" empties the overlay, which
 * also repairs a file the plugin had to ignore. The card reads the overlay once when it opens and on the refresh button.
 * @module web-search-pro/client/group-agent
 */
import type { OverlayItem } from '../overlay-types.ts';
import { type Card } from './field-rows.tsx';
/** One overlay entry: what it is, the value the agent set against the one in the configuration, why and when, and the two buttons. */
export declare function AgentItem({ card, item, busy }: {
    card: Card;
    item: OverlayItem;
    busy: boolean;
}): import("react").JSX.Element;
export declare function AgentGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
