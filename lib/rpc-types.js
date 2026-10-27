/**
 * The private RPC channel between the settings card and the running plugin: the shapes it carries. Free of runtime imports (the card
 * bundle includes this file); the server half is src/rpc.ts. The calls:
 *  - `status`: what the plugin can tell about each source and backend right now (installed, ready, why not), from the same local probes
 *    as `sources.status`; never a search, never a login;
 *  - `trial`: runs ONE search of a custom CLI spec that is still a draft in the dialog, the way a real search would run it (probe, then the
 *    spec's command through the same runner and the same read-only guard), and reports what it parsed and what the tool said;
 *  - `overlay`: what the agent overlay holds (the settings an agent changed with `config.*`) and its newest audit entries;
 *  - `overlay.revoke`: drop overlay entries (one or several keys, or all), as the user: the card's "Revoke" and the second half of
 *    "Adopt" (the card writes the value into the profile first, then asks the plugin to drop the entry). Audited with actor `user`.
 * @module web-search-pro/rpc-types
 */
/** The channel prefix this plugin registers with the Host transport (Browser registers `/dsh-browser-assets` the same way). */
export const RPC_CHANNEL = '/dsh-web-search-pro';
//# sourceMappingURL=rpc-types.js.map