/** Fill `{name}` placeholders of a dictionary entry. */
export const fill = (text: string, values: Record<string, string | number>): string => text.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''))
