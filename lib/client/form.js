import { normalizeCoverage, normalizeJudge, normalizeRubrics } from "../config-fillers.js";
import { BUILTIN_RUBRIC_IDS, builtinDef } from "../pipeline/rubrics-spec.js";
import { BUDGET_SPECS, CREDENTIAL_IDS, CONFIDENCE_PREFIX, FIELD_SPECS, KEYED_SPECS, PATH_SPECS, applyOps, confidenceSpec, credentialRef, deepMerge, getAt, hasAt, isPathSpec, isRecord, rubricField, rubricSpec, } from "./form-specs.js";
import { RPC_CHANNEL } from "../rpc-types.js";
import { adoptionOf } from "./overlay-ops.js";
import { RESTART_FIELD_LIST } from "../restart.js";
import { cliIssues, evidenceIssues, sourcesIssues, nextVersion, providerChoices, unknownRubricIds } from "./validators.js";
export { BUDGET_SPECS, CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS };
/** What the rubric editor edits of one override entry, as draft text. */
export const RUBRIC_TEXT_KEYS = ['version', 'instructions', 'criteria', 'maxStateChars', 'maxCandidateChars'];
const ROOTS = ['evidence', 'provider', 'keyedSources', 'sources'];
/** Top-level fields that are objects whose keys, not the object, are the live (volatile) settings of the plugin schema. */
const CONTAINER_FIELDS = ['playwright'];
function stable(value) {
    if (Array.isArray(value))
        return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function same(left, right) {
    return stable(left) === stable(right);
}
const SPECS = [...FIELD_SPECS, ...PATH_SPECS, ...KEYED_SPECS, ...BUDGET_SPECS, ...BUILTIN_RUBRIC_IDS.map(rubricSpec)];
/** Every field spec of the form model, in display order. */
export const ALL_SPECS = SPECS;
const SPEC_BY_FIELD = new Map(SPECS.map(spec => [spec.field, spec]));
/** The dynamic fields (one `sources.confidence.<id>` per source id) made so far: a field is the same object every time it is asked for. */
const DYNAMIC_SPECS = new Map();
/** The spec of a field that is not in the fixed list: `sources.confidence.<id>`; undefined for any other name. */
function dynamicSpec(field) {
    if (!field.startsWith(CONFIDENCE_PREFIX) || field.length === CONFIDENCE_PREFIX.length)
        return undefined;
    const known = DYNAMIC_SPECS.get(field);
    if (known)
        return known;
    const spec = confidenceSpec(field.slice(CONFIDENCE_PREFIX.length));
    DYNAMIC_SPECS.set(field, spec);
    return spec;
}
/** The specs of the dynamic fields among `fields` (the text view prints them next to the fixed ones). */
export function dynamicSpecsOf(fields) {
    return Object.keys(fields).filter(field => !SPEC_BY_FIELD.has(field)).flatMap(field => dynamicSpec(field) ?? []);
}
function createLocalStore(initial) {
    let snapshot = initial;
    const listeners = new Set();
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        set(next) {
            snapshot = next;
            for (const listener of listeners)
                listener();
        },
        update(updater) {
            const draft = structuredClone(snapshot);
            updater(draft);
            snapshot = draft;
            for (const listener of listeners)
                listener();
        },
    };
}
const emptyCredentials = () => Object.fromEntries(CREDENTIAL_IDS.map(id => [id, { configured: false, writable: true, loading: true }]));
export class WebSearchSettingsController {
    scope;
    ctx;
    staged = new Map();
    secretDrafts = new Map();
    /** The criteria textarea of a rubric as typed: blank lines must survive while the person is still typing. */
    criteriaRaw = new Map();
    listeners = new Set();
    store;
    unsubscribe;
    saving = false;
    failed = false;
    credentialGeneration = 0;
    credentialRefSignature = '';
    credentialStates = emptyCredentials();
    server = { available: false, loading: false, failed: false, trial: { state: 'idle' }, overlay: { loading: false, failed: false, busy: false } };
    trialGeneration = 0;
    constructor(scope, ctx) {
        this.scope = scope;
        this.ctx = ctx;
        this.store = createLocalStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
            this.publish();
            const signature = stable(this.credentialRefs());
            if (signature !== this.credentialRefSignature)
                void this.refreshCredentials();
        });
        void this.refreshCredentials();
        void this.refreshStatus();
        void this.refreshOverlay();
    }
    /** The Host's RPC client, read when it is used (the service may arrive after the card was registered); undefined where there is none. */
    rpc() {
        try {
            const root = this.ctx;
            const connection = (root.get?.('connection') ?? root.connection);
            return typeof connection?.rpc?.call === 'function' ? connection.rpc : undefined;
        }
        catch {
            return undefined;
        }
    }
    /** Ask the plugin what is ready now (the same local probes as `sources.status`). Silent when the Host has no transport. */
    async refreshStatus() {
        const rpc = this.rpc();
        if (!rpc) {
            this.server = { ...this.server, available: false, loading: false };
            this.publish();
            return;
        }
        this.server = { ...this.server, available: true, loading: true };
        this.publish();
        try {
            const result = await rpc.call(RPC_CHANNEL, 'status', {});
            if (!result.ok)
                throw new Error(result.error.message);
            this.server = { ...this.server, available: true, loading: false, failed: false, status: result.value };
        }
        catch {
            // An older plugin build without the channel answers nothing useful: the card falls back to what it can tell by itself.
            this.server = { ...this.server, loading: false, failed: true };
        }
        this.publish();
    }
    setOverlay(patch) {
        this.server = { ...this.server, overlay: { ...this.server.overlay, ...patch } };
        this.publish();
    }
    /** Read what the agent overlay holds (once when the panel opens, and on the refresh button). Silent where the Host has no transport. */
    async refreshOverlay() {
        const rpc = this.rpc();
        if (!rpc) {
            this.setOverlay({ loading: false, failed: true });
            return;
        }
        this.setOverlay({ loading: true });
        try {
            const result = await rpc.call(RPC_CHANNEL, 'overlay', { limit: 20 });
            if (!result.ok)
                throw new Error(result.error.message);
            this.setOverlay({ loading: false, failed: false, view: result.value });
        }
        catch {
            // A plugin build without the endpoint answers nothing useful: the card shows no agent changes and says it could not read them.
            this.setOverlay({ loading: false, failed: true });
        }
    }
    /** Drop overlay entries (keys, or `'all'`) as the user. The plugin audits it; the card shows the overlay as it is afterwards. */
    async revokeOverlay(keys, adopted = false) {
        const rpc = this.rpc();
        if (!rpc) {
            this.setOverlay({ error: { key: 'agentRevokeFailed', why: 'unavailable' } });
            return false;
        }
        this.setOverlay({ busy: true, error: undefined });
        try {
            const result = await rpc.call(RPC_CHANNEL, 'overlay.revoke', { keys: keys === 'all' ? 'all' : [...keys], ...adopted ? { adopted: true } : {} });
            if (!result.ok)
                throw new Error(result.error.message);
            this.setOverlay({ busy: false, failed: false, view: result.value });
            void this.refreshStatus();
            return true;
        }
        catch (error) {
            this.setOverlay({ busy: false, error: { key: 'agentRevokeFailed', why: error instanceof Error ? error.message : String(error) } });
            return false;
        }
    }
    /**
     * "Adopt into configuration": write the overlay item's value into the profile with the Host's atomic `mutate` (the same call the save bar
     * makes, at the leaf the item is about), and only when that landed ask the plugin to drop the entry. A failed write leaves both as they were.
     */
    async adoptOverlay(key) {
        const item = this.server.overlay.view?.items.find(entry => entry.key === key);
        const adoption = item ? adoptionOf(item) : undefined;
        if (!item || !adoption || this.saving || !this.scope.getSnapshot().writable)
            return false;
        this.setOverlay({ busy: true, error: undefined });
        let landed = false;
        try {
            landed = await this.scope.mutate(adoption.ops);
        }
        catch {
            landed = false;
        }
        if (!landed) {
            this.setOverlay({ busy: false, error: { key: 'agentAdoptFailed' } });
            return false;
        }
        for (const field of adoption.drop)
            this.staged.delete(field);
        this.publish();
        const dropped = await this.revokeOverlay([key], true);
        if (!dropped)
            this.setOverlay({ error: { key: 'agentAdoptHalf', why: this.server.overlay.error?.why } });
        return dropped;
    }
    /** Run one search of a custom CLI draft (rpc-types.ts `trial`). The outcome lands in `server.trial`. */
    async runTrial(request) {
        const rpc = this.rpc();
        const generation = ++this.trialGeneration;
        if (!rpc) {
            this.server = { ...this.server, trial: { state: 'failed', id: request.id, error: 'unavailable' } };
            this.publish();
            return;
        }
        this.server = { ...this.server, trial: { state: 'running', id: request.id } };
        this.publish();
        let trial;
        try {
            const result = await rpc.call(RPC_CHANNEL, 'trial', request);
            trial = result.ok ? { state: 'done', id: request.id, result: result.value } : { state: 'failed', id: request.id, error: result.error.message };
        }
        catch (error) {
            trial = { state: 'failed', id: request.id, error: error instanceof Error ? error.message : String(error) };
        }
        if (generation !== this.trialGeneration)
            return;
        this.server = { ...this.server, trial };
        this.publish();
    }
    clearTrial() {
        this.trialGeneration += 1;
        this.server = { ...this.server, trial: { state: 'idle' } };
        this.publish();
    }
    inject() {
        return {
            hooks: { webSearchPro: this.store },
            edit: (field, text) => { this.edit(field, text); },
            resetField: (field) => { this.resetField(field); },
            editCredential: (id, text) => { this.editCredential(id, text); },
            editRubric: (id, key, text) => { this.editRubric(id, key, text); },
            startRubric: (id) => { this.startRubric(id); },
            restoreRubric: (id) => { this.restoreRubric(id); },
            save: () => { void this.save(); },
            discard: () => { this.discard(); },
            refreshCredentials: () => { void this.refreshCredentials(); },
            refreshStatus: () => { void this.refreshStatus(); },
            refreshOverlay: () => { void this.refreshOverlay(); },
            revokeOverlay: (keys) => { void this.revokeOverlay(keys); },
            adoptOverlay: (key) => { void this.adoptOverlay(key); },
            runTrial: (request) => { void this.runTrial(request); },
            clearTrial: () => { this.clearTrial(); },
        };
    }
    snapshot() {
        return this.store.getSnapshot();
    }
    edit(field, text) {
        this.staged.set(field, { text, clear: false });
        this.failed = false;
        this.publish();
    }
    resetField(field) {
        const spec = this.spec(field);
        this.staged.set(field, { text: spec.format(this.baseValue(field)), clear: true });
        this.failed = false;
        this.publish();
    }
    editCredential(id, text) {
        this.secretDrafts.set(id, text);
        this.failed = false;
        this.publish();
    }
    // --- rubric editor: structured controls over one staged JSON entry ----------------------------------------------
    /** The entry the editor shows: the staged draft when there is one, else what is stored; undefined = no override. */
    rubricEntry(id) {
        const text = this.fieldState(rubricField(id)).text;
        if (text.trim() === '')
            return undefined;
        try {
            const value = JSON.parse(text);
            return isRecord(value) ? value : undefined;
        }
        catch {
            return undefined;
        }
    }
    stageRubric(id, entry) {
        const field = rubricField(id);
        const spec = this.spec(field);
        this.staged.set(field, { text: entry && Object.keys(entry).length ? spec.format(entry) : '', clear: false });
        this.failed = false;
        this.publish();
    }
    editRubric(id, key, text) {
        const entry = structuredClone(this.rubricEntry(id) ?? {});
        if (key === 'criteria') {
            this.criteriaRaw.set(id, text);
            const levels = text.split('\n').map(line => line.trim()).filter(Boolean);
            if (levels.length)
                entry.criteria = levels;
            else
                delete entry.criteria;
        }
        else if (text.trim() === '') {
            delete entry[key];
        }
        else if (key === 'maxStateChars' || key === 'maxCandidateChars') {
            // A value that is not a number stays text, so the shared validation names it instead of the card guessing.
            entry[key] = Number.isFinite(Number(text)) ? Number(text) : text;
        }
        else {
            entry[key] = key === 'version' ? text.trim() : text;
        }
        this.stageRubric(id, entry);
    }
    /** Start an override from the built-in text under the next version label. */
    startRubric(id) {
        const base = builtinDef(id);
        if (!base)
            return;
        this.criteriaRaw.delete(id);
        this.stageRubric(id, {
            version: nextVersion(base.version),
            instructions: base.instructions,
            ...base.criteria ? { criteria: [...base.criteria] } : {},
            maxStateChars: base.maxStateChars,
            maxCandidateChars: base.maxCandidateChars,
        });
    }
    /** Restore default: the override entry is removed on save (the built-in applies again). */
    restoreRubric(id) {
        this.criteriaRaw.delete(id);
        this.resetField(rubricField(id));
    }
    discard() {
        this.staged.clear();
        this.secretDrafts.clear();
        this.criteriaRaw.clear();
        this.failed = false;
        this.publish();
    }
    async save() {
        const analysis = this.analyze();
        const plan = analysis.settings;
        const invalid = plan.some(item => item.write === undefined) || analysis.blocked.size > 0;
        const credentials = this.credentialPlan();
        if (this.saving || invalid || (plan.length === 0 && credentials.length === 0))
            return;
        this.saving = true;
        this.failed = false;
        this.publish();
        let landed = true;
        try {
            // One atomic mutation, at the paths of the fields that changed: the Host accepts an edit only beneath a field the plugin
            // declared volatile, so a whole container (`evidence`, `sources`, `playwright`) is never written as one value.
            if (analysis.ops.length > 0)
                landed = await this.scope.mutate(analysis.ops);
            if (landed) {
                for (const id of credentials) {
                    const value = this.secretDrafts.get(id)?.trim() ?? '';
                    if (value === '')
                        continue;
                    landed = await this.writeCredential(id, value) && landed;
                }
            }
        }
        catch {
            landed = false;
        }
        await this.refreshCredentials();
        if (landed) {
            this.staged.clear();
            this.secretDrafts.clear();
            this.criteriaRaw.clear();
        }
        this.saving = false;
        this.failed = !landed;
        this.publish();
        // What is ready may have changed with the settings just saved (a custom CLI, a key, a chain).
        if (landed)
            void this.refreshStatus();
    }
    async refreshCredentials() {
        const generation = ++this.credentialGeneration;
        const refs = this.credentialRefs();
        this.credentialRefSignature = stable(refs);
        for (const id of CREDENTIAL_IDS)
            this.credentialStates[id].loading = true;
        this.publish();
        const response = await this.ctx.remote.credentials.describe([...new Set(Object.values(refs))]);
        if (generation !== this.credentialGeneration)
            return;
        if (response.ok) {
            for (const id of CREDENTIAL_IDS) {
                const view = response.value[refs[id]];
                this.credentialStates[id] = {
                    configured: view?.configured ?? false,
                    writable: view?.writable ?? true,
                    loading: false,
                };
            }
        }
        else {
            for (const id of CREDENTIAL_IDS)
                this.credentialStates[id].loading = false;
        }
        if (generation === this.credentialGeneration)
            this.publish();
    }
    dispose() {
        this.unsubscribe();
        this.listeners.clear();
        this.credentialGeneration += 1;
    }
    // --- projection --------------------------------------------------------------------------------------------------
    project() {
        const analysis = this.analyze();
        const fields = {};
        for (const spec of SPECS)
            fields[spec.field] = this.decorate(spec.field, this.fieldState(spec.field), analysis);
        for (const field of this.dynamicFields())
            fields[field] = this.decorate(field, this.fieldState(field), analysis);
        const credentialsDirty = this.credentialPlan().length > 0;
        return {
            available: this.scope.getSnapshot().status === 'ready',
            writable: this.scope.getSnapshot().writable,
            dirty: analysis.settings.length > 0 || credentialsDirty,
            changes: this.changedFields() + this.credentialPlan().length,
            invalid: analysis.settings.some(item => item.write === undefined) || analysis.blocked.size > 0,
            saving: this.saving,
            failed: this.failed,
            fields,
            credentials: Object.fromEntries(CREDENTIAL_IDS.map(id => [id, { text: this.secretDrafts.get(id) ?? '', ...this.credentialStates[id] }])),
            providerChoices: providerChoices(getAt(analysis.evidence, ['judge', 'providers'])),
            rubrics: this.projectRubrics(fields, analysis),
            restartTouched: this.restartTouched(),
            unknownRubrics: unknownRubricIds(analysis.evidence.rubrics),
            server: this.server,
        };
    }
    /** The start-up-only settings (restart.ts) whose staged edit differs from what is stored. */
    restartTouched() {
        const touched = [];
        for (const field of RESTART_FIELD_LIST) {
            if (field === 'playwright.snapshotDir') {
                if (this.snapshotDirTouched())
                    touched.push(field);
                continue;
            }
            const draft = this.staged.get(field);
            if (!draft)
                continue;
            if (draft.clear ? this.stored(field) : draft.text !== this.spec(field).format(this.sectionValue(field)))
                touched.push(field);
        }
        return touched;
    }
    /** `playwright` is one JSON field; only its `snapshotDir` is a start-up setting (`enabled` is live). */
    snapshotDirTouched() {
        const draft = this.staged.get('playwright');
        if (!draft)
            return false;
        const stored = this.sectionValue('playwright');
        const before = isRecord(stored) ? stored.snapshotDir : undefined;
        if (draft.clear)
            return before !== undefined;
        try {
            const value = JSON.parse(draft.text);
            return (isRecord(value) ? value.snapshotDir : undefined) !== before;
        }
        catch {
            return false;
        }
    }
    /** Staged fields that differ from what is stored (a pending reset counts only when something is stored). */
    changedFields() {
        let count = 0;
        for (const [field, draft] of this.staged) {
            const spec = this.spec(field);
            if (draft.clear) {
                if (this.stored(field))
                    count++;
                continue;
            }
            if (draft.text !== spec.format(this.sectionValue(field)))
                count++;
        }
        return count;
    }
    decorate(field, state, analysis) {
        const own = analysis.issues.filter(issue => issue.field === field);
        const errors = own.filter(issue => issue.level === 'error').map(issue => issue.message);
        const warnings = own.filter(issue => issue.level === 'warning').map(issue => issue.message);
        return {
            ...state,
            invalid: state.invalid || analysis.blocked.has(field),
            ...errors.length ? { message: errors.join('\n') } : {},
            ...warnings.length ? { warning: warnings.join('\n') } : {},
        };
    }
    projectRubrics(fields, analysis) {
        return BUILTIN_RUBRIC_IDS.map((id) => {
            const base = builtinDef(id);
            const field = rubricField(id);
            const entry = this.rubricEntry(id);
            const state = fields[field];
            const text = (value) => typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
            const problems = analysis.issues.filter(issue => issue.field === field).map(issue => issue.message);
            return {
                id,
                kind: base.kind,
                description: base.description,
                builtin: { version: base.version, instructions: base.instructions, criteria: [...base.criteria ?? []], maxStateChars: base.maxStateChars, maxCandidateChars: base.maxCandidateChars },
                activeVersion: entry !== undefined && problems.length === 0 && typeof entry.version === 'string' ? entry.version : base.version,
                editing: entry !== undefined,
                entry: {
                    version: text(entry?.version),
                    instructions: text(entry?.instructions),
                    criteria: this.criteriaRaw.get(id) ?? (Array.isArray(entry?.criteria) ? entry.criteria.map(text).join('\n') : ''),
                    maxStateChars: text(entry?.maxStateChars),
                    maxCandidateChars: text(entry?.maxCandidateChars),
                },
                overridden: state.overridden,
                invalid: state.invalid,
                problems: problems.flatMap(problem => problem.split('\n')),
            };
        });
    }
    /** The state of one control from the staged draft, else from the Host section. */
    fieldState(field) {
        const spec = this.spec(field);
        const draft = this.staged.get(field);
        if (draft === undefined) {
            return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
        }
        const write = draft.clear ? { kind: 'clear' } : spec.parse(draft.text);
        return { text: draft.text, overridden: write?.kind === 'set', invalid: write === undefined };
    }
    /**
     * What saving would do: the writes of the top-level fields, and for each root object (`evidence`, `provider`,
     * `keyedSources`) the one write that carries every staged field of it, built on the raw user layer. The effective
     * evidence settings the draft would produce are then checked with the server's own validators.
     */
    analyze() {
        const settings = [];
        const sectionOps = [];
        const ops = new Map();
        const staged = new Set();
        for (const [field, draft] of this.staged) {
            const spec = this.spec(field);
            if (!isPathSpec(spec)) {
                if (draft.clear) {
                    if (this.stored(field)) {
                        settings.push({ target: field, write: { kind: 'clear' } });
                        sectionOps.push(...this.topOps(field, { kind: 'clear' }));
                    }
                    continue;
                }
                if (draft.text === spec.format(this.sectionValue(field)))
                    continue;
                const write = spec.parse(draft.text);
                settings.push({ target: field, write });
                if (write)
                    sectionOps.push(...this.topOps(field, write));
                continue;
            }
            const entry = ops.get(spec.root) ?? { ops: [], invalid: false };
            const resolved = this.resolvedRoot(spec.root);
            if (draft.clear) {
                if (this.stored(field)) {
                    entry.ops.push(...this.opsOf(spec, { kind: 'clear' }, resolved));
                    staged.add(field);
                }
            }
            else if (draft.text !== spec.format(this.sectionValue(field))) {
                const write = spec.parse(draft.text);
                staged.add(field);
                if (write === undefined)
                    entry.invalid = true;
                else
                    entry.ops.push(...this.opsOf(spec, write, resolved));
            }
            ops.set(spec.root, entry);
        }
        const user = this.userLayer() ?? {};
        const candidates = new Map();
        for (const root of ROOTS) {
            const entry = ops.get(root);
            const stored = isRecord(user[root]) ? user[root] : undefined;
            const next = structuredClone(stored ?? {});
            if (entry)
                applyOps(next, entry.ops);
            candidates.set(root, next);
            if (entry === undefined || (!entry.invalid && same(next, stored ?? {})))
                continue;
            if (entry.invalid)
                settings.push({ target: root, write: undefined });
            else {
                if (Object.keys(next).length > 0)
                    settings.push({ target: root, write: { kind: 'set', value: next } });
                else if (this.storedTop(root))
                    settings.push({ target: root, write: { kind: 'clear' } });
                // Leaf edits at their own paths; an unset of a leaf the user layer does not hold would only create empty parents.
                for (const op of entry.ops)
                    if (op.op === 'set' || hasAt(stored ?? {}, op.path))
                        sectionOps.push({ ...op, path: [root, ...op.path] });
            }
        }
        // Effective evidence settings of the draft: the composition layer under the user layer as it would be written.
        const base = this.scope.getSnapshot().base?.evidence;
        const merged = deepMerge(isRecord(base) ? base : {}, candidates.get('evidence'));
        // The Host's schema parser fills empty containers (`thresholds: {}`, `providers`' `limits`, ...) into the base; the server drops
        // them before it validates, so the card does too: "present" must mean "given".
        const evidence = {
            ...merged,
            ...isRecord(merged.judge) ? { judge: normalizeJudge(merged.judge) } : {},
            ...isRecord(merged.coverage) ? { coverage: normalizeCoverage(merged.coverage) } : {},
            ...isRecord(merged.rubrics) ? { rubrics: normalizeRubrics(merged.rubrics) } : {},
        };
        const baseSources = this.scope.getSnapshot().base?.sources;
        // The CLI adapter settings are top-level fields: the draft value when staged, else what the Host section holds.
        const topValue = (field) => {
            const draft = this.staged.get(field);
            if (draft === undefined)
                return this.sectionValue(field);
            if (draft.clear)
                return undefined;
            const write = this.spec(field).parse(draft.text);
            return write?.kind === 'set' ? write.value : undefined;
        };
        const issues = [...evidenceIssues(evidence), ...sourcesIssues(deepMerge(isRecord(baseSources) ? baseSources : {}, candidates.get('sources'))), ...cliIssues(topValue('platformBackends'), topValue('cliAdapters'))];
        // An error blocks the save when the person is editing what it is about; otherwise it is shown as it stands.
        const blocked = new Set();
        const touched = (field) => staged.has(field) || this.staged.has(field);
        for (const issue of issues) {
            if (issue.level === 'error' && (touched(issue.field) || (issue.related ?? []).some(related => touched(related))))
                blocked.add(issue.field);
        }
        return { settings, ops: sectionOps, issues, blocked, evidence };
    }
    /**
     * The Host ops of a top-level field. A container the schema does not declare volatile as a whole (`playwright`: its keys are)
     * is written key by key; every other field is one `set` or one `unset`.
     */
    topOps(field, write) {
        if (!CONTAINER_FIELDS.includes(field))
            return write.kind === 'clear' ? [{ op: 'unset', path: [field] }] : [{ op: 'set', path: [field], value: write.value }];
        const stored = this.userLayer()?.[field];
        const keys = isRecord(stored) ? Object.keys(stored) : [];
        const value = write.kind === 'set' && isRecord(write.value) ? write.value : {};
        return [
            ...Object.entries(value).map(([key, entry]) => ({ op: 'set', path: [field, key], value: entry })),
            ...keys.filter(key => !Object.hasOwn(value, key)).map((key) => ({ op: 'unset', path: [field, key] })),
        ];
    }
    opsOf(spec, write, resolved) {
        if (spec.ops)
            return spec.ops(write, { resolved });
        return write.kind === 'clear' ? [{ op: 'unset', path: [...spec.path] }] : [{ op: 'set', path: [...spec.path], value: write.value }];
    }
    credentialPlan() {
        return [...this.secretDrafts]
            .filter(([, value]) => value.trim() !== '')
            .map(([id]) => id);
    }
    async writeCredential(id, value) {
        const ref = this.credentialRefs()[id];
        const written = await this.ctx.remote.credentials.set(ref, value);
        if (!written.ok)
            return false;
        const response = await this.ctx.remote.credentials.describe([ref]);
        return response.ok && (response.value[ref]?.configured ?? false);
    }
    /** The credentials ref / environment variable name each key is read from, from the saved settings (else the default). */
    credentialRefs() {
        return Object.fromEntries(CREDENTIAL_IDS.map((id) => {
            const { field, default: fallback } = credentialRef(id);
            const candidate = this.sectionValue(field);
            return [id, typeof candidate === 'string' && candidate.trim() !== '' ? candidate : fallback];
        }));
    }
    /** The `sources.confidence.<id>` fields that hold a value now or in the draft: the card shows these ids with their values. */
    dynamicFields() {
        const stored = this.scope.getSnapshot().value?.sources;
        const ids = isRecord(stored) && isRecord(stored.confidence) ? Object.keys(stored.confidence) : [];
        return [...new Set([...ids.map(id => CONFIDENCE_PREFIX + id), ...[...this.staged.keys()].filter(field => field.startsWith(CONFIDENCE_PREFIX))])];
    }
    spec(field) {
        const spec = SPEC_BY_FIELD.get(field) ?? dynamicSpec(field);
        if (!spec)
            throw new Error(`unknown web-search-pro settings field: ${field}`);
        return spec;
    }
    resolvedRoot(root) {
        const value = this.scope.getSnapshot().value?.[root];
        return isRecord(value) ? value : {};
    }
    sectionValue(field) {
        const spec = this.spec(field);
        if (!isPathSpec(spec))
            return this.scope.getSnapshot().value?.[field];
        const resolved = this.resolvedRoot(spec.root);
        return spec.read ? spec.read(resolved) : getAt(resolved, spec.path);
    }
    baseValue(field) {
        const base = this.scope.getSnapshot().base;
        const spec = this.spec(field);
        if (!isPathSpec(spec))
            return base?.[field];
        const root = isRecord(base?.[spec.root]) ? base[spec.root] : {};
        return spec.read ? spec.read(root) : getAt(root, spec.path);
    }
    userLayer() {
        return this.scope.getSnapshot().user;
    }
    storedTop(key) {
        const user = this.userLayer();
        return user !== undefined && Object.hasOwn(user, key);
    }
    stored(field) {
        const spec = this.spec(field);
        if (!isPathSpec(spec))
            return this.storedTop(field);
        const root = this.userLayer()?.[spec.root];
        if (!isRecord(root))
            return false;
        return spec.stored ? spec.stored(root) : hasAt(root, spec.path);
    }
    publish() {
        this.store.set(this.project());
        for (const listener of this.listeners)
            listener();
    }
}
//# sourceMappingURL=form.js.map