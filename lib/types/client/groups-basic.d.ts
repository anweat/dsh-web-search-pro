/**
 * The small groups: "Reading and evidence", "Network and cache", "Ranking weights" (advanced) and the built-in web tool
 * "Route". Each is a handful of rows built from the same controls; the long explanations sit behind the `?`.
 * @module web-search-pro/client/groups-basic
 */
import { type Card } from './field-rows.tsx';
export declare function ReadingGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function NetworkGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function RankingGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function RouteGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
