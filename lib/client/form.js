const textField = (field, required = false) => ({
    field,
    format: value => typeof value === 'string' ? value : '',
    parse(text) {
        const value = text.trim();
        if (value.length === 0)
            return required ? undefined : { kind: 'clear' };
        return { kind: 'set', value };
    },
});
const numberField = (field, options = {}) => ({
    field,
    format: value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '',
    parse(text) {
        if (text.trim() === '')
            return { kind: 'clear' };
        const value = Number(text);
        if (!Number.isFinite(value))
            return undefined;
        if (options.integer && !Number.isInteger(value))
            return undefined;
        if (options.min !== undefined && value < options.min)
            return undefined;
        if (options.max !== undefined && value > options.max)
            return undefined;
        return { kind: 'set', value };
    },
});
const booleanField = (field) => ({
    field,
    format: value => value === true ? 'true' : 'false',
    parse: text => text === 'true' || text === 'false'
        ? { kind: 'set', value: text === 'true' }
        : undefined,
});
const csvField = (field, required = false) => ({
    field,
    format: value => Array.isArray(value) ? value.filter(item => typeof item === 'string').join(', ') : '',
    parse(text) {
        const values = [...new Set(text.split(',').map(item => item.trim()).filter(Boolean))];
        if (values.length === 0 && required)
            return undefined;
        return { kind: 'set', value: values };
    },
});
const jsonField = (field, required = false) => ({
    field,
    format: value => value && typeof value === 'object' && !Array.isArray(value)
        ? JSON.stringify(value, null, 2)
        : '',
    parse(text) {
        if (text.trim() === '')
            return required ? undefined : { kind: 'clear' };
        try {
            const value = JSON.parse(text);
            if (value === null || typeof value !== 'object' || Array.isArray(value))
                return undefined;
            return { kind: 'set', value };
        }
        catch {
            return undefined;
        }
    },
});
export const FIELD_SPECS = [
    csvField('engines', true),
    booleanField('parallelEngines'),
    numberField('searchMaxResults', { min: 1, max: 20, integer: true }),
    numberField('timeoutMs', { min: 1_000, integer: true }),
    textField('exaApiKeyEnv', true),
    textField('jinaApiKeyEnv', true),
    textField('githubTokenEnv', true),
    booleanField('enableCliBackends'),
    booleanField('opencliEnabled'),
    booleanField('agentReachEnabled'),
    textField('providerId', true),
    booleanField('registerProvider'),
    jsonField('playwright', true),
    numberField('ttlSeconds', { min: 0, integer: true }),
    numberField('memoryCacheEntries', { min: 1, integer: true }),
    numberField('rrfConstant', { min: 1 }),
    numberField('freshnessBoost', { min: 0, max: 1 }),
    numberField('freshnessDays', { min: 1 }),
    numberField('authorityBoost', { min: 0, max: 1 }),
    csvField('authorityDomains'),
    textField('dbPath'),
    jsonField('platformRules'),
    jsonField('customPlatforms'),
    jsonField('browserBindings'),
    booleanField('verbose'),
];
const SPEC_BY_FIELD = new Map(FIELD_SPECS.map(spec => [spec.field, spec]));
const REF_FIELDS = {
    exa: 'exaApiKeyEnv',
    jina: 'jinaApiKeyEnv',
    github: 'githubTokenEnv',
};
const DEFAULT_REFS = {
    exa: 'EXA_API_KEY',
    jina: 'JINA_API_KEY',
    github: 'GITHUB_TOKEN',
};
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
export class WebSearchSettingsController {
    scope;
    api;
    staged = new Map();
    secretDrafts = new Map();
    listeners = new Set();
    store;
    unsubscribe;
    saving = false;
    failed = false;
    credentialGeneration = 0;
    credentialRefSignature = '';
    credentialStates = {
        exa: { configured: false, writable: true, loading: true },
        jina: { configured: false, writable: true, loading: true },
        github: { configured: false, writable: true, loading: true },
    };
    constructor(scope, api) {
        this.scope = scope;
        this.api = api;
        this.store = createLocalStore(this.project());
        this.unsubscribe = scope.subscribe(() => {
            this.publish();
            const signature = stable(this.credentialRefs());
            if (signature !== this.credentialRefSignature)
                void this.refreshCredentials();
        });
        void this.refreshCredentials();
    }
    inject() {
        return {
            hooks: { webSearchPro: this.store },
            edit: (field, text) => { this.edit(field, text); },
            resetField: (field) => { this.resetField(field); },
            editCredential: (id, text) => { this.editCredential(id, text); },
            save: () => { void this.save(); },
            discard: () => { this.discard(); },
            refreshCredentials: () => { void this.refreshCredentials(); },
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
    discard() {
        this.staged.clear();
        this.secretDrafts.clear();
        this.failed = false;
        this.publish();
    }
    async save() {
        const plan = this.plan();
        const invalid = plan.settings.some(item => item.write === undefined);
        if (this.saving || invalid || (plan.settings.length === 0 && plan.credentials.length === 0))
            return;
        this.saving = true;
        this.failed = false;
        this.publish();
        let landed = true;
        try {
            for (const item of plan.settings) {
                if (item.write === undefined) {
                    landed = false;
                    break;
                }
                if (item.write.kind === 'clear') {
                    await this.scope.unset(item.field);
                    landed = !this.stored(item.field) && landed;
                }
                else {
                    await this.scope.set(item.field, item.write.value);
                    landed = same(this.userLayer()?.[item.field], item.write.value) && landed;
                }
            }
            if (landed) {
                for (const id of plan.credentials) {
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
        }
        this.saving = false;
        this.failed = !landed;
        this.publish();
    }
    async refreshCredentials() {
        const generation = ++this.credentialGeneration;
        const refs = this.credentialRefs();
        this.credentialRefSignature = stable(refs);
        for (const id of Object.keys(refs))
            this.credentialStates[id].loading = true;
        this.publish();
        try {
            const response = await this.api.credentials.describe({ refs: Object.values(refs) });
            if (generation !== this.credentialGeneration || !response.result.ok)
                return;
            for (const id of Object.keys(refs)) {
                const view = response.result.value.credentials[refs[id]];
                this.credentialStates[id] = {
                    configured: view?.configured ?? false,
                    writable: view?.writable ?? true,
                    loading: false,
                };
            }
        }
        catch {
            if (generation !== this.credentialGeneration)
                return;
            for (const id of Object.keys(refs))
                this.credentialStates[id].loading = false;
        }
        finally {
            if (generation === this.credentialGeneration)
                this.publish();
        }
    }
    dispose() {
        this.unsubscribe();
        this.listeners.clear();
        this.credentialGeneration += 1;
    }
    project() {
        const fields = {};
        for (const spec of FIELD_SPECS)
            fields[spec.field] = this.field(spec.field);
        const settingsPlan = this.plan().settings;
        return {
            available: this.scope.getSnapshot().status === 'ready',
            writable: this.scope.getSnapshot().writable,
            dirty: settingsPlan.length > 0 || [...this.secretDrafts.values()].some(value => value.trim() !== ''),
            invalid: settingsPlan.some(item => item.write === undefined),
            saving: this.saving,
            failed: this.failed,
            fields,
            credentials: {
                exa: { text: this.secretDrafts.get('exa') ?? '', ...this.credentialStates.exa },
                jina: { text: this.secretDrafts.get('jina') ?? '', ...this.credentialStates.jina },
                github: { text: this.secretDrafts.get('github') ?? '', ...this.credentialStates.github },
            },
        };
    }
    field(field) {
        const spec = this.spec(field);
        const draft = this.staged.get(field);
        if (draft === undefined) {
            return { text: spec.format(this.sectionValue(field)), overridden: this.stored(field), invalid: false };
        }
        const write = draft.clear ? { kind: 'clear' } : spec.parse(draft.text);
        return { text: draft.text, overridden: write?.kind === 'set', invalid: write === undefined };
    }
    plan() {
        const settings = [];
        for (const [field, draft] of this.staged) {
            const spec = this.spec(field);
            if (draft.clear) {
                if (this.stored(field))
                    settings.push({ field, write: { kind: 'clear' } });
                continue;
            }
            if (draft.text === spec.format(this.sectionValue(field)))
                continue;
            settings.push({ field, write: spec.parse(draft.text) });
        }
        const credentials = [...this.secretDrafts]
            .filter(([, value]) => value.trim() !== '')
            .map(([id]) => id);
        return { settings, credentials };
    }
    async writeCredential(id, value) {
        const ref = this.credentialRefs()[id];
        try {
            await this.api.credentials.set({ ref, value });
            const response = await this.api.credentials.describe({ refs: [ref] });
            return response.result.ok && (response.result.value.credentials[ref]?.configured ?? false);
        }
        catch {
            return false;
        }
    }
    credentialRefs() {
        const value = this.scope.getSnapshot().value ?? {};
        return Object.fromEntries(Object.keys(REF_FIELDS).map((id) => {
            const candidate = value[REF_FIELDS[id]];
            return [id, typeof candidate === 'string' && candidate.trim() !== '' ? candidate : DEFAULT_REFS[id]];
        }));
    }
    spec(field) {
        const spec = SPEC_BY_FIELD.get(field);
        if (!spec)
            throw new Error(`unknown web-search-pro settings field: ${field}`);
        return spec;
    }
    sectionValue(field) {
        return this.scope.getSnapshot().value?.[field];
    }
    baseValue(field) {
        return this.scope.getSnapshot().base?.[field];
    }
    userLayer() {
        return this.scope.getSnapshot().user;
    }
    stored(field) {
        const user = this.userLayer();
        return user !== undefined && Object.hasOwn(user, field);
    }
    publish() {
        this.store.set(this.project());
        for (const listener of this.listeners)
            listener();
    }
}
//# sourceMappingURL=form.js.map