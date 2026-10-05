/**
 * Semantic Scholar Graph API paper search (academic), anonymous. Contract source: https://api.semanticscholar.org/api-docs/
 * (`GET /graph/v1/paper/search`: `query`, `fields`, `limit`, `offset`, `year` as `YYYY-` / `YYYY-YYYY`; response
 * `{ total, offset, next, data: [...] }`; `x-api-key` raises the limits; unauthenticated requests share a pool and
 * answer 429 when it is busy, which is NOT a quota problem of this client: it is retried later, never cached as failure).
 * @module web-search-pro/providers/semanticscholar
 */
import type { WebSearchSource } from '@deepseek-ai/dsh-web';
import { EngineError, type Engine, type EngineDeps } from '../engines.ts';
import type { ProviderAdapter, ProviderDescriptor } from './registry.ts';
export declare const SEMANTICSCHOLAR_ROUTE_ID = "semanticscholar";
export declare const SEMANTICSCHOLAR_USAGE_PROVIDER = "semanticscholar";
export declare const SEMANTICSCHOLAR_KEY_ENV = "SEMANTIC_SCHOLAR_API_KEY";
export interface SemanticScholarPaper {
    paperId?: string;
    title?: string | null;
    url?: string | null;
    abstract?: string | null;
    year?: number | null;
    venue?: string | null;
    publicationDate?: string | null;
    citationCount?: number | null;
}
export declare function semanticScholarUrl(query: string, count: number, since?: string): string;
/** Papers -> sources: the Semantic Scholar page URL (built from `paperId` when `url` is absent), venue / year / citations plus the abstract. */
export declare function mapSemanticScholar(papers: readonly SemanticScholarPaper[], count: number): WebSearchSource[];
export declare function parseSemanticScholar(body: unknown, count: number): WebSearchSource[];
export declare function semanticScholarFailure(status: number, headers: Headers, body: unknown): EngineError;
export declare function semanticScholarEngine(deps: EngineDeps): Engine;
export declare const SEMANTICSCHOLAR_DESCRIPTOR: ProviderDescriptor;
export declare const semanticScholarAdapter: ProviderAdapter;
