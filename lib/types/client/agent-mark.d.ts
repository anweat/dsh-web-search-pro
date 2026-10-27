/**
 * The mark beside a setting that an agent changed with `config.*`: "Changed by agent", whose tooltip says what the agent set, what the
 * configuration holds, why and when, and (outside the cramped list rows) the two buttons that settle it: adopt the value into the
 * configuration, or revoke it. The data is the plugin's overlay, read once over the card's RPC channel when the panel opens and again
 * on the refresh button (see group-agent.tsx).
 * @module web-search-pro/client/agent-mark
 */
import type { OverlayItem } from '../overlay-types.ts';
import type { Card } from './field-rows.tsx';
/** The overlay item of a key in the card's state, or undefined. */
export declare function useOverlayItem(card: Card, key: string): OverlayItem | undefined;
/** One sentence for the tooltip: the value the agent set, the one in the configuration, the reason, who and when. */
export declare function agentTip(t: Card['t'], item: OverlayItem): string;
/**
 * `compact` shows the tag only (list rows have no room for buttons; the "Agent changes" group holds them); otherwise the tag is followed
 * by "Adopt into configuration" and "Revoke".
 */
export declare function AgentMark({ card, itemKey, compact }: {
    card: Card;
    itemKey: string;
    compact?: boolean;
}): import("react").JSX.Element | null;
