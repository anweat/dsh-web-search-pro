/**
 * The Web Search Pro settings card, as the Plugins page renders it.
 *
 * The page owns the card frame (its title, disclosure and artwork come from the slot registration), so this component renders
 * only what goes inside: the one-liner for `view: 'summary'`, and for `view: 'page'` a status summary, twelve groups (only
 * "Common" open) and a save bar that stays in view.
 *
 *   Common · Search order · Sources · Custom CLI · Reading and evidence · Scoring model · Built-in web tool route ·
 *   Runtime and backends · Network and cache · Ranking weights · Agent changes · Advanced: text mode and raw JSON
 *
 * Each group is its own module (`group-*.tsx`) built from the controls in `ui-kit.tsx`: the Host's own switches, buttons,
 * badges, dialogs and help bubbles, plus the few controls the Host has no component for. Every public config field has
 * exactly one entry in the groups (test/settings-card-render.test.ts counts them); the text of the last group is a view of
 * the same fields, not a second place they live.
 * @module web-search-pro/client/SettingsCard
 */
import type { SettingsCardProps } from './index.ts';
export declare function SettingsCard(props: SettingsCardProps): import("react").JSX.Element;
