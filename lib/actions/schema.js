/**
 * Validator and renderers for action parameters, plus a checker for closed
 * output schemas (used by tests to hold results to their declared shape).
 * @module web-search-pro/actions/schema
 */
const MAX_ERRORS = 6;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function describeType(value) {
    if (Array.isArray(value))
        return 'array';
    if (value === null)
        return 'null';
    return typeof value;
}
function validateObject(properties, open, value, path, errors) {
    if (!isRecord(value)) {
        errors.push(`${path || 'args'}: expected object, got ${describeType(value)}`);
        return undefined;
    }
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
        const node = properties[key];
        if (!node) {
            if (open)
                out[key] = entry;
            else
                errors.push(`${path ? path + '.' : ''}${key}: unknown argument (allowed: ${Object.keys(properties).join(', ') || 'none'})`);
            continue;
        }
        // Models often send null for an omitted optional value; treat it as absent.
        if (entry === null || entry === undefined)
            continue;
        const checked = validateNode(node, entry, `${path ? path + '.' : ''}${key}`, errors);
        if (checked !== undefined)
            out[key] = checked;
    }
    for (const [key, node] of Object.entries(properties)) {
        if (node.required && !(key in out) && !errors.some(error => error.startsWith(`${path ? path + '.' : ''}${key}:`))) {
            errors.push(`${path ? path + '.' : ''}${key}: required`);
        }
    }
    return out;
}
function validateNode(node, value, path, errors) {
    if (errors.length >= MAX_ERRORS)
        return undefined;
    switch (node.type) {
        case 'string':
            if (typeof value !== 'string') {
                errors.push(`${path}: expected string, got ${describeType(value)}`);
                return undefined;
            }
            if (node.enum && !node.enum.includes(value)) {
                errors.push(`${path}: must be one of ${node.enum.join(' | ')}`);
                return undefined;
            }
            return value;
        case 'number':
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                errors.push(`${path}: expected number, got ${describeType(value)}`);
                return undefined;
            }
            return value;
        case 'boolean':
            if (typeof value !== 'boolean') {
                errors.push(`${path}: expected boolean, got ${describeType(value)}`);
                return undefined;
            }
            return value;
        case 'array': {
            if (!Array.isArray(value)) {
                errors.push(`${path}: expected array, got ${describeType(value)}`);
                return undefined;
            }
            if (!node.items)
                return value;
            const items = [];
            value.forEach((entry, index) => {
                const checked = validateNode(node.items, entry, `${path}[${index}]`, errors);
                if (checked !== undefined)
                    items.push(checked);
            });
            return items;
        }
        case 'object':
            return validateObject(node.properties ?? {}, node.additionalProperties === true || !node.properties, value, path, errors);
        default:
            return value;
    }
}
/** Validate call arguments against an action's parameter schema. */
export function validateArgs(params, args) {
    const errors = [];
    const input = args === undefined || args === null ? {} : args;
    const value = validateObject(params, false, input, '', errors) ?? {};
    return { ok: errors.length === 0, value, errors };
}
// --- rendering ------------------------------------------------------------
function compactNode(node) {
    switch (node.type) {
        case 'string': return node.enum ? node.enum.map(value => JSON.stringify(value)).join('|') : 'string';
        case 'number': return 'number';
        case 'boolean': return 'boolean';
        case 'array': return (node.items ? compactNode(node.items) : 'any') + '[]';
        case 'object': return node.properties ? '{' + compactFields(node.properties) + '}' : 'object';
        default: return 'any';
    }
}
function compactFields(properties) {
    return Object.entries(properties).map(([key, node]) => `${key}${node.required ? '' : '?'}: ${compactNode(node)}`).join(', ');
}
/** One-line parameter summary: `query: string, count?: number`. */
export function compactParams(params) {
    return compactFields(params);
}
/** Compact schema block attached to INVALID_ARGS replies. */
export function compactSchema(action, params) {
    return `${action}(${compactFields(params)})`;
}
/** Full parameter listing with descriptions. */
export function describeParams(params) {
    if (!Object.keys(params).length)
        return ['  (no arguments)'];
    return Object.entries(params).map(([key, node]) => `  ${key}${node.required ? '' : '?'}: ${compactNode(node)}${node.description ? ' - ' + node.description : ''}`);
}
// --- closed output schemas ---------------------------------------------------
/** Violations of `value` against a closed output schema ([] when it conforms). Unknown fields are violations. */
export function checkOutput(schema, value) {
    const violations = [];
    const walk = (node, entry, path) => {
        if (violations.length >= 12)
            return;
        switch (node.type) {
            case 'string':
                if (typeof entry !== 'string')
                    violations.push(`${path}: expected string, got ${describeType(entry)}`);
                return;
            case 'number':
                if (typeof entry !== 'number')
                    violations.push(`${path}: expected number, got ${describeType(entry)}`);
                return;
            case 'boolean':
                if (typeof entry !== 'boolean')
                    violations.push(`${path}: expected boolean, got ${describeType(entry)}`);
                return;
            case 'array':
                if (!Array.isArray(entry)) {
                    violations.push(`${path}: expected array, got ${describeType(entry)}`);
                    return;
                }
                if (node.items)
                    entry.forEach((item, index) => walk(node.items, item, `${path}[${index}]`));
                return;
            case 'object': {
                if (!isRecord(entry)) {
                    violations.push(`${path}: expected object, got ${describeType(entry)}`);
                    return;
                }
                const properties = node.properties;
                if (!properties)
                    return;
                for (const [key, child] of Object.entries(entry)) {
                    if (child === undefined)
                        continue;
                    const childNode = properties[key];
                    if (!childNode) {
                        if (node.additionalProperties !== true)
                            violations.push(`${path}.${key}: not declared in the output schema`);
                        continue;
                    }
                    walk(childNode, child, `${path}.${key}`);
                }
                for (const [key, child] of Object.entries(properties))
                    if (child.required && entry[key] === undefined)
                        violations.push(`${path}.${key}: required but missing`);
                return;
            }
            default:
        }
    };
    walk(schema, value, 'result');
    return violations;
}
//# sourceMappingURL=schema.js.map