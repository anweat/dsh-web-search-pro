/**
 * The built-in CLI adapter specs (dev-plan M12). Every argv, flag and output field was derived from the tool's own
 * `--help` (and, where the help does not show the output shape, from the installed package source or the upstream
 * README), and `verification` records how far each was checked:
 *  - `live`: a real read-only search was run and its output parsed (bili, gh, omnireach/wechat);
 *  - `contract-only`: help and version probed on a real install, output shape taken from the tool's own source,
 *    README or documented output option, because a search needs the user's login or reads browser cookies, or was outside
 *    the checks allowed (xhs, zhihu, rdt, twitter, opencli sites, yt-dlp, wx-search-cli);
 *  - `docs-only`: not installed here; derived from the upstream README (tanso).
 * Fixtures for the contract-only and docs-only parsers are marked "constructed from help/docs" in test/fixtures/cli.
 * @module web-search-pro/cli/builtin-specs
 */
import { type CliAdapterSpec, type CliSearchSpec } from './spec.ts';
export declare const BILI_CLI_VERSION = "0.6.2";
export declare const BILI_CLI_REVISION = "489607468f967e0e11f3cdff6efc022d011e982a";
export declare const BILI_CLI_SOURCE = "git+https://github.com/public-clis/bilibili-cli@489607468f967e0e11f3cdff6efc022d011e982a";
export declare const BILI_CLI_INSTALLS: {
    installer: string;
    command: string;
}[];
export declare const TWITTER_CLI_INSTALLS: {
    installer: string;
    command: string;
}[];
/** The date of the checks recorded below. */
export declare const SPEC_CHECK_DATE = "2026-10-06";
/** The `wechat` platform's two tools and the multi-source `omnireach` platform come from the same specs; ids are the backend ids. */
export declare const BUILTIN_CLI_SPECS: readonly CliAdapterSpec[];
export declare const builtinSpecById: (id: string) => CliAdapterSpec | undefined;
export type { CliSearchSpec };
