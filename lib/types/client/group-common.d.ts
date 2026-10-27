/**
 * "Common": what nearly everyone touches, open by default (every other group starts closed): the default engine chain with the
 * order a search would really try, the result count, parallel fusion, the tool surface, the proxy fake-IP switch, and the
 * DeepSeek Search source (常用) with its page-reading switch.
 * @module web-search-pro/client/group-common
 */
import { type Card } from './field-rows.tsx';
/** The names of the common group's fields, in order. */
export declare const COMMON_FIELDS: readonly ["searchMaxResults", "parallelEngines", "toolSurface", "allowProxyFakeIp", "deepseekFetch"];
export declare function CommonGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
