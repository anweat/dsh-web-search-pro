/**
 * "Runtime and backends": the CLI / OpenCLI / Agent Reach switches, the Twitter / X login values (a dialog), the JSON objects
 * that shape backends (Playwright, platform backend chains, CLI adapters) and the platform settings (custom platforms,
 * selectors, browser bindings), each as a list with its own dialog. The backend order of the platforms and the custom CLIs have their own
 * groups ("Search order", "Custom CLI"); their raw JSON is under "Advanced".
 * @module web-search-pro/client/group-runtime
 */
import { type Card } from './field-rows.tsx';
/** The two values twitter-cli needs: the controls of the dialog. */
export declare function TwitterForm({ card }: {
    card: Card;
}): import("react").JSX.Element;
export declare function RuntimeGroup({ card }: {
    card: Card;
}): import("react").JSX.Element;
