/**
 * "Search order": the order a plain search tries its engines, and the order each platform tries its backends, as lists one
 * moves, adds to and removes from (not as a comma text). Below the engine list sits the order a search would really use, with a
 * sentence on why it differs from the list; the platforms are rows with a dialog. Everything stages into the same draft the sticky
 * save bar writes: `engines` and `platformBackends` as they are, `sources.confidence.<id>` for the confidence box of a row.
 * @module web-search-pro/client/group-order
 */
import { type Card } from './field-rows.tsx';
/** The chain a plain search would try, from the draft, and one sentence on why it is not the list as written. */
export declare function EffectiveChain({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function EngineOrder({ card }: {
    card: Card;
}): import("react").JSX.Element;
/** The body of the platform dialog: the chain as a list with its buttons, the backends that can still be added, and "Restore default". */
export declare function PlatformForm({ card, platform }: {
    card: Card;
    platform: string;
}): import("react").JSX.Element;
export declare function PlatformList({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function OrderGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
