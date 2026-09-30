/**
 * Evidence-pipeline types (dev-plan §4.2 TaskSpec/Constraint, design §6.1
 * candidate fields). Pure data; nothing here touches the network or storage.
 * @module web-search-pro/pipeline/types
 */
export const PROFILES = ['docs_code', 'news_fact', 'academic', 'experience', 'compare', 'general'];
export const CONSTRAINT_KINDS = [
    'must_term', 'exclude_term', 'entity', 'version', 'time_window',
    'site', 'exclude_site', 'language', 'region', 'source_type',
];
//# sourceMappingURL=types.js.map