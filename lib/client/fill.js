/** Fill `{name}` placeholders of a dictionary entry. */
export const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''));
//# sourceMappingURL=fill.js.map