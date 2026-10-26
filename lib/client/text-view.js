/**
 * The "Advanced: text mode" view: the plugin's settings as one commented YAML text. It is a read-only print of the controls'
 * staged state, not a second place the settings live. Every key has a comment in front of it (see field-docs.ts); keys you have
 * overridden are plain lines, the others are commented `# key: value` lines showing the value in force; secrets never appear
 * (only the names of the credentials that hold them). Comment lines start with `#`, so stripping them leaves exactly the
 * overrides as valid YAML.
 * @module web-search-pro/client/text-view
 */
import { fieldDoc, textViewDocs } from "./field-docs.js";
import { textGroupOf } from "./field-keys.js";
import { isPathSpec } from "./form-specs.js";
const newNode = () => ({ children: new Map() });
const hasActive = (node) => (node.leaf?.overridden ?? false) || [...node.children.values()].some(hasActive);
const scalar = (value) => JSON.stringify(value);
const quoteKey = (key) => /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key);
function valueOf(spec, view) {
    const write = spec.parse(view.text);
    if (write?.kind === 'set')
        return { value: write.value, set: true };
    return { value: undefined, set: false };
}
/** Print one node and what is below it; a node with nothing overridden below it is printed commented out. */
function print(node, key, depth, lang, out) {
    const pad = '  '.repeat(depth);
    if (node.leaf) {
        const { spec, value, set, overridden } = node.leaf;
        const doc = fieldDoc(spec.field, lang);
        if (doc)
            out.push(pad + '# ' + doc);
        const line = quoteKey(key) + ':' + (set ? ' ' + scalar(value) : '');
        out.push(overridden ? pad + line : pad + '# ' + line);
        return;
    }
    const active = hasActive(node);
    out.push(pad + (active ? '' : '# ') + quoteKey(key) + ':');
    for (const [childKey, child] of node.children)
        print(child, childKey, depth + 1, lang, out);
}
/**
 * The text of the card's current (staged) settings in `lang`. `views` is the staged text and override flag of every field, as the
 * card state carries them; `specs` are the field specs of the form model.
 */
export function renderTextView(views, specs, lang = 'en') {
    const docs = textViewDocs(lang);
    const lines = docs.header.map(line => '# ' + line);
    const top = new Map();
    const roots = new Map();
    for (const spec of specs) {
        const view = views[spec.field];
        if (!view)
            continue;
        const { value, set } = valueOf(spec, view);
        const leaf = { spec, value, set, overridden: view.overridden && set };
        if (isPathSpec(spec)) {
            const root = roots.get(spec.root) ?? newNode();
            roots.set(spec.root, root);
            let node = root;
            for (const key of spec.path) {
                const next = node.children.get(key) ?? newNode();
                node.children.set(key, next);
                node = next;
            }
            node.leaf = leaf;
        }
        else {
            const group = textGroupOf(spec.field);
            top.set(group, [...top.get(group) ?? [], leaf]);
        }
    }
    for (const group of Object.keys(docs.group)) {
        const leaves = top.get(group);
        if (!leaves?.length)
            continue;
        lines.push('', '# ── ' + docs.group[group] + ' ──');
        for (const leaf of leaves)
            print({ children: new Map(), leaf }, leaf.spec.field, 0, lang, lines);
    }
    for (const [root, node] of roots) {
        lines.push('', '# ── ' + root + ' ──');
        print(node, root, 0, lang, lines);
    }
    return lines.join('\n') + '\n';
}
/** The text of the lines that are data: every comment line and blank line dropped (what a YAML reader sees). */
export function stripComments(text) {
    return text.split('\n').filter(line => line.trim() !== '' && !line.trimStart().startsWith('#')).join('\n');
}
//# sourceMappingURL=text-view.js.map