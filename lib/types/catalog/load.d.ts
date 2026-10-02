/**
 * Loads the shipped source catalog (`catalog/sources.v1.json`, in the package `files`). Reading is a plain
 * file read plus validation: nothing in the catalog is executed or installed.
 * @module web-search-pro/catalog/load
 */
import { type SourceCatalog } from './schema.ts';
/** The catalog file, relative to this module in both `src/catalog` and `lib/catalog`. */
export declare const CATALOG_URL: URL;
/** Parse and validate catalog JSON text; throws one error listing every problem. */
export declare function parseCatalog(text: string): SourceCatalog;
/** The shipped catalog, read once per process. */
export declare function loadCatalog(): SourceCatalog;
/** Test seam: forget the cached catalog. */
export declare function resetCatalogCache(): void;
