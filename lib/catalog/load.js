/**
 * Loads the shipped source catalog (`catalog/sources.v1.json`, in the package `files`). Reading is a plain
 * file read plus validation: nothing in the catalog is executed or installed.
 * @module web-search-pro/catalog/load
 */
import fs from 'node:fs';
import { validateCatalog } from "./schema.js";
/** The catalog file, relative to this module in both `src/catalog` and `lib/catalog`. */
export const CATALOG_URL = new URL('../../catalog/sources.v1.json', import.meta.url);
/** Parse and validate catalog JSON text; throws one error listing every problem. */
export function parseCatalog(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch (error) {
        throw new Error('source catalog is not valid JSON: ' + (error instanceof Error ? error.message : String(error)));
    }
    const result = validateCatalog(data);
    if (!result.ok || !result.catalog)
        throw new Error('source catalog is invalid:\n- ' + result.errors.slice(0, 20).join('\n- '));
    return result.catalog;
}
let cached;
/** The shipped catalog, read once per process. */
export function loadCatalog() {
    return cached ??= parseCatalog(fs.readFileSync(CATALOG_URL, 'utf8'));
}
/** Test seam: forget the cached catalog. */
export function resetCatalogCache() { cached = undefined; }
//# sourceMappingURL=load.js.map