/**
 * Where the login-state script lives, as a command the user can paste. The script ships in the package's `scripts/` folder,
 * one level above this module both in `src/` and in the built `lib/`, so the absolute path is right in either layout and
 * for someone who installed the npm package (a path relative to the package is not findable from their working directory).
 * @module web-search-pro/login-script
 */
import { fileURLToPath } from 'node:url';
/** Absolute path of `scripts/save-login.mjs`. */
export const SAVE_LOGIN_SCRIPT = fileURLToPath(new URL('../scripts/save-login.mjs', import.meta.url));
/** `node "<absolute path>"`: quoted, so it works on Windows and for paths with spaces. */
export const SAVE_LOGIN_COMMAND = 'node "' + SAVE_LOGIN_SCRIPT + '"';
//# sourceMappingURL=login-script.js.map