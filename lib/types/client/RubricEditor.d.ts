import type { WebSearchCardState } from './form.ts';
import type { SettingsCardProps } from './index.ts';
export declare function RubricEditor(props: Pick<SettingsCardProps, 't' | 'editRubric' | 'startRubric' | 'restoreRubric'> & {
    state: WebSearchCardState;
    disabled: boolean;
}): import("react").JSX.Element;
