import type { CredentialId, CardFieldState, SettingField } from './form.ts';
import type { SettingsCardProps } from './index.ts';
export declare function TextField(props: {
    field: SettingField;
    state: CardFieldState;
    label: string;
    hint: string;
    disabled: boolean;
    t: SettingsCardProps['t'];
    edit: SettingsCardProps['edit'];
    reset: SettingsCardProps['resetField'];
    type?: 'text' | 'number';
}): import("react").JSX.Element;
export declare function JsonField(props: {
    field: SettingField;
    state: CardFieldState;
    label: string;
    hint: string;
    disabled: boolean;
    rows?: number;
    t: SettingsCardProps['t'];
    edit: SettingsCardProps['edit'];
    reset: SettingsCardProps['resetField'];
}): import("react").JSX.Element;
export declare function ToggleField(props: {
    field: SettingField;
    state: CardFieldState;
    label: string;
    hint: string;
    disabled: boolean;
    t: SettingsCardProps['t'];
    edit: SettingsCardProps['edit'];
    reset: SettingsCardProps['resetField'];
}): import("react").JSX.Element;
export declare function CredentialField(props: {
    id: CredentialId;
    label: string;
    hint: string;
    state: {
        text: string;
        configured: boolean;
        writable: boolean;
        loading: boolean;
    };
    disabled: boolean;
    t: SettingsCardProps['t'];
    edit: SettingsCardProps['editCredential'];
}): import("react").JSX.Element;
