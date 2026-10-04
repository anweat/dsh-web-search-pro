import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import { type RubricKind } from '../pipeline/rubrics-spec.ts';
import type { Context } from './context-types.ts';
import { BUDGET_SPECS, CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS, type CredentialId, type SettingField } from './form-specs.ts';
export { BUDGET_SPECS, CREDENTIAL_IDS, FIELD_SPECS, KEYED_SPECS, PATH_SPECS };
export type { CredentialId, SettingField };
export interface CardFieldState {
    text: string;
    overridden: boolean;
    invalid: boolean;
    /** What is wrong with the value, as the server's own validation words it (shown instead of the hint). */
    message?: string;
    /** Accepted, but unlikely to do what was meant (shown next to the hint). */
    warning?: string;
}
export interface CredentialState {
    text: string;
    configured: boolean;
    writable: boolean;
    loading: boolean;
}
/** What the rubric editor edits of one override entry, as draft text. */
export declare const RUBRIC_TEXT_KEYS: readonly ["version", "instructions", "criteria", "maxStateChars", "maxCandidateChars"];
export type RubricTextKey = typeof RUBRIC_TEXT_KEYS[number];
export interface RubricCardState {
    id: string;
    kind: RubricKind;
    description: string;
    builtin: {
        version: string;
        instructions: string;
        criteria: string[];
        maxStateChars: number;
        maxCandidateChars: number;
    };
    /** Version in effect: the override's when it is valid, else the built-in's. */
    activeVersion: string;
    /** An override entry exists (stored or being drafted). */
    editing: boolean;
    /** The entry's fields as text; `criteria` is one level per line. */
    entry: Record<RubricTextKey, string>;
    /** Whether the entry is stored in the user layer. */
    overridden: boolean;
    invalid: boolean;
    problems: string[];
}
export interface WebSearchCardState {
    available: boolean;
    writable: boolean;
    dirty: boolean;
    invalid: boolean;
    saving: boolean;
    failed: boolean;
    fields: Record<SettingField, CardFieldState>;
    credentials: Record<CredentialId, CredentialState>;
    /** Ids the judge / coverage provider controls offer: the presets plus the valid custom entries of the draft. */
    providerChoices: string[];
    rubrics: RubricCardState[];
    /** Overrides in settings that name no built-in rubric. */
    unknownRubrics: string[];
}
export declare class WebSearchSettingsController {
    private readonly scope;
    private readonly ctx;
    private readonly staged;
    private readonly secretDrafts;
    /** The criteria textarea of a rubric as typed: blank lines must survive while the person is still typing. */
    private readonly criteriaRaw;
    private readonly listeners;
    private readonly store;
    private readonly unsubscribe;
    private saving;
    private failed;
    private credentialGeneration;
    private credentialRefSignature;
    private credentialStates;
    constructor(scope: ConfigForm<Record<string, unknown>>, ctx: Context);
    inject(): {
        hooks: {
            webSearchPro: SnapshotStore<WebSearchCardState>;
        };
        edit: (field: SettingField, text: string) => void;
        resetField: (field: SettingField) => void;
        editCredential: (id: CredentialId, text: string) => void;
        editRubric: (id: string, key: RubricTextKey, text: string) => void;
        startRubric: (id: string) => void;
        restoreRubric: (id: string) => void;
        save: () => void;
        discard: () => void;
        refreshCredentials: () => void;
    };
    snapshot(): WebSearchCardState;
    edit(field: SettingField, text: string): void;
    resetField(field: SettingField): void;
    editCredential(id: CredentialId, text: string): void;
    /** The entry the editor shows: the staged draft when there is one, else what is stored; undefined = no override. */
    private rubricEntry;
    private stageRubric;
    editRubric(id: string, key: RubricTextKey, text: string): void;
    /** Start an override from the built-in text under the next version label. */
    startRubric(id: string): void;
    /** Restore default: the override entry is removed on save (the built-in applies again). */
    restoreRubric(id: string): void;
    discard(): void;
    save(): Promise<void>;
    refreshCredentials(): Promise<void>;
    dispose(): void;
    private project;
    private decorate;
    private projectRubrics;
    /** The state of one control from the staged draft, else from the Host section. */
    private fieldState;
    /**
     * What saving would do: the writes of the top-level fields, and for each root object (`evidence`, `provider`,
     * `keyedSources`) the one write that carries every staged field of it, built on the raw user layer. The effective
     * evidence settings the draft would produce are then checked with the server's own validators.
     */
    private analyze;
    private opsOf;
    private credentialPlan;
    private writeCredential;
    /** The credentials ref / environment variable name each key is read from, from the saved settings (else the default). */
    private credentialRefs;
    private spec;
    private resolvedRoot;
    private sectionValue;
    private baseValue;
    private userLayer;
    private storedTop;
    private stored;
    private publish;
}
