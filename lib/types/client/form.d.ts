import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client';
export type SettingField = 'engines' | 'parallelEngines' | 'searchMaxResults' | 'timeoutMs' | 'exaApiKeyEnv' | 'jinaApiKeyEnv' | 'githubTokenEnv' | 'enableCliBackends' | 'opencliEnabled' | 'agentReachEnabled' | 'providerId' | 'registerProvider' | 'playwright' | 'ttlSeconds' | 'memoryCacheEntries' | 'rrfConstant' | 'freshnessBoost' | 'freshnessDays' | 'authorityBoost' | 'authorityDomains' | 'dbPath' | 'allowProxyFakeIp' | 'platformRules' | 'customPlatforms' | 'browserBindings' | 'verbose';
export type CredentialId = 'exa' | 'jina' | 'github';
export interface CardFieldState {
    text: string;
    overridden: boolean;
    invalid: boolean;
}
export interface CredentialState {
    text: string;
    configured: boolean;
    writable: boolean;
    loading: boolean;
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
}
type FieldWrite = {
    kind: 'set';
    value: unknown;
} | {
    kind: 'clear';
};
interface FieldSpec {
    field: SettingField;
    format(value: unknown): string;
    parse(text: string): FieldWrite | undefined;
}
export declare const FIELD_SPECS: readonly FieldSpec[];
export declare class WebSearchSettingsController {
    private readonly scope;
    private readonly api;
    private readonly staged;
    private readonly secretDrafts;
    private readonly listeners;
    private readonly store;
    private readonly unsubscribe;
    private saving;
    private failed;
    private credentialGeneration;
    private credentialRefSignature;
    private credentialStates;
    constructor(scope: SettingsScope<Record<string, unknown>>, api: Pick<IApiClient, 'credentials'>);
    inject(): {
        hooks: {
            webSearchPro: SnapshotStore<WebSearchCardState>;
        };
        edit: (field: SettingField, text: string) => void;
        resetField: (field: SettingField) => void;
        editCredential: (id: CredentialId, text: string) => void;
        save: () => void;
        discard: () => void;
        refreshCredentials: () => void;
    };
    snapshot(): WebSearchCardState;
    edit(field: SettingField, text: string): void;
    resetField(field: SettingField): void;
    editCredential(id: CredentialId, text: string): void;
    discard(): void;
    save(): Promise<void>;
    refreshCredentials(): Promise<void>;
    dispose(): void;
    private project;
    private field;
    private plan;
    private writeCredential;
    private credentialRefs;
    private spec;
    private sectionValue;
    private baseValue;
    private userLayer;
    private stored;
    private publish;
}
export {};
