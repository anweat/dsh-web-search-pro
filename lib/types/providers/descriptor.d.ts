/**
 * Shared descriptor defaults of the built-in providers (web engines in builtin.ts, platforms in platforms.ts).
 * @module web-search-pro/providers/descriptor
 */
import type { CostDescriptor, ProviderDescriptor } from './registry.ts';
export declare const FREE: CostDescriptor;
export declare function descriptor(d: Partial<ProviderDescriptor> & Pick<ProviderDescriptor, 'id' | 'label'>): ProviderDescriptor;
