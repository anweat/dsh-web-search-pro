import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { Context } from './context-types.ts';
import { type CredentialId, type SettingField, type WebSearchCardState } from './form.ts';
export declare const name = "web-search-pro-client";
export declare const inject: string[];
export declare const NS = "web-search-pro.card";
export type SettingsCardProps = PropsLocale<typeof NS> & {
    useWebSearchPro: <R>(selector: (snapshot: WebSearchCardState) => R) => R;
    edit: (field: SettingField, text: string) => void;
    resetField: (field: SettingField) => void;
    editCredential: (id: CredentialId, text: string) => void;
    save: () => void;
    discard: () => void;
    refreshCredentials: () => void;
};
export declare function apply(ctx: Context): void;
